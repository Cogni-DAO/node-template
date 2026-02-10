---
id: openclaw-streaming-truncation-handoff-v2
type: research
title: "Handoff v2: SSE Route Reconciliation — assistant_final Fix for Streaming Truncation"
status: active
trust: reviewed
verified: 2026-02-10
summary: Root cause identified and partially fixed. The SSE route ignored assistant_final events, so truncated deltas were never recovered. Fix applied but needs real-stack validation.
read_when: Continuing work on bug.0011 streaming truncation on feat/concurrent-openclaw branch
owner: derekg1729
created: 2026-02-10
tags: [sandbox, openclaw, gateway, streaming, handoff, sse, assistant_final]
---

# Handoff v2: SSE Route Reconciliation for Streaming Truncation

**Branch:** `feat/concurrent-openclaw`
**Previous handoff:** `docs/research/openclaw-streaming-truncation-handoff.md` (read that first for full context)
**Date:** 2026-02-10

## What Changed This Session

### Root Cause Identified

The streaming truncation bug (bug.0011) has a clear server-side root cause in `src/app/api/v1/ai/chat/route.ts`.

**The `for await` loop that processes AiEvents (lines 466-530) handled `text_delta` and `tool_call_*` events but completely ignored `assistant_final`.** The authoritative full text from the gateway was silently dropped. When any `text_delta` was lost (gateway multi-turn accumulated text reset, WS frame drops), the text was permanently truncated with no recovery.

This is the streaming chain:

```
SandboxGraphProvider.createGatewayExecution()
  yields: text_delta*, assistant_final, usage_report*, done
    ↓
RunEventRelay (ai_runtime.ts)
  filters: usage_report (to billing subscriber)
  passes: text_delta, assistant_final, done → uiStream()
    ↓
route.ts for-await loop
  text_delta → controller.appendText()     ✅ handled
  assistant_final → **SILENTLY DROPPED**   ❌ was the bug
  tool_call_* → controller tool methods    ✅ handled
  done → falls through                     (ok, loop exits when iterator ends)
    ↓
assistant-stream → Data Stream Protocol SSE → browser
```

**Why LangGraph inproc doesn't truncate:** The LangGraph SDK streams reliably — each chunk from the LLM produces one `text_delta`, all arrive in order. The `assistant_final` event is redundant (accumulated deltas == final text). No reconciliation needed.

**Why gateway truncates:** The gateway client uses diff-based delta streaming (`openclaw-gateway-client.ts:282-295`). Each WS `chat` delta carries the full accumulated text; the client diffs against `prevText`. When the agent does multi-turn LLM calls (nemotron does chain-of-thought → 4 billing entries), the accumulated text resets between turns, triggering the regression guard that resets `prevText=""`. This can cause text content to be lost across turn boundaries.

### Fix Applied (uncommitted)

**File:** `src/app/api/v1/ai/chat/route.ts` (lines 461-568)

Added:

1. **Tracking variables:** `accumulatedText`, `assistantFinalContent`, `eventSeq`
2. **`assistant_final` handler:** Captures `event.content` and logs receipt
3. **Reconciliation block** (after the for-await loop, before `message-finish`):
   - If `assistantFinalContent` is longer than `accumulatedText` AND starts with it → `controller.appendText(remainder)` fills the gap
   - If content diverges (multi-turn chain-of-thought) → logs warning for diagnostics

### Test Written (needs work)

**File:** `tests/contract/app/ai.chat.sse-reconciliation.test.ts`

A contract-level test that mocks `completionStream` with a synthetic `AsyncIterable<AiEvent>` and verifies SSE output. Uses the existing `readDataStreamEvents` helper from `tests/helpers/data-stream.ts`.

**Status:** 5/6 tests pass. The "zero deltas" edge case fails due to a test-infrastructure timing issue: `createAssistantStreamResponse` (assistant-stream package) has ReadableStream backpressure behavior where synchronous writes don't flush before the stream closes. Real streams have I/O delays so this doesn't happen in production. The test needs the synthetic stream to yield to the macrotask queue (`setTimeout(0)`) between events to simulate real async behavior. The zero-delta case has no preceding yields from delta events, so the reconciliation text never gets flushed.

**Important realization from testing:** The same ReadableStream backpressure issue that causes the test to fail may also contribute to production truncation. If the gateway yields events very fast (all WS frames arrive in one burst), the `for await` loop processes everything quickly, and `controller.appendText()` calls may not all flush to the SSE response before the stream closes. This needs investigation with real gateway traffic — add `await new Promise(r => setTimeout(r, 0))` after the reconciliation `controller.appendText()` and see if it helps.

## What Needs to Happen Next

### 1. Validate the route.ts fix with real gateway traffic

The reconciliation logic is applied but untested with real models. Steps:

- Start the gateway stack (`pnpm sandbox:openclaw:up`)
- Send a chat message via the UI using `sandbox:openclaw` graph
- Check server logs for `ai.chat_assistant_final_received` and `ai.chat_reconcile_appending_remainder`
- Verify UI shows full text matching `OPENCLAW_RAW_STREAM` output

### 2. Investigate whether the reconciliation is sufficient

The reconciliation only works if `assistantFinalContent.startsWith(accumulatedText)` — i.e., the accumulated deltas are a prefix of the final text. If the gateway's multi-turn diff logic causes non-prefix divergence, the reconciliation will log a warning but won't fix the text. In that case, the fix needs to be in the gateway client's delta logic itself.

### 3. Fix the contract test zero-delta case

Either add a macrotask yield after `controller.appendText(remainder)` in route.ts (which would also help production), or accept the zero-delta case as an unreachable edge case for gateway (gateway always has at least some deltas).

### 4. Consider a deeper fix: flush guarantee in route.ts

The `controller.appendText()` in assistant-stream may not guarantee immediate delivery to the SSE response. After reconciliation, adding a macrotask yield before `controller.enqueue({ type: "message-finish" })` could ensure the reconciliation text is flushed. This is worth testing.

## Key Files (Updated)

| File                                                     | What Changed                                  | Purpose                                                                               |
| -------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/app/api/v1/ai/chat/route.ts`                        | **MODIFIED** — assistant_final reconciliation | SSE route handler. The for-await loop + reconciliation block at lines 461-568         |
| `tests/contract/app/ai.chat.sse-reconciliation.test.ts`  | **NEW**                                       | Contract test with synthetic AiEvent streams (5/6 passing)                            |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts` | Unchanged (has prior WS close fix)            | WS protocol client. `runAgent()` diff-based delta streaming at lines 282-295          |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`  | Unchanged                                     | `createGatewayExecution()` at line 366. Yields text_delta then assistant_final        |
| `src/features/ai/services/ai_runtime.ts`                 | Unchanged                                     | `RunEventRelay` at line 184. Filters usage_report, passes assistant_final to uiStream |
| `packages/ai-core/src/events/ai-events.ts`               | Unchanged                                     | `AssistantFinalEvent` type definition at line 82                                      |
| `tests/helpers/data-stream.ts`                           | Unchanged                                     | Data Stream Protocol parser for tests                                                 |

## Uncommitted Changes Summary

```
src/app/api/v1/ai/chat/route.ts                          — assistant_final reconciliation (THE FIX)
tests/contract/app/ai.chat.sse-reconciliation.test.ts     — synthetic SSE contract test (NEW)
docs/research/openclaw-streaming-truncation-handoff-v2.md — this handoff (NEW)
+ all prior uncommitted changes from v1 handoff (nginx, gateway client, docs)
```
