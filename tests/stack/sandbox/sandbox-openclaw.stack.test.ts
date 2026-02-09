// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/sandbox/sandbox-openclaw`
 * Purpose: Full-stack acceptance test proving OpenClaw gateway mode works end-to-end.
 * Scope: Tests gateway chat, session configuration, billing via proxy, and secrets isolation. Does not test ephemeral container path or billing DB writes.
 * Invariants:
 *   - Per SECRETS_HOST_ONLY: LITELLM_MASTER_KEY never enters gateway container
 *   - Per BILLING_INDEPENDENT_OF_CLIENT: billing data from proxy audit log, not agent
 * Side-effects: IO (HTTP to gateway, Docker exec for assertions)
 * Links: docs/spec/openclaw-sandbox-spec.md, src/adapters/server/sandbox/
 * @public
 */

import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Gateway + LLM round-trip. Generous timeout for first-call session creation.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 15_000 });

import { LlmProxyManager } from "@/adapters/server/sandbox";
import {
  type GatewayAgentEvent,
  OpenClawGatewayClient,
} from "@/adapters/server/sandbox/openclaw-gateway-client";
import { ProxyBillingReader } from "@/adapters/server/sandbox/proxy-billing-reader";

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:3333";
const GATEWAY_TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN ?? "openclaw-internal-token";
const GATEWAY_CONTAINER = "openclaw-gateway";
const PROXY_CONTAINER = "llm-proxy-openclaw";

function uniqueRunId(prefix = "gw-test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Collect all events from a gateway agent run into an array. */
async function collectEvents(
  gen: AsyncGenerator<GatewayAgentEvent>
): Promise<GatewayAgentEvent[]> {
  const events: GatewayAgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Check if a container exists and is running */
async function isContainerHealthy(
  docker: Docker,
  name: string
): Promise<boolean> {
  try {
    const container = docker.getContainer(name);
    const info = await container.inspect();
    return info.State.Running && info.State.Health?.Status === "healthy";
  } catch {
    return false;
  }
}

let client: OpenClawGatewayClient;
let billingReader: ProxyBillingReader;
let docker: Docker;
let skip = false;

describe("OpenClaw Gateway Full-Stack", () => {
  beforeAll(async () => {
    docker = new Docker();

    // Check if gateway and proxy containers are running
    const [gatewayOk, proxyOk] = await Promise.all([
      isContainerHealthy(docker, GATEWAY_CONTAINER),
      isContainerHealthy(docker, PROXY_CONTAINER),
    ]);

    if (!gatewayOk || !proxyOk) {
      console.warn(
        `SKIPPING: OpenClaw gateway containers not running. ` +
          `Start with: pnpm sandbox:openclaw:up\n` +
          `  ${GATEWAY_CONTAINER}: ${gatewayOk ? "healthy" : "not found/unhealthy"}\n` +
          `  ${PROXY_CONTAINER}: ${proxyOk ? "healthy" : "not found/unhealthy"}`
      );
      skip = true;
      return;
    }

    client = new OpenClawGatewayClient(GATEWAY_URL, GATEWAY_TOKEN);
    billingReader = new ProxyBillingReader(docker, PROXY_CONTAINER);
  });

  afterAll(async () => {
    // Clean up any orphaned per-run proxy containers (from other test suites)
    if (docker) {
      await LlmProxyManager.cleanupSweep(docker).catch(() => {});
    }
  });

  it("gateway responds to agent call via WS", async () => {
    if (skip) return;

    const runId = uniqueRunId();
    const sessionKey = `agent:main:test-billing:${runId}`;

    // Run agent and collect typed events
    const events = await collectEvents(
      client.runAgent({
        message: 'Say "hello from gateway" and nothing else.',
        sessionKey,
        outboundHeaders: {
          "x-litellm-end-user-id": "test-billing",
          "x-litellm-spend-logs-metadata": JSON.stringify({
            run_id: runId,
            graph_id: "sandbox:openclaw",
          }),
          "x-cogni-run-id": runId,
        },
        timeoutMs: 45_000,
      })
    );

    // Must receive chat_final with real text content
    const chatFinal = events.find((e) => e.type === "chat_final");
    expect(chatFinal).toBeDefined();
    expect(chatFinal?.text.length).toBeGreaterThan(0);
    // Content must NOT be the stringified ACK payload
    expect(chatFinal?.text).not.toMatch(/"status"\s*:\s*"accepted"/);
  });

  it("billing entries appear in proxy audit log after call", async () => {
    if (skip) return;

    const runId = uniqueRunId("billing");
    const sessionKey = `agent:main:test-billing:${runId}`;

    // Run agent call (drain all events)
    await collectEvents(
      client.runAgent({
        message: "Hello",
        sessionKey,
        outboundHeaders: {
          "x-litellm-end-user-id": "test-billing",
          "x-litellm-spend-logs-metadata": JSON.stringify({
            run_id: runId,
            graph_id: "sandbox:openclaw",
          }),
          "x-cogni-run-id": runId,
        },
        timeoutMs: 45_000,
      })
    );

    // Wait for audit log flush
    await new Promise((r) => setTimeout(r, 1000));

    // Read billing entries
    const entries = await billingReader.readEntries(runId);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.litellmCallId).toBeTruthy();
  });

  it("gateway container does not have LITELLM_MASTER_KEY in env", async () => {
    if (skip) return;

    const container = docker.getContainer(GATEWAY_CONTAINER);
    const exec = await container.exec({
      Cmd: [
        "sh",
        "-c",
        'env | grep -q LITELLM_MASTER_KEY && echo "LEAKED" || echo "SAFE"',
      ],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        stream.destroy();
        resolve();
      }, 5000);
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

    const raw = Buffer.concat(chunks);
    // Demux Docker stream (hijack mode wraps output in 8-byte frame headers)
    const output = LlmProxyManager.demuxDockerStream(raw);

    expect(output).toContain("SAFE");
    expect(output).not.toContain("LEAKED");
  });
});
