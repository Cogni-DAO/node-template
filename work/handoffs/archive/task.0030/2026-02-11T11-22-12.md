---
id: task.0030.handoff
type: handoff
work_item_id: task.0030
status: active
created: 2026-02-11
updated: 2026-02-11
branch: feat/thread-persistence
last_commit: 9c15b1bc
---

# Handoff: Thread Persistence P0

## Context

- The platform has **no server-side message persistence** — the client sends full conversation history on every request, which allows fabrication of assistant/tool messages
- P0 adds server-authoritative persistence using AI SDK `UIMessage[]` per thread, stored in a new `ai_threads` table with Postgres RLS
- P0 is **backend-only**: the existing client transport (`useDataStreamRuntime` + `createAssistantStreamResponse`) is completely unchanged. The server extracts the last user message from the existing `messages[]` payload, ignores client-supplied history, and loads authoritative history from DB
- A design review was completed and all P0 scope decisions are resolved — see the spec's Key Decisions 1-4
- **No implementation code exists yet** — only spec, project, research, and this handoff

## Current State

- **Done:** Spec finalized with 13 invariants (including new `MAX_THREAD_MESSAGES`), schema, port interface, event mapping, and 8 acceptance checks — [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)
- **Done:** Design review completed — all concerns resolved with explicit P0 scope boundaries (no wire format change, no facade refactor, no client migration)
- **Done:** Project roadmap with P0/P1/P2 phases — [`work/projects/proj.thread-persistence.md`](../projects/proj.thread-persistence.md)
- **Done:** Research analysis of AI SDK patterns — [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md)
- **Not started:** All P0 implementation — see task checklist at [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)

## Decisions Made

- **UIMessage[] JSONB per thread** — [spec: Decision 1](../../docs/spec/thread-persistence.md#1-uimessage-jsonb-vs-normalized-message-rows)
- **AiEvent stays internal** — [spec: Decision 2](../../docs/spec/thread-persistence.md#2-aievent-stays-internal)
- **P0 wire format: KEEP `createAssistantStreamResponse`** — no wire protocol change. UIMessage accumulator runs in parallel for persistence only. [spec: Decision 3](../../docs/spec/thread-persistence.md#3-p0-wire-format-keep-assistant-stream)
- **P0 message conversion: KEEP `toCoreMessages()`** — add `uiMessagesToMessageDtos()` mapper to bridge UIMessage[] into the existing pipeline. [spec: Decision 4](../../docs/spec/thread-persistence.md#4-p0-message-conversion-preserve-existing-pipeline)
- **`SELECT ... FOR UPDATE`** — adapter transaction serializes concurrent JSONB writes (SERIALIZED_APPENDS)
- **MAX_THREAD_MESSAGES = 200** — adapter rejects saves exceeding this limit
- **stateKey:** `nanoid(21)` generation, validation tightened to `^[a-zA-Z0-9_-]{1,128}$` (breaking: removes `.` and `:`)
- **No facade changes, no client changes** — route-only refactor in P0

## Next Actions

- [ ] Add `ai` (AI SDK 5+) + `nanoid` as dependencies
- [ ] `ai_threads` Drizzle schema + RLS policy + SQL migration in `packages/db-schema/src/ai-threads.ts`
- [ ] `ThreadPersistencePort` interface in `src/ports/thread-persistence.port.ts`
- [ ] `DrizzleThreadPersistenceAdapter` with FOR UPDATE, MESSAGES_GROW_ONLY, MAX_THREAD_MESSAGES
- [ ] Update `STATE_KEY_SAFE_PATTERN` in `src/contracts/ai.chat.v1.contract.ts`
- [ ] `uiMessagesToMessageDtos()` mapper in `src/features/ai/services/mappers.ts`
- [ ] Route refactor: extract user msg → load thread → mapper → toCoreMessages → execute → accumulate UIMessage → persist
- [ ] PII masking utility before `saveThread()`
- [ ] Stack tests for all 8 acceptance checks (spec § Acceptance Checks)

## Risks / Gotchas

- **P0 does NOT use `convertToModelMessages()` or `createUIMessageStream()`** — those are P1. The existing `toCoreMessages()` pipeline and `createAssistantStreamResponse` wire format are preserved.
- Route currently uses `crypto.randomUUID()` for stateKey (line ~366) — switch to `nanoid(21)` and tighten regex
- Persistence MUST happen after `RunEventRelay.startPump()` completes — same timing guarantee billing depends on
- The `uiMessagesToMessageDtos()` mapper feeds INTO the existing `toMessageDtos()` / `toCoreMessages()` pipeline — don't refactor both at once
- stateKey tightening removes `.` and `:` from allowed characters — update any tests using those

## Pointers

| File / Resource                                                                                                        | Why it matters                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                             | Canonical spec — invariants, schema, port interface, acceptance checks   |
| [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)                         | P0 task with full deliverable checklist + P0 scope boundaries            |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                             | Chat route — primary refactor target (load→execute→persist)              |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                   | Contract — stateKey validation pattern update                            |
| [`src/app/_facades/ai/completion.server.ts`](../../src/app/_facades/ai/completion.server.ts)                           | Completion facade — NO changes in P0                                     |
| [`src/features/ai/services/mappers.ts`](../../src/features/ai/services/mappers.ts)                                     | `toCoreMessages()` stays; add `uiMessagesToMessageDtos()` mapper         |
| [`packages/db-client/src/tenant-scope.ts`](../../packages/db-client/src/tenant-scope.ts)                               | RLS helper — reuse `setTenantContext()` / `withTenantScope()` in adapter |
| [`packages/ai-core/src/events/ai-events.ts`](../../packages/ai-core/src/events/ai-events.ts)                           | AiEvent types — accumulator maps these to UIMessage parts                |
| [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md) | Design research: AI SDK patterns, event mapping rationale                |
