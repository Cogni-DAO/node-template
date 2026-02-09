// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/openclaw-gateway-client`
 * Purpose: WebSocket client for OpenClaw gateway protocol (custom frame format, not JSON-RPC).
 * Scope: Connects to gateway, sends agent calls with outboundHeaders for billing. Does not manage containers.
 * Invariants:
 *   - Per BILLING_INDEPENDENT_OF_CLIENT: billing headers passed as outboundHeaders per agent call
 *   - Per SECRETS_HOST_ONLY: no LiteLLM keys ever sent to gateway
 *   - Frame format: { type: "req"|"res"|"event", id, method, params } (NOT JSON-RPC 2.0)
 *   - Handshake: challenge → connect(auth) → hello-ok (3-step)
 * Side-effects: IO (WebSocket connections to gateway)
 * Links: docs/research/openclaw-gateway-integration-handoff.md, docs/spec/openclaw-sandbox-spec.md
 * @internal
 */

import type { Logger } from "pino";
import WebSocket from "ws";

import { makeLogger } from "@/shared/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Protocol types (subset of OpenClaw gateway protocol)
// ─────────────────────────────────────────────────────────────────────────────

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
}

interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
}

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

/** Result of a gateway agent call */
export interface GatewayChatResult {
  content: string;
  model: string;
  raw: unknown;
}

/**
 * WebSocket client for the OpenClaw gateway.
 *
 * Uses the OpenClaw custom frame protocol (NOT JSON-RPC 2.0):
 * - Request: { type: "req", id, method, params }
 * - Response: { type: "res", id, ok, payload/error }
 * - Event: { type: "event", event, payload }
 *
 * Each call opens a new WS connection, performs the 3-step handshake,
 * sends the agent request, waits for the response, and closes.
 * This is safe for concurrent use (one connection per call).
 */
export class OpenClawGatewayClient {
  private readonly log: Logger;

  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string
  ) {
    this.log = makeLogger({ component: "OpenClawGatewayClient" });
  }

  /**
   * Send a message to the gateway agent via WebSocket.
   * Opens a connection, performs handshake, sends agent call with
   * outboundHeaders for billing, waits for response, and closes.
   *
   * @param opts.message - The user message to send
   * @param opts.sessionKey - Session key for billing isolation
   * @param opts.outboundHeaders - Headers OpenClaw includes on outbound LLM calls
   * @param opts.timeoutMs - Total timeout for the operation (default: 120s)
   */
  async chat(opts: {
    message: string;
    sessionKey?: string;
    outboundHeaders?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<GatewayChatResult> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const wsUrl = this.gatewayUrl.replace(/^http/, "ws");

    this.log.debug(
      { sessionKey: opts.sessionKey, hasHeaders: !!opts.outboundHeaders },
      "Starting gateway agent call"
    );

    return new Promise<GatewayChatResult>((resolve, reject) => {
      let nextId = 0;
      const allocId = () => String(++nextId);
      let handshakeComplete = false;
      let agentRequestId: string | null = null;

      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Gateway call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };

      ws.on("error", (err) => {
        cleanup();
        reject(new Error(`Gateway WebSocket error: ${err.message}`));
      });

      ws.on("close", () => {
        // Only reject if we haven't resolved yet
        clearTimeout(timer);
      });

      ws.on("message", (data: WebSocket.RawData) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(data.toString()) as GatewayFrame;
        } catch {
          cleanup();
          reject(new Error("Failed to parse gateway frame"));
          return;
        }

        // ── Handshake phase ──
        if (!handshakeComplete) {
          // Step 1: Server sends connect.challenge
          if (frame.type === "event" && frame.event === "connect.challenge") {
            // Step 2: Reply with connect request
            const connectId = allocId();
            ws.send(
              JSON.stringify({
                type: "req",
                id: connectId,
                method: "connect",
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: "gateway-client",
                    version: "1.0.0",
                    platform: "node",
                    mode: "backend",
                  },
                  auth: { token: this.token },
                },
              })
            );
            return;
          }

          // Step 3: Server responds with hello-ok
          if (frame.type === "res") {
            if (!frame.ok) {
              cleanup();
              reject(
                new Error(
                  `Gateway auth failed: ${frame.error?.message ?? "unknown"}`
                )
              );
              return;
            }

            handshakeComplete = true;

            // Send agent call
            agentRequestId = allocId();
            const params: Record<string, unknown> = {
              message: opts.message,
              agentId: "main",
              idempotencyKey: `cogni-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            };
            if (opts.sessionKey) params.sessionKey = opts.sessionKey;
            if (opts.outboundHeaders)
              params.outboundHeaders = opts.outboundHeaders;

            ws.send(
              JSON.stringify({
                type: "req",
                id: agentRequestId,
                method: "agent",
                params,
              })
            );
            return;
          }

          // Ignore other events during handshake (tick, etc.)
          return;
        }

        // ── Post-handshake: waiting for agent response ──
        if (frame.type === "res" && frame.id === agentRequestId) {
          cleanup();
          if (!frame.ok) {
            reject(
              new Error(
                `Gateway agent call failed: ${frame.error?.message ?? "unknown"}`
              )
            );
            return;
          }

          // Extract content from agent response payload
          const payload = frame.payload as Record<string, unknown> | undefined;
          const content = this.extractContent(payload);

          resolve({
            content,
            model: (payload?.model as string) ?? "",
            raw: payload,
          });
        }

        // Ignore events during agent execution (tick, progress, etc.)
      });
    });
  }

  /**
   * Configure per-session outbound headers via WS sessions.patch.
   * Opens a connection, performs handshake, sends patch, closes.
   */
  async configureSession(
    sessionKey: string,
    outboundHeaders: Record<string, string>
  ): Promise<void> {
    const wsUrl = this.gatewayUrl.replace(/^http/, "ws");
    this.log.debug(
      { sessionKey, headerCount: Object.keys(outboundHeaders).length },
      "Configuring session outbound headers"
    );

    return new Promise<void>((resolve, reject) => {
      let nextId = 0;
      const allocId = () => String(++nextId);
      let handshakeComplete = false;

      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Session patch timed out"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timer);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };

      ws.on("error", (err) => {
        cleanup();
        reject(new Error(`Gateway WS error: ${err.message}`));
      });

      ws.on("close", () => {
        clearTimeout(timer);
      });

      ws.on("message", (data: WebSocket.RawData) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(data.toString()) as GatewayFrame;
        } catch {
          cleanup();
          reject(new Error("Failed to parse gateway frame"));
          return;
        }

        if (!handshakeComplete) {
          if (frame.type === "event" && frame.event === "connect.challenge") {
            const connectId = allocId();
            ws.send(
              JSON.stringify({
                type: "req",
                id: connectId,
                method: "connect",
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: "gateway-client",
                    version: "1.0.0",
                    platform: "node",
                    mode: "backend",
                  },
                  auth: { token: this.token },
                },
              })
            );
            return;
          }

          if (frame.type === "res") {
            if (!frame.ok) {
              cleanup();
              reject(
                new Error(
                  `Gateway auth failed: ${frame.error?.message ?? "unknown"}`
                )
              );
              return;
            }

            handshakeComplete = true;

            // Send sessions.patch — uses `key` not `sessionKey`
            const patchId = allocId();
            ws.send(
              JSON.stringify({
                type: "req",
                id: patchId,
                method: "sessions.patch",
                params: { key: sessionKey, outboundHeaders },
              })
            );
            return;
          }
          return;
        }

        // Post-handshake: waiting for patch response
        if (frame.type === "res") {
          cleanup();
          if (!frame.ok) {
            reject(
              new Error(
                `sessions.patch failed: ${frame.error?.message ?? "unknown"}`
              )
            );
            return;
          }
          resolve();
        }
      });
    });
  }

  /**
   * Extract text content from agent response payload.
   * Agent response can have various shapes depending on the agent type.
   */
  private extractContent(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";

    const p = payload as Record<string, unknown>;

    // Direct text/content field
    if (typeof p.text === "string") return p.text;
    if (typeof p.content === "string") return p.content;

    // Nested in response/result
    if (p.response && typeof p.response === "object") {
      const r = p.response as Record<string, unknown>;
      if (typeof r.text === "string") return r.text;
      if (typeof r.content === "string") return r.content;
    }

    // Payloads array (SandboxProgramContract shape)
    if (Array.isArray(p.payloads) && p.payloads.length > 0) {
      const first = p.payloads[0] as Record<string, unknown>;
      if (typeof first?.text === "string") return first.text;
    }

    // Fallback: stringify
    return JSON.stringify(payload);
  }
}
