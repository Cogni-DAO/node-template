// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/sandbox/sandbox-full-llm-roundtrip`
 * Purpose: Full-stack acceptance test proving sandbox LLM round-trip via proxy chain and mock-openai-api.
 * Scope: Tests complete LLM completion path from agent script through proxy to mock backend. Does not test billing DB writes or graph execution pipeline.
 * Invariants:
 *   - Per REAL_PROXY_MOCK_BACKEND: LiteLLM routes test models to mock-openai-api
 *   - Per SECRETS_HOST_ONLY: LITELLM_MASTER_KEY never enters sandbox container
 *   - Per HOST_INJECTS_BILLING_HEADER: Proxy injects x-litellm-end-user-id
 *   - Per LLM_VIA_SOCKET_ONLY: LLM access only via localhost:8080 -> socket -> proxy
 *   - Per PROXY_DRIVEN_BILLING: Billing data (callId + cost) captured from proxy audit log, not agent stdout
 * Side-effects: IO (Docker containers, nginx proxy, filesystem)
 * Links: docs/SANDBOXED_AGENTS.md, docs/SYSTEM_TEST_ARCHITECTURE.md
 * @public
 */

import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Full proxy+sandbox+LLM round-trip: proxy start (~1s) + LLM call (~1-2s) + teardown.
// 10s per test is generous; 15s for hooks (multiple container operations).
vi.setConfig({ testTimeout: 10_000, hookTimeout: 15_000 });

import { SandboxRunnerAdapter } from "@/adapters/server/sandbox";

import {
  assertLitellmReachable,
  assertSandboxImageExists,
  cleanupOrphanedProxies,
  cleanupWorkspace,
  createWorkspace,
  ensureProxyImage,
  runAgentWithLlm,
  SANDBOX_TEST_MODELS,
  type SandboxTestContextWithProxy,
} from "../../_fixtures/sandbox/fixtures";

let ctx: SandboxTestContextWithProxy | null = null;

describe("Sandbox Full-Stack LLM Round-Trip", () => {
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

    await assertSandboxImageExists(docker);
    await ensureProxyImage(docker);
    await assertLitellmReachable();

    ctx = {
      runner: new SandboxRunnerAdapter({
        litellmMasterKey,
      }),
      workspace: await createWorkspace("sandbox-full-llm"),
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

  // ───────────────────────────────────────────────────────────────────────────
  // Full LLM Round-Trip
  // ───────────────────────────────────────────────────────────────────────────

  it("completes LLM round-trip: sandbox → proxy → LiteLLM → mock-openai-api", async () => {
    if (!ctx) return;

    const { result, envelope } = await runAgentWithLlm(ctx, {
      messages: [{ role: "user", content: "Say hello." }],
      model: SANDBOX_TEST_MODELS.default,
    });

    // Container exited successfully
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    // Response content: mock-openai-api returns canned non-empty content
    expect(envelope.payloads).toHaveLength(1);
    expect(envelope.payloads[0]?.text).toBeTruthy();

    // No error in envelope
    expect(envelope.meta.error).toBeNull();

    // Timing metadata populated
    expect(envelope.meta.durationMs).toBeGreaterThan(0);

    // CRITICAL: Proxy-driven billing — host-side proxy audit log captures
    // x-litellm-call-id and x-litellm-response-cost from LiteLLM responses.
    // SandboxGraphProvider uses these to emit usage_report events with costUsd.
    // This proves the full billing chain without depending on agent stdout.
    expect(result.proxyBillingEntries).toBeDefined();
    expect(result.proxyBillingEntries!.length).toBe(1); // run.mjs makes exactly 1 LLM call
    expect(result.proxyBillingEntries![0]!.litellmCallId).toBeTruthy();
    // Cost should be present (mock-openai-api + litellm test config has input/output costs)
    expect(typeof result.proxyBillingEntries![0]!.costUsd).toBe("number");
    expect(result.proxyBillingEntries![0]!.costUsd).toBeGreaterThan(0);
  });
});
