// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/sandbox/sandbox-openclaw-pnpm-smoke`
 * Purpose: Smoke test proving pnpm devtools and store volume are accessible inside the long-running OpenClaw gateway container.
 * Scope: Verifies pnpm binary, PNPM_STORE_DIR env, store volume writability, and offline install with biome (when store is seeded). Offline test skipped until task.0036 seeds the store.
 * Invariants:
 *   - Per IMAGE_FROM_PUBLISHED_BASE: gateway runs cogni-sandbox-openclaw image with devtools
 *   - Per COMPOSE_IMAGE_PARITY: same image in dev and prod compose
 * Side-effects: IO (Docker exec into running container)
 * Links: docs/spec/openclaw-sandbox-spec.md, work/items/task.0031.openclaw-cogni-dev-image.md
 * @public
 */

import Docker from "dockerode";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 10_000, hookTimeout: 15_000 });

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

  it("PNPM_STORE_DIR is set to /pnpm-store", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      "echo $PNPM_STORE_DIR"
    );

    expect(output.trim()).toBe("/pnpm-store");
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

  // Requires pnpm_store volume seeded with Cogni deps (task.0036).
  // Proves the full offline install pipeline: seeded store → pnpm install → real tool runs.
  it("offline install enables biome", async () => {
    const output = await execInContainer(
      docker,
      GATEWAY_CONTAINER,
      [
        "cp -r /repo/current/. /workspace/_offline_test",
        "cd /workspace/_offline_test",
        "pnpm install --offline --frozen-lockfile",
        "pnpm exec biome --version",
        'echo "BIOME_OK"',
      ].join(" && ")
    );

    expect(output).toContain("BIOME_OK");
  });
});
