---
id: bug.0011
type: bug
title: "Gateway streaming truncates output mid-sentence in UI"
status: Backlog
priority: 1
estimate: 1
summary: Real model responses via the OpenClaw gateway are truncated mid-sentence when displayed in the Cogni chat UI. Example — nemotron returns full content in raw stream but UI renders "Just let me know what you'd like to dive into, and I" then stops.
outcome: Full streaming content renders in UI without truncation
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [openclaw, gateway, streaming, ui]
external_refs:
assignees: derekg1729
credit:
---

# Gateway streaming truncates output mid-sentence in UI

## Observed

With a real model (nemotron-nano-30b) producing content through the gateway, the UI truncates the response mid-sentence:

> "Just let me know what you'd like to dive into, and I" (nothing after)

The OPENCLAW_RAW_STREAM log shows full content with `text_end` and `assistant_message_end` events, and `curl` returns the complete response. So the content exists — it's being dropped somewhere in the UI rendering pipeline.

## Suspected layers

1. **WS text_delta → AiEvent mapping** in `SandboxGraphProvider.createGatewayExecution()` — could be dropping the final chunk(s)
2. **Chat final event content extraction** — `extractTextFromResult()` might truncate
3. **UI streaming renderer** — React state update race on the final delta
4. **Backpressure** — AsyncGenerator consumer not draining fast enough, missing tail events

## Reproduction

1. Start full dev stack with real model configured: `"primary": "cogni/nemotron-nano-30b"`
2. Open Cogni chat UI
3. Select OpenClaw agent, send a message that produces a paragraph+ response
4. Observe truncation mid-sentence

## Plan

- [ ] Compare curl output vs UI output for same prompt
- [ ] Check `OPENCLAW_RAW_STREAM` `text_end` event content vs what `chat_final` event delivers
- [ ] Instrument `createGatewayExecution()` to log each yielded AiEvent
- [ ] Check if the generator's `return()` is called prematurely by the consumer

## Validation

Send a paragraph-length prompt through the gateway and confirm the full response renders in the UI without truncation.

## PR / Links

- Related: task.0008, bug.0009
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
