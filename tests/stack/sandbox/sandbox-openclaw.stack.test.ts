// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/sandbox/sandbox-openclaw`
 * Purpose: Full-stack acceptance test proving OpenClaw runs in sandbox via SandboxRunnerAdapter.
 * Scope: Tests OpenClaw boot, LLM call via proxy, JSON envelope output, secrets isolation. Does not test billing DB writes.
 * Invariants:
 *   - Per SECRETS_HOST_ONLY: LITELLM_MASTER_KEY never enters sandbox container
 *   - Per LLM_VIA_SOCKET_ONLY: LLM access only via localhost:8080 -> socket -> proxy
 *   - Per NETWORK_DEFAULT_DENY: Container runs with network=none
 * Side-effects: IO (Docker containers, nginx proxy, filesystem)
 * Links: docs/spec/openclaw-sandbox-spec.md, src/adapters/server/sandbox/
 * @public
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// OpenClaw boot + LLM call(s) + teardown. Generous timeouts for multi-call agent.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });

import { SandboxRunnerAdapter } from "@/adapters/server/sandbox";
import type { SandboxProgramContract } from "@/ports";

import {
  assertLitellmReachable,
  cleanupOrphanedProxies,
  cleanupWorkspace,
  createWorkspace,
  ensureProxyImage,
  type SandboxTestContextWithProxy,
} from "../../_fixtures/sandbox/fixtures";

const OPENCLAW_IMAGE = "cogni-sandbox-openclaw:latest";

function uniqueRunId(prefix = "oc-test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Verify openclaw image exists */
async function assertOpenClawImageExists(docker: Docker): Promise<void> {
  try {
    await docker.getImage(OPENCLAW_IMAGE).inspect();
  } catch {
    throw new Error(
      `OpenClaw image ${OPENCLAW_IMAGE} not found. Build it first.`
    );
  }
}

let ctx: SandboxTestContextWithProxy | null = null;

// TODO: OpenClaw cold-boots in ~17s per run — must move to long-running container model.
// Deferred to a follow-up PR. See docs/spec/openclaw-sandbox-spec.md.
describe.skip("Sandbox OpenClaw Full-Stack", () => {
  const docker = new Docker();
  const litellmMasterKey = process.env.LITELLM_MASTER_KEY;

  beforeAll(async () => {
    await cleanupOrphanedProxies(docker);

    if (!litellmMasterKey) {
      console.warn(
        "SKIPPING: LITELLM_MASTER_KEY not set. Start dev stack with: pnpm dev:infra"
      );
      return;
    }

    await assertOpenClawImageExists(docker);
    await ensureProxyImage(docker);
    await assertLitellmReachable();

    ctx = {
      runner: new SandboxRunnerAdapter({
        litellmMasterKey,
      }),
      workspace: await createWorkspace("sandbox-openclaw"),
      docker,
      litellmMasterKey,
    };
  });

  afterAll(async () => {
    if (ctx?.runner) {
      await ctx.runner.dispose();
    }
    if (ctx?.workspace) {
      await cleanupWorkspace(ctx.workspace);
    }
    await cleanupOrphanedProxies(docker);
    ctx = null;
  });

  it("OpenClaw boots in sandbox and completes LLM call via proxy", async () => {
    if (!ctx) return;

    // Prepare workspace with OpenClaw config
    const openclawDir = path.join(ctx.workspace, ".openclaw");
    const stateDir = path.join(ctx.workspace, ".openclaw-state");
    const cogniDir = path.join(ctx.workspace, ".cogni");

    mkdirSync(openclawDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(cogniDir, { recursive: true });

    // Use test-model (routed to mock-openai-api via litellm.test.config.yaml)
    const config = {
      models: {
        mode: "replace",
        providers: {
          cogni: {
            baseUrl: "http://localhost:8080/v1",
            api: "openai-completions",
            apiKey: "proxy-handles-auth",
            models: [
              {
                id: "test-model",
                name: "Test Model",
                reasoning: false,
                input: ["text"],
                contextWindow: 200000,
                maxTokens: 8192,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
              },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: "cogni/test-model" },
          workspace: "/workspace",
          sandbox: { mode: "off" },
          skipBootstrap: true,
          timeoutSeconds: 25,
        },
        list: [{ id: "main", default: true, workspace: "/workspace" }],
      },
      tools: {
        elevated: { enabled: false },
        deny: [
          "group:web",
          "browser",
          "cron",
          "gateway",
          "nodes",
          "sessions_send",
          "sessions_spawn",
          "message",
        ],
      },
      cron: { enabled: false },
      gateway: { mode: "local" },
    };

    writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify(config, null, 2)
    );
    writeFileSync(
      path.join(cogniDir, "prompt.txt"),
      'Say "hello from sandbox" and nothing else.'
    );

    const cmd = [
      "node /app/dist/index.js agent --local --agent main",
      '--message "$(cat /workspace/.cogni/prompt.txt)"',
      "--json --timeout 25",
    ].join(" ");

    const result = await ctx.runner.runOnce({
      runId: uniqueRunId(),
      workspacePath: ctx.workspace,
      image: OPENCLAW_IMAGE,
      argv: [cmd],
      limits: { maxRuntimeSec: 30, maxMemoryMb: 512 },
      networkMode: { mode: "none" },
      llmProxy: {
        enabled: true,
        billingAccountId: "test-openclaw-billing",
        attempt: 0,
        env: {
          HOME: "/workspace",
          OPENCLAW_CONFIG_PATH: "/workspace/.openclaw/openclaw.json",
          OPENCLAW_STATE_DIR: "/workspace/.openclaw-state",
          OPENCLAW_LOAD_SHELL_ENV: "0",
        },
      },
    });

    // Container exited successfully
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    // Parse JSON envelope from stdout
    let envelope: SandboxProgramContract;
    try {
      envelope = JSON.parse(result.stdout.trim()) as SandboxProgramContract;
    } catch {
      throw new Error(
        `OpenClaw stdout is not valid JSON: ${result.stdout.slice(0, 300)}`
      );
    }

    // Response has payloads with text
    expect(envelope.payloads).toBeDefined();
    expect(envelope.payloads.length).toBeGreaterThan(0);
    expect(envelope.payloads[0]?.text).toBeTruthy();

    // No error in envelope
    expect(envelope.meta.error).toBeNull();

    // Timing metadata populated
    expect(envelope.meta.durationMs).toBeGreaterThan(0);
  });

  it("container env does not contain LITELLM_MASTER_KEY", async () => {
    if (!ctx) return;

    const cogniDir = path.join(ctx.workspace, ".cogni");
    mkdirSync(cogniDir, { recursive: true });

    const result = await ctx.runner.runOnce({
      runId: uniqueRunId("oc-secrets"),
      workspacePath: ctx.workspace,
      image: OPENCLAW_IMAGE,
      argv: [
        'env | grep -q LITELLM_MASTER_KEY && echo "LEAKED" || echo "SAFE"',
      ],
      limits: { maxRuntimeSec: 5, maxMemoryMb: 256 },
      networkMode: { mode: "none" },
      llmProxy: {
        enabled: true,
        billingAccountId: "test-openclaw-secrets",
        attempt: 0,
        env: {
          HOME: "/workspace",
          OPENCLAW_CONFIG_PATH: "/workspace/.openclaw/openclaw.json",
          OPENCLAW_STATE_DIR: "/workspace/.openclaw-state",
          OPENCLAW_LOAD_SHELL_ENV: "0",
        },
      },
    });

    expect(result.stdout).toContain("SAFE");
    expect(result.stdout).not.toContain("LEAKED");
  });
});
