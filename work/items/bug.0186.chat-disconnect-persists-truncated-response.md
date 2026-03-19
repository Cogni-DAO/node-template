---
id: bug.0186
type: bug
title: "Chat disconnect persists truncated assistant response — browser close mid-stream saves partial text"
status: needs_triage
priority: 0
rank: 99
estimate: 2
summary: When the browser closes mid-stream, the chat route persists whatever text has accumulated so far instead of the complete response. The execution finishes in Temporal but the full assistant_final never reaches the persistence accumulator.
outcome: Browser disconnect mid-stream persists the complete assistant response (or no response, with a retry on next load)
spec_refs:
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-19
updated: 2026-03-19
labels:
  - ai-graphs
  - p0
external_refs:
---

# Chat disconnect persists truncated assistant response

## Observed

When a user closes the browser mid-stream (or navigates away), the chat route saves a **truncated** assistant message to the thread. Reopening the conversation shows a cut-off response (e.g., a poem that stops mid-stanza).

The execution itself completes successfully — Temporal drives the run to completion, the internal API route drains the full stream to Redis, and `assistant_final` is published. But the chat route's consumer never reads it.

## Root Cause

Three-link chain:

1. **`apps/web/src/app/api/v1/ai/chat/route.ts:315`** — passes `request.signal` as `abortSignal` to the facade
2. **`apps/web/src/app/_facades/ai/completion.server.ts:377-378`** — passes that signal directly to `runStream.subscribe(runId, signal)`
3. **`apps/web/src/adapters/server/ai/redis-run-stream.adapter.ts:100`** — subscription terminates when signal fires: `while (!signal.aborted)`

Browser disconnect → `request.signal` aborts → Redis subscription dies → `for await` loop exits early → `accumulatedText` has partial content, `assistantFinalContent` is undefined → Phase 2 persistence (`route.ts:575`) saves truncated text.

The comment at `route.ts:573` ("Detached from stream lifecycle — client disconnect cannot prevent this") is incorrect. Phase 2 runs, but persists whatever the accumulator collected before abort — which is partial.

## Expected

Browser disconnect mid-stream persists the complete assistant response. The accumulator drains the full Redis stream independently of client connection.

## Reproduction

1. `pnpm dev:stack`
2. Open chat, send a message requesting a long response ("write 30 stanzas")
3. While streaming, close the browser tab
4. Reopen the app, navigate to the same thread
5. Observe: assistant response truncated at the point of disconnect

## Impact

Every user who navigates away during a streaming response gets a permanently truncated conversation. The run completed and was billed, but the user never sees the full output. Only recovery is re-sending (costs credits again).

## Fix Direction

Decouple the Redis subscription's abort signal from `request.signal`:

1. **Route:** Create a separate `AbortController` for the subscription. Pass its signal (not `request.signal`) to `completionStream()`. Abort only after stream naturally completes or timeout.
2. **Route:** In the `for await` loop, stop writing to the SSE writer on `request.signal.aborted`, but continue reading and accumulating.

Complexity: accumulator and SSE writer logic are interleaved in one loop (`route.ts:359-505`). Refactor separates "read + accumulate" from "write to client."

## Allowed Changes

- `apps/web/src/app/api/v1/ai/chat/route.ts` — decouple subscription signal from request signal
- `apps/web/src/app/_facades/ai/completion.server.ts` — if signal handling changes needed at facade level
- Tests

## Plan

- [ ] Decouple subscription abort from request abort
- [ ] Keep accumulator draining after client disconnect
- [ ] Guard SSE writer calls with `request.signal.aborted` check
- [ ] Test: disconnect mid-stream → verify full response persisted

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** Existing tests pass. New test verifies complete persistence after disconnect.

## Review Checklist

- [ ] **Work Item:** bug.0186 linked in PR body
- [ ] **Spec:** PERSIST_AFTER_PUMP invariant actually holds after disconnect
- [ ] **Tests:** disconnect + full persistence test
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
