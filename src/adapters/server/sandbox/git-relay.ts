// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/git-relay`
 * Purpose: Host-side git relay for gateway sandbox agents — worktree setup, bundle transfer, push + PR.
 * Scope: Host-side push/PR via git + gh CLI, container-side worktree + bundle via dockerode exec. Does not handle agent execution, billing, or ephemeral container mode.
 * Invariants:
 *   - Per HOST_SIDE_GIT_RELAY (inv. 20): push/PR on host, commits in container
 *   - Per BRANCH_KEY_IDENTITY (inv. 23): branchKey is stable work identity, never runId
 *   - Per SECRETS_HOST_ONLY (inv. 4): GITHUB_TOKEN never enters the container
 * Side-effects: IO (docker exec into gateway, docker cp, git/gh on host)
 * Links: docs/spec/openclaw-sandbox-controls.md, sandbox-graph.provider.ts
 * @internal
 */

import "server-only";

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Docker from "dockerode";
import type { Logger } from "pino";

import { makeLogger } from "@/shared/observability";

const GATEWAY_CONTAINER = "openclaw-gateway";
const WORKTREE_BASE = "/workspace/wt";
const GIT_SYNC_MIRROR = "/repo/current";
/** Symlink so the agent (configured for /workspace/current) sees the active worktree. */
const WORKSPACE_CURRENT = "/workspace/current";

/** Result of a relay attempt after an agent session completes. */
export interface GitRelayResult {
  /** Whether new commits were detected */
  hasCommits: boolean;
  /** Number of new commits */
  commitCount: number;
  /** Branch name that was pushed (if any) */
  branch?: string;
  /** PR URL if created/updated */
  prUrl?: string;
}

/**
 * Manages host-side git relay for gateway sandbox agents.
 *
 * Container-side: git worktrees + git bundle (first-party offline transport).
 * Host-side: git fetch from bundle + git push + gh CLI for PRs.
 */
export class GitRelayManager {
  private readonly docker: Docker;
  private readonly log: Logger;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
    this.log = makeLogger({ component: "GitRelayManager" });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Container-side operations (via dockerode exec)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Idempotent: ensure a git worktree exists at /workspace/wt/<branchKey> on
   * branch sandbox/<branchKey>. Symlinks /workspace/current → the worktree
   * so the agent (configured for /workspace/current) sees the right code.
   *
   * The worktree's origin remote points to the git-sync mirror (/repo/current),
   * so fetch/rebase work natively inside the container without network.
   */
  async ensureWorkspaceBranch(
    branchKey: string,
    baseRef: string
  ): Promise<void> {
    const branch = `sandbox/${branchKey}`;
    const wtPath = `${WORKTREE_BASE}/${branchKey}`;
    const log = this.log.child({ branchKey, baseRef, branch, wtPath });

    // Ensure the bare/main repo has the git-sync mirror as a remote
    // (idempotent — set-url works whether remote exists or not)
    await this.execInGateway(
      `git -C ${GIT_SYNC_MIRROR} remote set-url origin "${GIT_SYNC_MIRROR}" 2>/dev/null || true`,
      5_000
    );

    // Check if worktree already exists
    const wtExists = await this.execInGateway(
      `test -d "${wtPath}/.git" -o -f "${wtPath}/.git" && echo "EXISTS" || echo "MISSING"`,
      5_000
    );

    if (wtExists.trim() === "EXISTS") {
      log.info("Worktree exists, checking out branch");
      // Fetch latest from mirror and reset to pick up upstream changes
      await this.execInGateway(
        `cd "${wtPath}" && git fetch origin && git checkout "${branch}" 2>/dev/null || true`,
        30_000
      );
    } else {
      log.info("Creating new worktree from baseRef");
      await this.execInGateway(
        [
          `mkdir -p "${WORKTREE_BASE}"`,
          `cd ${GIT_SYNC_MIRROR}`,
          `git fetch origin`,
          `git worktree add -b "${branch}" "${wtPath}" "origin/${baseRef}"`,
        ].join(" && "),
        30_000
      );
      // Set origin remote in the worktree to point at git-sync mirror
      // so agent can run `git fetch origin` / `git rebase origin/<base>` natively
      await this.execInGateway(
        `git -C "${wtPath}" remote set-url origin "${GIT_SYNC_MIRROR}"`,
        5_000
      );
    }

    // Symlink /workspace/current → active worktree
    await this.execInGateway(
      `rm -f "${WORKSPACE_CURRENT}" && ln -s "${wtPath}" "${WORKSPACE_CURRENT}"`,
      5_000
    );

    log.info("Workspace branch ready");
  }

  /**
   * Detect new commits on the worktree's branch vs baseRef.
   * Returns the count of commits ahead of origin/<baseRef>.
   */
  async detectNewCommits(branchKey: string, baseRef: string): Promise<number> {
    const wtPath = `${WORKTREE_BASE}/${branchKey}`;
    const output = await this.execInGateway(
      `git -C "${wtPath}" rev-list --count "origin/${baseRef}..HEAD"`,
      10_000
    );
    const count = parseInt(output.trim(), 10);
    return Number.isNaN(count) ? 0 : count;
  }

  /**
   * Create a git bundle containing new commits (sandbox/<branchKey> vs origin/<baseRef>).
   * The bundle file is written inside the container, then docker cp'd to the host.
   * Returns the host-side path to the bundle, or undefined if no commits.
   */
  async createBundle(
    branchKey: string,
    baseRef: string,
    hostDir: string
  ): Promise<string | undefined> {
    const branch = `sandbox/${branchKey}`;
    const wtPath = `${WORKTREE_BASE}/${branchKey}`;
    const containerBundlePath = `/tmp/relay-${branchKey}.bundle`;

    const count = await this.detectNewCommits(branchKey, baseRef);
    if (count === 0) return undefined;

    // Create bundle inside container
    await this.execInGateway(
      `git -C "${wtPath}" bundle create "${containerBundlePath}" "${branch}" --not "origin/${baseRef}"`,
      30_000
    );

    // docker cp bundle to host (handles tar extraction automatically)
    const hostBundlePath = join(hostDir, `${branchKey}.bundle`);
    execSync(
      `docker cp "${GATEWAY_CONTAINER}:${containerBundlePath}" "${hostBundlePath}"`,
      { stdio: "pipe", timeout: 30_000 }
    );

    // Clean up container-side bundle
    await this.execInGateway(`rm -f "${containerBundlePath}"`, 5_000);

    return hostBundlePath;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Host-side operations (git CLI + gh CLI)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Full relay: detect commits, create bundle, fetch on host, push, create/update PR.
   * Returns relay result with PR URL if created.
   *
   * @param branchKey - Stable branch identity (not runId)
   * @param baseRef - Base branch (e.g. "staging", "main")
   * @param repoUrl - Git remote URL (e.g. "https://github.com/org/repo.git")
   * @param token - GITHUB_TOKEN for push + PR (host-only, per SECRETS_HOST_ONLY)
   * @param prTitle - PR title (used only on create, not update)
   * @param prBody - PR body (used only on create, not update)
   */
  async relayCommits(opts: {
    branchKey: string;
    baseRef: string;
    repoUrl: string;
    token: string;
    prTitle: string;
    prBody: string;
  }): Promise<GitRelayResult> {
    const { branchKey, baseRef, repoUrl, token, prTitle, prBody } = opts;
    const branch = `sandbox/${branchKey}`;
    const log = this.log.child({ branchKey, branch, baseRef });

    // 1. Create bundle from container (detect + extract in one shot)
    const tmpDir = mkdtempSync(join(tmpdir(), "git-relay-"));
    try {
      const bundlePath = await this.createBundle(branchKey, baseRef, tmpDir);
      if (!bundlePath) {
        log.info("No new commits detected, skipping relay");
        return { hasCommits: false, commitCount: 0 };
      }

      // 2. Host-side: shallow clone, fetch from bundle, push
      //    Auth via GIT_ASKPASS env (token never appears in command strings or error messages)
      const cloneDir = join(tmpDir, "repo");
      const askpass = this.writeAskpass(tmpDir, token);
      // biome-ignore lint/style/noProcessEnv: git CLI child process needs inherited PATH; token injected via GIT_ASKPASS, not read from env
      const gitEnv = {
        ...process.env,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: "0",
      };

      log.info("Cloning repo on host for push");
      execSync(
        `git clone --depth=1 --branch="${baseRef}" "${repoUrl}" "${cloneDir}"`,
        { stdio: "pipe", timeout: 60_000, env: gitEnv }
      );

      // Fetch branch from bundle into local clone
      execSync(
        `git -C "${cloneDir}" fetch "${bundlePath}" "${branch}:${branch}"`,
        { stdio: "pipe", timeout: 30_000 }
      );

      // Push
      log.info("Pushing branch to remote");
      execSync(
        `git -C "${cloneDir}" push --force-with-lease origin "${branch}"`,
        { stdio: "pipe", timeout: 60_000, env: gitEnv }
      );

      // Count commits for reporting
      const countOut = execSync(
        `git -C "${cloneDir}" rev-list --count "origin/${baseRef}..${branch}"`,
        { encoding: "utf8", timeout: 5_000 }
      );
      const commitCount = parseInt(countOut.trim(), 10) || 0;

      // 3. Create or update PR via gh CLI
      const prUrl = this.createOrUpdatePR({
        repoUrl,
        token,
        head: branch,
        base: baseRef,
        title: prTitle,
        body: prBody,
        log,
      });

      log.info({ prUrl, commitCount }, "Git relay complete");
      return {
        hasCommits: true,
        commitCount,
        branch,
        ...(prUrl ? { prUrl } : {}),
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PR operations (gh CLI — no bespoke REST client)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a PR if none exists for this head branch, otherwise return existing PR URL.
   * Uses gh CLI (requires GITHUB_TOKEN in env).
   */
  private createOrUpdatePR(opts: {
    repoUrl: string;
    token: string;
    head: string;
    base: string;
    title: string;
    body: string;
    log: Logger;
  }): string | undefined {
    const { repoUrl, token, head, base, title, body, log } = opts;
    const { owner, repo } = this.parseGitHubUrl(repoUrl);
    if (!owner || !repo) {
      log.warn({ repoUrl }, "Could not parse GitHub owner/repo, skipping PR");
      return undefined;
    }

    const ghRepo = `${owner}/${repo}`;
    // biome-ignore lint/style/noProcessEnv: gh CLI needs inherited PATH + shell env; token injected from server config, not read here
    const env = { ...process.env, GITHUB_TOKEN: token };

    try {
      // Check for existing open PR
      const existing = execSync(
        `gh pr list --repo "${ghRepo}" --head "${head}" --base "${base}" --state open --json url --jq ".[0].url"`,
        {
          encoding: "utf8",
          env,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15_000,
        }
      ).trim();

      if (existing) {
        log.info({ prUrl: existing }, "PR already exists");
        return existing;
      }
    } catch {
      // gh pr list failed — no existing PR, proceed to create
    }

    try {
      const prUrl = execSync(
        `gh pr create --repo "${ghRepo}" --head "${head}" --base "${base}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
        {
          encoding: "utf8",
          env,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15_000,
        }
      ).trim();

      log.info({ prUrl }, "PR created");
      return prUrl;
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to create PR via gh CLI"
      );
      return undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a shell command inside the gateway container.
   * Uses hijack:true with bounded timeout per dockerode gotchas.
   */
  private async execInGateway(cmd: string, timeoutMs: number): Promise<string> {
    const container = this.docker.getContainer(GATEWAY_CONTAINER);
    const exec = await container.exec({
      Cmd: ["bash", "-c", cmd],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        stream.destroy();
        resolve();
      }, timeoutMs);
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (chunks.length === 0) return "";
    return GitRelayManager.demuxDockerStream(Buffer.concat(chunks));
  }

  /** Demux Docker multiplexed stream (8-byte header per frame, stdout = type 1). */
  private static demuxDockerStream(buffer: Buffer): string {
    const stdout: Buffer[] = [];
    let offset = 0;
    while (offset + 8 <= buffer.length) {
      const streamType = buffer.readUInt8(offset);
      const frameSize = buffer.readUInt32BE(offset + 4);
      if (offset + 8 + frameSize > buffer.length) break;
      if (streamType === 1) {
        stdout.push(buffer.subarray(offset + 8, offset + 8 + frameSize));
      }
      offset += 8 + frameSize;
    }
    return Buffer.concat(stdout).toString("utf8");
  }

  /** Write a temporary GIT_ASKPASS script that echoes the token. Keeps token out of CLI args. */
  private writeAskpass(dir: string, token: string): string {
    const script = join(dir, "git-askpass.sh");
    writeFileSync(script, `#!/bin/sh\necho "x-access-token:${token}"\n`, {
      mode: 0o700,
    });
    return script;
  }

  /** Parse owner/repo from GitHub URL. */
  private parseGitHubUrl(
    repoUrl: string
  ): { owner: string; repo: string } | { owner: undefined; repo: undefined } {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!match?.[1] || !match[2]) return { owner: undefined, repo: undefined };
    return { owner: match[1], repo: match[2] };
  }
}
