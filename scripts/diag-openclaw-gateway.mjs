#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/diag-openclaw-gateway`
 * Purpose: Diagnostic script for OpenClaw gateway WS protocol. Logs every frame raw after handshake to capture exact payload shapes, especially the authoritative second res frame.
 * Scope: Standalone diagnostic; not imported by src/. Requires openclaw-gateway container running.
 * Invariants: none (standalone diagnostic)
 * Side-effects: IO (WebSocket connection to gateway)
 * Links: docs/research/openclaw-gateway-integration-handoff.md
 */

import WebSocket from "ws";

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:3333";
const GATEWAY_TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN || "openclaw-internal-token";

const t0 = Date.now();
function ts() {
  return `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
}

console.log(`${ts()} Connecting to ${GATEWAY_URL}`);

const ws = new WebSocket(GATEWAY_URL);
let nextId = 0;
const allocId = () => String(++nextId);
let handshakeComplete = false;
let agentRequestId = null;

// Protocol state machine phases
let phase = "init"; // init → accepted → streaming → chat_final_signal → final_res → done

const timer = setTimeout(() => {
  console.log(`${ts()} TIMEOUT (60s)`);
  console.log(`${ts()} Final phase: ${phase}`);
  ws.close();
  process.exit(1);
}, 60_000);

ws.on("error", (err) => {
  console.log(`${ts()} WS ERROR: ${err.message}`);
  clearTimeout(timer);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`${ts()} WS CLOSED: code=${code} reason=${reason.toString()}`);
  console.log(`${ts()} Final phase: ${phase}`);
  clearTimeout(timer);
});

ws.on("message", (data) => {
  const raw = data.toString();
  const frame = JSON.parse(raw);

  if (!handshakeComplete) {
    if (frame.type === "event" && frame.event === "connect.challenge") {
      console.log(`${ts()} <- connect.challenge`);
      const connectFrame = {
        type: "req",
        id: allocId(),
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
          auth: { token: GATEWAY_TOKEN },
        },
      };
      console.log(`${ts()} -> connect`);
      ws.send(JSON.stringify(connectFrame));
      return;
    }

    if (frame.type === "res") {
      if (!frame.ok) {
        console.log(
          `${ts()} <- AUTH FAILED:`,
          JSON.stringify(frame.error, null, 2)
        );
        clearTimeout(timer);
        ws.close();
        return;
      }
      console.log(`${ts()} <- hello-ok (handshake complete)`);
      handshakeComplete = true;

      // Send agent request
      agentRequestId = allocId();
      const agentFrame = {
        type: "req",
        id: agentRequestId,
        method: "agent",
        params: {
          message: 'Say "hello from gateway" and nothing else.',
          agentId: "main",
          idempotencyKey: `diag-${Date.now()}`,
          sessionKey: `diag-${Date.now()}`,
        },
      };
      console.log(`${ts()} -> agent (id=${agentFrame.id})`);
      ws.send(JSON.stringify(agentFrame));
      return;
    }
    return;
  }

  // Post-handshake: log EVERY frame with full payload and phase tracking
  const label =
    frame.type === "res"
      ? `res (id=${frame.id} ok=${frame.ok})`
      : frame.type === "event"
        ? `event (${frame.event})`
        : `unknown (${frame.type})`;

  console.log(`\n${ts()} <- ${label}  [phase=${phase}]`);

  // For res frames with our agent request id, show detailed breakdown
  if (frame.type === "res" && frame.id === agentRequestId) {
    const payload = frame.payload;
    const status = payload?.status;
    console.log(`  status: ${status}`);

    if (status === "accepted") {
      phase = "accepted";
      console.log(`  runId: ${payload?.runId}`);
      console.log(
        `  *** ACK received — waiting for chat events + final res ***`
      );
    } else if (status === "ok") {
      phase = "final_res";
      console.log(`  summary: ${payload?.summary}`);
      console.log(
        `  result keys: ${payload?.result ? Object.keys(payload.result).join(", ") : "NONE"}`
      );
      if (payload?.result?.payloads) {
        console.log(`  payloads count: ${payload.result.payloads.length}`);
        for (let i = 0; i < payload.result.payloads.length; i++) {
          const p = payload.result.payloads[i];
          console.log(`  payload[${i}] keys: ${Object.keys(p).join(", ")}`);
          if (typeof p.text === "string") {
            const preview =
              p.text.length > 200 ? `${p.text.slice(0, 200)}...` : p.text;
            console.log(
              `  payload[${i}].text (${p.text.length} chars): ${preview}`
            );
          } else {
            console.log(
              `  payload[${i}].text: ${typeof p.text} (${JSON.stringify(p.text)})`
            );
          }
        }
      } else {
        console.log(`  *** NO result.payloads — dumping full payload: ***`);
        console.log(JSON.stringify(payload, null, 2));
      }
      if (payload?.result?.meta) {
        console.log(`  meta: ${JSON.stringify(payload.result.meta)}`);
      }

      console.log(
        `\n${ts()} *** AUTHORITATIVE FINAL RES — protocol complete ***`
      );
      phase = "done";
      clearTimeout(timer);
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 500);
    } else if (status === "error") {
      phase = "error";
      console.log(`  summary: ${payload?.summary}`);
      console.log(`  error: ${JSON.stringify(frame.error)}`);
      console.log(`\n${ts()} *** ERROR RES — protocol complete ***`);
      clearTimeout(timer);
      setTimeout(() => {
        ws.close();
        process.exit(1);
      }, 500);
    } else {
      console.log(`  *** UNEXPECTED status "${status}" — full payload: ***`);
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  // Chat events: show state and text extraction
  if (frame.type === "event" && frame.event === "chat") {
    const payload = frame.payload;
    const state = payload?.state;
    console.log(`  state: ${state}`);

    if (state === "delta") {
      phase = "streaming";
      const text = payload?.message?.content?.[0]?.text;
      const preview =
        text && text.length > 100 ? `${text.slice(0, 100)}...` : text;
      console.log(
        `  message.content[0].text (${text?.length ?? 0} chars): ${preview ?? "NONE"}`
      );
    } else if (state === "final") {
      const prevPhase = phase;
      phase = "chat_final_signal";
      const hasMessage = !!payload?.message;
      const text = payload?.message?.content?.[0]?.text;
      console.log(`  has message: ${hasMessage}`);
      if (text) {
        const preview = text.length > 100 ? `${text.slice(0, 100)}...` : text;
        console.log(
          `  message.content[0].text (${text.length} chars): ${preview}`
        );
      }
      console.log(
        `  *** chat_final is a SIGNAL, not terminal — waiting for final res ***`
      );
      console.log(`  (previous phase was: ${prevPhase})`);
    } else if (state === "error" || state === "aborted") {
      console.log(`  errorMessage: ${payload?.errorMessage}`);
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  // Other events: just dump them compactly
  if (frame.type === "event") {
    const payload = frame.payload;
    if (payload?.lifecycle) {
      console.log(`  lifecycle: ${payload.lifecycle}`);
    } else {
      // Compact dump for tick, agent events, etc.
      const compact = JSON.stringify(payload);
      if (compact.length < 200) {
        console.log(`  payload: ${compact}`);
      }
    }
  }
});
