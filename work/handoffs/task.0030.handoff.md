---
id: task.0030.handoff
type: handoff
work_item_id: task.0030
status: active
created: 2026-02-11
updated: 2026-02-11
branch: feat/thread-persistence
last_commit: 79e6094c
---

# Handoff: Thread Persistence P0

## Context

- The platform had **no server-side message persistence** — the client sent full conversation history on every request, allowing fabrication of assistant/tool messages
- P0 adds server-authoritative persistence: `ai_threads` table with `UIMessage[]` JSONB, tenant-scoped RLS, optimistic concurrency
- P0 is **backend-only** — the existing client transport (`useDataStreamRuntime` + `createAssistantStreamResponse`) is unchanged
- The route extracts the last user message, ignores client-supplied history, loads authoritative thread from DB
- **E2E tested via UI** — multi-turn persistence confirmed working; thread persists correctly across turns

## Current State

- **Done:** DB schema + migration — `packages/db-schema/src/ai-threads.ts` (`ae83835b`)
- **Done:** `ThreadPersistencePort` + `DrizzleThreadPersistenceAdapter` with optimistic concurrency (`fee4a7af`)
- **Done:** `uiMessagesToMessageDtos()` mapper + `maskMessagesForPersistence()` PII masking + 14 unit tests (`0664a08b`)
- **Done:** Route refactor — two-phase save, UIMessage accumulator, wire format unchanged (`40a88e5f`)
- **Done:** AI SDK 6 type fixes (`TextUIPart`/`DynamicToolUIPart`), contract test session mocks (`084d3b22`)
- **Done:** Multi-turn persistence stack test — proves DB round-trip + fabricated history ignored (`79e6094c`)
- **Done:** `pnpm check` passes (typecheck, lint, format, unit tests, contract tests, arch check)
- **Skipped:** `chat-tool-replay` stack tests — P0 ignores client-supplied history, these test P1 client replay (`4219fc31`)
- **Filed:** `bug.0033` — stream controller closed after finalization (pre-existing, not caused by P0) (`3895ba91`)
- **Not done:** Remaining 6 acceptance check tests (tool persistence, disconnect safety, tenant isolation, billing unchanged, messages-grow-only, thread limit)
- **Not done:** PR creation

## Decisions Made

- **Optimistic concurrency, NOT FOR UPDATE** — `saveThread()` checks `jsonb_array_length(messages) = expectedMessageCount`; on mismatch throws `ThreadConflictError`, caller retries once
- **Two-phase persist** — user message saved before graph execution, assistant message saved after pump; each guarded by optimistic check
- **UIMessage[] JSONB per thread** — not normalized rows; tool parts embedded in assistant message
- **AI SDK 6** — `ai@^6.0.79`; uses `TextUIPart`, `DynamicToolUIPart` from the `ai` package (not inline types)
- **stateKey: `nanoid(21)`** — validation tightened to `^[a-zA-Z0-9_-]{1,128}$` (removes `.` and `:`)
- **MAX_THREAD_MESSAGES = 200** — adapter rejects saves exceeding limit
- **Phase 2 persist is async** — runs inside `createAssistantStreamResponse` callback after stream pump; stack test uses `pollUntil()` to handle the race

## Next Actions

- [ ] Write remaining stack tests for spec acceptance checks (§ Acceptance Checks):
  - [x] Multi-turn persistence (`79e6094c`)
  - [x] Fabricated history ignored (covered by multi-turn test)
  - [ ] Tool persistence
  - [ ] Disconnect safety
  - [ ] Tenant isolation
  - [ ] Billing unchanged
  - [ ] Messages grow only (optimistic concurrency)
  - [ ] Thread message limit (MAX_THREAD_MESSAGES)
- [ ] Run `pnpm check:full` for CI-parity validation
- [ ] Create PR against `staging`
- [ ] Consider fixing `bug.0033` (controller-already-closed) before or alongside PR

## Risks / Gotchas

- **bug.0033**: `controller.enqueue()` after `createAssistantStreamResponse` closes the WritableStream produces unhandled `TypeError` on every request. Thread persistence works despite this — the bug is in the stream finalization path only. See `work/items/bug.0033.stream-controller-closed-after-finalization.md`.
- **Two-phase save means user message persists even if execution fails** — intentional (the user DID send it). Next load shows the user message without assistant response.
- **PII masking is best-effort regex** — stored content must still be treated as personal data.
- **Stack test depends on working LiteLLM mock** — the `test-model` LLM auth must work for the stream to complete and phase 2 persist to fire. If mock infra is broken, the test will fail at the poll timeout.
- **P0 does NOT use `convertToModelMessages()` or `createUIMessageStream()`** — those are P1.

## Pointers

| File / Resource                                                                                                                          | Why it matters                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                               | Canonical spec — invariants, schema, port, acceptance checks |
| [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)                                           | P0 task with deliverable checklist + scope boundaries        |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                               | Chat route — two-phase save, UIMessage accumulator           |
| [`src/ports/thread-persistence.port.ts`](../../src/ports/thread-persistence.port.ts)                                                     | Port interface + `ThreadConflictError`                       |
| [`src/adapters/server/ai/thread-persistence.adapter.ts`](../../src/adapters/server/ai/thread-persistence.adapter.ts)                     | Optimistic concurrency adapter                               |
| [`src/features/ai/services/mappers.ts`](../../src/features/ai/services/mappers.ts)                                                       | `uiMessagesToMessageDtos()` — UIMessage[] → MessageDto[]     |
| [`src/features/ai/services/pii-masking.ts`](../../src/features/ai/services/pii-masking.ts)                                               | `maskMessagesForPersistence()` — best-effort secret masking  |
| [`packages/db-schema/src/ai-threads.ts`](../../packages/db-schema/src/ai-threads.ts)                                                     | Drizzle schema for `ai_threads` table                        |
| [`tests/stack/ai/thread-persistence.stack.test.ts`](../../tests/stack/ai/thread-persistence.stack.test.ts)                               | Multi-turn persistence stack test (passing)                  |
| [`work/items/bug.0033.stream-controller-closed-after-finalization.md`](../items/bug.0033.stream-controller-closed-after-finalization.md) | Related bug — controller lifecycle issue                     |
