---
id: task.0030.handoff
type: handoff
work_item_id: task.0030
status: active
created: 2026-02-11
updated: 2026-02-11
branch: feat/thread-persistence
last_commit: 40a88e5f
---

# Handoff: Thread Persistence P0

## Context

- The platform had **no server-side message persistence** — the client sent full conversation history on every request, allowing fabrication of assistant/tool messages
- P0 adds server-authoritative persistence: `ai_threads` table with `UIMessage[]` JSONB, tenant-scoped RLS, optimistic concurrency
- P0 is **backend-only** — the existing client transport (`useDataStreamRuntime` + `createAssistantStreamResponse`) is completely unchanged
- The route now extracts the last user message, ignores client history, loads authoritative thread from DB

## Current State

- **Done:** DB schema + migration — `packages/db-schema/src/ai-threads.ts`, commit `ae83835b`
- **Done:** `ThreadPersistencePort` + `DrizzleThreadPersistenceAdapter` with optimistic concurrency (`expectedMessageCount` guard), commit `fee4a7af`
- **Done:** `uiMessagesToMessageDtos()` mapper + `maskMessagesForPersistence()` PII masking + 14 unit tests, commit `0664a08b`
- **Done:** Route refactor with two-phase save (user before execute, assistant after pump), UIMessage accumulator, wire format unchanged, commit `40a88e5f`
- **Not done:** Stack/integration tests for spec acceptance checks (8 checks in spec)
- **Not done:** Handoff doc updates, PR creation

## Decisions Made

- **Optimistic concurrency, NOT FOR UPDATE** — `saveThread()` checks `jsonb_array_length(messages) = expectedMessageCount`; on mismatch throws `ThreadConflictError`, caller retries once then 409
- **Two-phase persist** — user message saved before graph execution, assistant message saved after pump completes; each guarded by optimistic check
- **UIMessage[] JSONB per thread** — not normalized rows; tool parts embedded in assistant message
- **P0 wire format: KEEP `createAssistantStreamResponse`** — UIMessage accumulator runs in parallel for persistence only
- **P0 message conversion: KEEP `toCoreMessages()` pipeline** — `uiMessagesToMessageDtos()` bridges UIMessage[] → MessageDto[] for existing facade
- **stateKey: `nanoid(21)`**, validation tightened to `^[a-zA-Z0-9_-]{1,128}$` (breaking: removes `.` and `:`)
- **MAX_THREAD_MESSAGES = 200** — adapter rejects saves exceeding limit

## Next Actions

- [ ] Write stack tests for all 8 acceptance checks (spec `docs/spec/thread-persistence.md` § Acceptance Checks):
  1. Multi-turn persistence
  2. Fabricated history ignored
  3. Tool persistence
  4. Disconnect safety
  5. Tenant isolation
  6. Billing unchanged
  7. Messages grow only (via optimistic concurrency)
  8. Thread message limit (MAX_THREAD_MESSAGES)
- [ ] Run `pnpm check:full` for CI-parity validation
- [ ] Create PR against `staging`

## Risks / Gotchas

- **P0 does NOT use `convertToModelMessages()` or `createUIMessageStream()`** — those are P1. The existing `toCoreMessages()` pipeline and `createAssistantStreamResponse` wire format are preserved.
- **Two-phase save means user message is persisted even if execution fails** — this is intentional (the user DID send the message). On the next load, the thread will have the user message without an assistant response.
- **PII masking is best-effort regex** — stored content must still be treated as personal data
- Persistence happens inside the `createAssistantStreamResponse` callback — if phase 2 save fails, the HTTP response has already started streaming (can't return 409). Errors are logged, not surfaced to client.
- The `uiMessagesToMessageDtos()` mapper uses `type: "dynamic-tool"` which is the correct AI SDK 6 type name for `DynamicToolUIPart`

## Pointers

| File / Resource                                                                                                      | Why it matters                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                           | Canonical spec — invariants, schema, port interface, acceptance checks |
| [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)                       | P0 task with full deliverable checklist                                |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                           | Chat route — two-phase save, UIMessage accumulator                     |
| [`src/ports/thread-persistence.port.ts`](../../src/ports/thread-persistence.port.ts)                                 | Port interface + `ThreadConflictError`                                 |
| [`src/adapters/server/ai/thread-persistence.adapter.ts`](../../src/adapters/server/ai/thread-persistence.adapter.ts) | Optimistic concurrency adapter                                         |
| [`src/features/ai/services/mappers.ts`](../../src/features/ai/services/mappers.ts)                                   | `uiMessagesToMessageDtos()` — UIMessage[] → MessageDto[]               |
| [`src/features/ai/services/pii-masking.ts`](../../src/features/ai/services/pii-masking.ts)                           | `maskMessagesForPersistence()` — best-effort secret masking            |
| [`packages/db-schema/src/ai-threads.ts`](../../packages/db-schema/src/ai-threads.ts)                                 | Drizzle schema for `ai_threads` table                                  |
