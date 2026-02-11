// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/sandbox/sandbox-openclaw-pnpm-smoke`
 * Purpose: Smoke test proving pnpm devtools and store volume are accessible inside the long-running OpenClaw gateway container.
 * Scope: Verifies pnpm binary, PNPM_STORE_DIR env, store volume writability, offline install with biome, and negative control (missing dep fails offline). Does not test network-enabled installs or ephemeral container mode.
 * Invariants:
 *   - Per IMAGE_FROM_PUBLISHED_BASE: gateway runs cogni-sandbox-openclaw image with devtools
 *   - Per COMPOSE_IMAGE_PARITY: same image in dev and prod compose
 * Side-effects: IO (Docker exec into running container)
 * Links: docs/spec/openclaw-sandbox-spec.md, work/items/task.0031.openclaw-cogni-dev-image.md
 * @public
 */

import Docker from "dockerode";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Offline install takes ~45s (full monorepo from seeded store). 90s test + 80s exec gives headroom.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 15_000 });

import { execInContainer } from "../../_fixtures/sandbox/fixtures";

const GATEWAY_CONTAINER = "openclaw-gateway";

async function isContainerRunning(
  docker: Docker,
  name: string
): Promise<boolean> {
  try {
    const container = docker.getContainer(name);
    const info = await container.inspect();
    return info.State.Running;
  } catch {
    return false;
  }
}

describe("OpenClaw Gateway pnpm Store Smoke", () => {
  const docker = new Docker();

  beforeAll(async () => {
    const running = await isContainerRunning(docker, GATEWAY_CONTAINER);
    if (!running) {
      throw new Error(
        `${GATEWAY_CONTAINER} container not running. Start with: pnpm dev:infra`
      );
    }
  });

  it("pnpm binary present at correct version", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      "pnpm --version"
    );

    expect(output.trim()).toMatch(/^9\./);
  });

  it("pnpm store dir resolves to /pnpm-store", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      "pnpm store path"
    );

    expect(output.trim()).toBe("/pnpm-store/v3");
  });

  it("/pnpm-store is writable by sandboxer", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      'touch /pnpm-store/_test && rm /pnpm-store/_test && echo "OK" || echo "FAIL"'
    );

    expect(output).toContain("OK");
    expect(output).not.toContain("FAIL");
  });

  it("offline install enables biome", async () => {
    // Use the real repo lockfile — pnpm install --offline --frozen-lockfile
    // skips resolution (no metadata needed) and hardlinks from seeded store.
    // /workspace is a real volume (cogni_workspace), not tmpfs, so full
    // monorepo node_modules fits.
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      [
        "rm -rf /workspace/_offline_test",
        "cp -rL /repo/current /workspace/_offline_test",
        "cd /workspace/_offline_test",
        "pnpm install --offline --frozen-lockfile",
        "pnpm exec biome --version",
        'echo "BIOME_OK"',
      ].join(" && "),
      80_000
    );

    expect(output).toContain("BIOME_OK");
  });

  it("offline install fails without seeded store (negative control)", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      [
        "mkdir -p /workspace/_neg_test",
        "cd /workspace/_neg_test",
        'echo \'{"name":"neg-test","dependencies":{"nonexistent-pkg-12345":"1.0.0"}}\' > package.json',
        "pnpm install --offline 2>&1; echo EXIT:$?",
      ].join(" && "),
      15_000
    );

    // Must not exit 0 — offline install with missing dep should fail
    expect(output).not.toContain("EXIT:0");
    expect(output).toMatch(/EXIT:[1-9]/);
  });
});
