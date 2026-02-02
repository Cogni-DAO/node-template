// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/integration/sandbox/network-isolation`
 * Purpose: Proves network isolation and workspace I/O for sandbox containers.
 * Scope: Tests SandboxRunnerAdapter with real Docker containers. Does not test LLM integration or Temporal workflows.
 * Invariants:
 *   - Network=none blocks all external access
 *   - Workspace mount allows read/write
 *   - No orphan containers after tests
 * Side-effects: IO (Docker containers, filesystem)
 * Links: docs/SANDBOXED_AGENTS.md, src/adapters/server/sandbox/
 * @public
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import Docker from "dockerode";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { SandboxRunnerAdapter } from "@/adapters/server/sandbox";

const SANDBOX_IMAGE = "cogni-sandbox-runtime:latest";

describe("Sandbox Network Isolation (P0)", () => {
  const docker = new Docker();
  let runner: SandboxRunnerAdapter;
  let imageBuilt = false;

  beforeAll(async () => {
    // Check if image exists, skip tests if not
    try {
      await docker.getImage(SANDBOX_IMAGE).inspect();
      imageBuilt = true;
      runner = new SandboxRunnerAdapter({ imageName: SANDBOX_IMAGE });
    } catch {
      // Image doesn't exist - this is expected on first run
      // Skip tests if image not built (CI should build it first)
      console.warn(
        `Sandbox image ${SANDBOX_IMAGE} not found. Run: docker build -t ${SANDBOX_IMAGE} services/sandbox-runtime`
      );
    }
  });

  afterEach(async () => {
    // Verify no orphan sandbox containers remain
    const containers = await docker.listContainers({ all: true });
    const orphans = containers.filter((c) =>
      c.Names.some((n) => n.includes("sandbox-"))
    );

    if (orphans.length > 0) {
      console.warn(
        "Orphan sandbox containers found:",
        orphans.map((c) => c.Names)
      );
      // Clean them up
      for (const orphan of orphans) {
        try {
          await docker.getContainer(orphan.Id).remove({ force: true });
        } catch {
          // Container may already be gone
        }
      }
    }

    expect(orphans).toHaveLength(0);
  });

  afterAll(async () => {
    // Final cleanup check
    const containers = await docker.listContainers({ all: true });
    const sandboxContainers = containers.filter((c) =>
      c.Names.some((n) => n.includes("sandbox-"))
    );

    for (const container of sandboxContainers) {
      try {
        await docker.getContainer(container.Id).remove({ force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("network=none blocks external access", async () => {
    if (!imageBuilt) {
      console.warn("Skipping test: sandbox image not built");
      return;
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));

    try {
      const result = await runner.runOnce({
        runId: "test-network-isolation",
        workspacePath: workspace,
        // Try to reach external network - should fail
        command:
          "curl -s --max-time 2 http://example.com 2>&1 || echo 'NETWORK_BLOCKED'",
        limits: { maxRuntimeSec: 10, maxMemoryMb: 128 },
      });

      // Command should complete but curl should fail
      // Either curl returns error or our fallback message
      expect(result.stdout).toContain("NETWORK_BLOCKED");
      // OR the command failed entirely due to network
      // The key is: we should NOT get example.com content
      expect(result.stdout).not.toContain("<!doctype html>");
      expect(result.stdout).not.toContain("Example Domain");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("workspace read/write works", async () => {
    if (!imageBuilt) {
      console.warn("Skipping test: sandbox image not built");
      return;
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));

    try {
      const result = await runner.runOnce({
        runId: "test-workspace-rw",
        workspacePath: workspace,
        command:
          'echo "hello-from-sandbox" > /workspace/test.txt && cat /workspace/test.txt',
        limits: { maxRuntimeSec: 10, maxMemoryMb: 128 },
      });

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello-from-sandbox");

      // Verify host can read the file
      const content = await fs.readFile(
        path.join(workspace, "test.txt"),
        "utf8"
      );
      expect(content.trim()).toBe("hello-from-sandbox");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("captures stdout and stderr separately", async () => {
    if (!imageBuilt) {
      console.warn("Skipping test: sandbox image not built");
      return;
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));

    try {
      const result = await runner.runOnce({
        runId: "test-stdout-stderr",
        workspacePath: workspace,
        command: 'echo "stdout-content" && echo "stderr-content" >&2',
        limits: { maxRuntimeSec: 10, maxMemoryMb: 128 },
      });

      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("stdout-content");
      expect(result.stderr).toContain("stderr-content");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("returns non-zero exit code on command failure", async () => {
    if (!imageBuilt) {
      console.warn("Skipping test: sandbox image not built");
      return;
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));

    try {
      const result = await runner.runOnce({
        runId: "test-exit-code",
        workspacePath: workspace,
        command: "exit 42",
        limits: { maxRuntimeSec: 10, maxMemoryMb: 128 },
      });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(42);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("times out long-running commands", async () => {
    if (!imageBuilt) {
      console.warn("Skipping test: sandbox image not built");
      return;
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));

    try {
      const result = await runner.runOnce({
        runId: "test-timeout",
        workspacePath: workspace,
        command: "sleep 60", // Should be killed by timeout
        limits: { maxRuntimeSec: 2, maxMemoryMb: 128 },
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("timeout");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }, 10000); // 10 second test timeout

  it("no orphan containers after run", async () => {
    // This is implicitly tested by afterEach hook
    // The afterEach will fail if any orphan containers exist
    expect(true).toBe(true);
  });
});
