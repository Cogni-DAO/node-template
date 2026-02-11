---
id: task.0030.handoff
type: handoff
work_item_id: task.0030
status: active
created: 2026-02-11
updated: 2026-02-11
branch: fix/openclaw-billing-clean
last_commit: d2b7bf2b
---

# Handoff: Thread Persistence P0

## Context

- The platform has **no server-side message persistence** — the client sends full conversation history on every request, allowing fabrication of assistant/tool messages
- We need server-authoritative persistence using AI SDK `UIMessage[]` per thread, stored in a new `ai_threads` table with Postgres RLS
- The canonical spec is [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md) — all invariants, schema, port interface, and acceptance checks live there
- P0 is **backend-only** — the existing client transport (`useDataStreamRuntime`, sending `messages[]`) is unchanged; the server extracts the last user message and ignores client-supplied history
- No implementation code exists yet — only spec, project, and research artifacts

## Current State

- **Done:** Spec finalized with invariants (STATE_KEY_LIFECYCLE, SERIALIZED_APPENDS, CLIENT_SENDS_USER_ONLY, etc.), schema (`ai_threads` with `owner_user_id` + `state_key` columns), port interface, and acceptance checks
- **Done:** Project roadmap at [`work/projects/proj.thread-persistence.md`](../projects/proj.thread-persistence.md) — P0/P1/P2 phases
- **Done:** Research at [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md) — AI SDK 5/6 patterns, AiEvent mapping rationale
- **Not started:** All P0 deliverables — see task checklist at [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)
- **Not started:** `ai` package (AI SDK 5+) not yet added as a dependency

## Decisions Made

- **UIMessage[] JSONB per thread** — not normalized rows, not `run_artifacts`. See [spec: Key Decision 1](../../docs/spec/thread-persistence.md#1-uimessage-jsonb-vs-normalized-message-rows)
- **AiEvent stays internal** — bridged to AI SDK stream parts at route layer. See [spec: Key Decision 2](../../docs/spec/thread-persistence.md#2-aievent-stays-internal)
- **`stateKey` is the only client-visible thread identifier** — scoped per-tenant via `UNIQUE(owner_user_id, state_key)`. No composite keys.
- **`owner_user_id`** is the canonical tenant scope (authenticated user ID, not billing account)
- **`SELECT ... FOR UPDATE`** in adapter transaction prevents lost updates on concurrent JSONB writes (SERIALIZED_APPENDS invariant)
- **stateKey lifecycle:** server generates `nanoid(21)` if absent, validates `^[a-zA-Z0-9_-]{1,128}$`, returns via `X-State-Key` header
- **Minimal accumulator** — route builds response `UIMessage` from AiEvent stream (~30 lines), not using AI SDK's `toUIMessageStreamResponse()`
- **No facade changes** — route pre-processes messages (load thread, append user msg) before calling the completion facade

## Next Actions

- [ ] Add `ai` package (AI SDK 5+) — `UIMessage`, `convertToModelMessages()`, `createIdGenerator()`
- [ ] Create `ai_threads` Drizzle schema + RLS + migration
- [ ] Create `ThreadPersistencePort` + `DrizzleThreadPersistenceAdapter` (FOR UPDATE + MESSAGES_GROW_ONLY)
- [ ] Update contract stateKey validation pattern in `ai.chat.v1.contract.ts`
- [ ] Refactor route: extract last user message → load thread → append → convert → execute → accumulate → persist
- [ ] Add AiEvent→UIMessage accumulator in route (text_delta, tool_call_start, tool_call_result → UIMessage parts)
- [ ] Add PII masking utility applied before `saveThread()`
- [ ] Write stack tests per spec § Acceptance Checks (7 checks)

## Risks / Gotchas

- `convertToModelMessages()` expects AI SDK `UIMessage` shape — our current `Message` type from `src/core/chat/model.ts` does not match and cannot be used for prompt reconstruction directly; use the AI SDK converter
- The route currently uses `crypto.randomUUID()` for stateKey generation (line ~366) — switch to `nanoid(21)` and tighten the validation regex
- `assistant-stream` package (currently used for SSE) will be replaced by `createUIMessageStream()` — this changes the wire protocol from assistant-stream format to AI SDK Data Stream Protocol
- Persistence MUST happen after pump completes (`RunEventRelay.startPump()`), not during streaming — same timing guarantee billing depends on
- The existing `toMessageDtos()` / `toCoreMessages()` pipeline in the route stays for now — the new thread loading happens BEFORE this pipeline; don't refactor both at once

## Pointers

| File / Resource                                                                                                        | Why it matters                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                             | Canonical spec — invariants, schema, port interface, acceptance checks                       |
| [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)                         | P0 task with full deliverable checklist                                                      |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                             | Chat route — primary refactor target (load→execute→persist flow)                             |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                   | Contract — stateKey validation needs pattern update                                          |
| [`src/app/_facades/ai/completion.server.ts`](../../src/app/_facades/ai/completion.server.ts)                           | Completion facade — NO changes needed, route pre-processes                                   |
| [`src/features/ai/services/mappers.ts`](../../src/features/ai/services/mappers.ts)                                     | `toCoreMessages()` — stays as-is; new `convertToModelMessages()` from AI SDK added alongside |
| [`packages/db-client/src/tenant-scope.ts`](../../packages/db-client/src/tenant-scope.ts)                               | RLS helper — reuse `setTenantContext()` in adapter                                           |
| [`packages/ai-core/src/events/ai-events.ts`](../../packages/ai-core/src/events/ai-events.ts)                           | AiEvent types — accumulator maps these to UIMessage parts                                    |
| [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md) | Research: AI SDK patterns, event mapping rationale                                           |
