// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/git-relay`
 * Purpose: Host-side git push for gateway sandbox agents. Agent commits in container; host pushes.
 * Scope: One public method: publish(). Detects branch, guards sandbox/* allowlist, bundles, pushes. Does not handle agent execution, billing, or PR creation.
 * Invariants:
 *   - Per HOST_SIDE_GIT_RELAY (inv. 20): push on host, commits in container
 *   - Per SECRETS_HOST_ONLY (inv. 4): token never enters the container
 *   - Never push staging/main/master/HEAD — sandbox/* allowlist only
 * Side-effects: IO (docker exec into gateway, docker cp, git push on host)
 * Links: docs/spec/openclaw-sandbox-controls.md
 * @internal
 */

import "server-only";

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Docker from "dockerode";

import { makeLogger } from "@/shared/observability";

const GATEWAY_CONTAINER = "openclaw-gateway";
const ACTIVE_WORKTREE = "/workspace/wt/active";
const BASE_REF = "staging";
const PROTECTED_BRANCHES = new Set(["staging", "main", "master"]);
const ALLOWLIST_PREFIX = "sandbox/";

export interface PublishResult {
  branch: string;
  commitCount: number;
  pushed: boolean;
}

/**
 * Host-side git push relay for the gateway sandbox container.
 *
 * The agent works in /workspace/current (symlink → active worktree),
 * creates a sandbox/* branch, and commits locally. This class detects
 * that branch, bundles it out of the container, and pushes to origin.
 */
export class GitRelay {
  private readonly docker: Docker;
  private readonly log = makeLogger({ component: "GitRelay" });

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  /**
   * Detect branch, guard, bundle, push.
   * Throws on guard violations. Returns { pushed: false } if no commits.
   */
  async publish(opts: {
    token: string;
    repoPath: string;
  }): Promise<PublishResult> {
    const { token, repoPath } = opts;

    // 1. Detect branch + commit count inside container
    const branch = (
      await this.exec(
        `git -C "${ACTIVE_WORKTREE}" rev-parse --abbrev-ref HEAD`,
        5_000
      )
    ).trim();

    const ahead = parseInt(
      (
        await this.exec(
          `git -C "${ACTIVE_WORKTREE}" rev-list --count "origin/${BASE_REF}..HEAD"`,
          10_000
        )
      ).trim(),
      10
    );
    const commitCount = Number.isNaN(ahead) ? 0 : ahead;

    if (commitCount === 0) {
      return { branch, commitCount: 0, pushed: false };
    }

    // 2. Guards — never push protected or non-allowlisted branches
    if (branch === "HEAD" || PROTECTED_BRANCHES.has(branch)) {
      throw new Error(
        `Publish refused: "${branch}" is protected. Use a sandbox/* branch.`
      );
    }
    if (!branch.startsWith(ALLOWLIST_PREFIX)) {
      throw new Error(
        `Publish refused: "${branch}" not in ${ALLOWLIST_PREFIX}* allowlist.`
      );
    }

    // 3. Bundle inside container → docker cp to host
    const tmpDir = mkdtempSync(join(tmpdir(), "git-relay-"));
    try {
      const safe = branch.replace(/\//g, "-");
      const cBundle = `/tmp/${safe}.bundle`;
      const hBundle = join(tmpDir, `${safe}.bundle`);

      await this.exec(
        `git -C "${ACTIVE_WORKTREE}" bundle create "${cBundle}" "${branch}" --not "origin/${BASE_REF}"`,
        30_000
      );
      execSync(`docker cp "${GATEWAY_CONTAINER}:${cBundle}" "${hBundle}"`, {
        stdio: "pipe",
        timeout: 30_000,
      });
      await this.exec(`rm -f "${cBundle}"`, 5_000);

      // 4. Host: clone → fetch bundle → push
      const repoUrl = execSync(`git -C "${repoPath}" remote get-url origin`, {
        encoding: "utf8",
        timeout: 5_000,
      }).trim();
      const authUrl = repoUrl.replace(
        "https://",
        `https://x-access-token:${token}@`
      );
      const cloneDir = join(tmpDir, "repo");

      execSync(
        `git clone --depth=1 --branch="${BASE_REF}" "${authUrl}" "${cloneDir}"`,
        { stdio: "pipe", timeout: 60_000 }
      );
      execSync(
        `git -C "${cloneDir}" fetch "${hBundle}" "${branch}:${branch}"`,
        { stdio: "pipe", timeout: 30_000 }
      );
      execSync(`git -C "${cloneDir}" push origin "${branch}"`, {
        stdio: "pipe",
        timeout: 60_000,
      });

      this.log.info({ branch, commitCount }, "Published");
      return { branch, commitCount, pushed: true };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async exec(cmd: string, timeoutMs: number): Promise<string> {
    const container = this.docker.getContainer(GATEWAY_CONTAINER);
    const ex = await container.exec({
      Cmd: ["bash", "-c", cmd],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await ex.start({ hijack: true, stdin: false });
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
    return demux(Buffer.concat(chunks));
  }
}

/** Demux Docker multiplexed stream (8-byte header per frame, stdout = type 1). */
function demux(buf: Buffer): string {
  const out: Buffer[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const type = buf.readUInt8(off);
    const size = buf.readUInt32BE(off + 4);
    if (off + 8 + size > buf.length) break;
    if (type === 1) out.push(buf.subarray(off + 8, off + 8 + size));
    off += 8 + size;
  }
  return Buffer.concat(out).toString("utf8");
}
