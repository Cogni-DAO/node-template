// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/repo/git-ls-files.adapter`
 * Purpose: Git ls-files based file listing for RepoCapability.list().
 * Scope: Spawns `git ls-files` (no shell) for path discovery. Does NOT define tool contracts.
 * Invariants:
 *   - REPO_READ_ONLY: Read-only access, no writes
 *   - SHA_STAMPED: All results include HEAD sha7
 *   - HARD_BOUNDS: max 5000 paths per request
 *   - NO_EXEC_IN_BRAIN: Only spawns `git` with fixed flags
 *   - SINGLE_RESPONSIBILITY: Only handles file listing (search/open live in RipgrepAdapter)
 * Side-effects: IO (subprocess execution)
 * Links: COGNI_BRAIN_SPEC.md
 * @internal
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { RepoListParams, RepoListResult } from "@cogni/ai-tools";

import { makeLogger } from "@/shared/observability";

const execFileAsync = promisify(execFile);
const logger = makeLogger({ component: "GitLsFilesAdapter" });

// Hard bounds
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

/**
 * Configuration for GitLsFilesAdapter.
 */
export interface GitLsFilesAdapterConfig {
  /** Absolute path to repository root */
  repoRoot: string;
  /** Callback to get HEAD sha (shared with RipgrepAdapter for single canonical source) */
  getSha: () => Promise<string>;
  /** Execution timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Git ls-files adapter for listing repository files.
 *
 * Dedicated adapter for file discovery via `git ls-files`.
 * Separated from RipgrepAdapter to maintain single responsibility.
 */
export class GitLsFilesAdapter {
  private readonly repoRoot: string;
  private readonly getSha: () => Promise<string>;
  private readonly timeoutMs: number;

  constructor(config: GitLsFilesAdapterConfig) {
    this.repoRoot = resolve(config.repoRoot);
    this.getSha = config.getSha;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /**
   * List repository files, optionally filtered by glob pattern.
   *
   * Glob is passed to `git ls-files -- <glob>` and follows git pathspec rules.
   */
  async list(params: RepoListParams): Promise<RepoListResult> {
    const sha = await this.getSha();
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Build args: git -C <repoRoot> ls-files [-- <glob>]
    const args: string[] = ["-C", this.repoRoot, "ls-files"];
    if (params.glob) {
      args.push("--", params.glob);
    }

    let stdout: string;
    try {
      const result = await execFileAsync("git", args, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      stdout = result.stdout;
    } catch (error) {
      // Distinguish git binary not found from other errors
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new Error(
          "git binary not found. Ensure git is installed and available in PATH."
        );
      }
      logger.error({ err: error, glob: params.glob }, "git ls-files failed");
      throw error;
    }

    // Split by newlines, filter empty, canonicalize paths (strip leading ./)
    const allPaths = stdout
      .split("\n")
      .filter(Boolean)
      .map((p) => (p.startsWith("./") ? p.slice(2) : p));

    const truncated = allPaths.length > limit;
    const paths = allPaths.slice(0, limit);

    logger.debug(
      { glob: params.glob, pathCount: paths.length, truncated },
      "git ls-files completed"
    );

    return { paths, sha, truncated };
  }
}
