---
id: task.0030
type: task
title: "Thread persistence P0 — ai_threads table, port, route bridge"
status: Todo
priority: 1
estimate: 3
summary: "Implement server-authoritative thread persistence: ai_threads Drizzle schema + RLS, ThreadPersistencePort + adapter (FOR UPDATE concurrency, MAX_THREAD_MESSAGES guard), route refactor (extract last user message, load→execute→persist), UIMessage accumulator for persistence (wire format unchanged), UIMessage→MessageDto mapper, PII masking, stateKey lifecycle."
outcome: "Multi-turn chat persisted in ai_threads as UIMessage[] JSONB. Server extracts last user message from client payload, loads authoritative history, executes graph, persists after pump. Existing client transport unchanged."
spec_refs: thread-persistence
assignees:
  - cogni-dev
credit:
project: proj.thread-persistence
branch:
pr:
created: 2026-02-11
updated: 2026-02-11
---

# Thread Persistence P0

## Deliverables

See [thread-persistence spec](../../docs/spec/thread-persistence.md) for all invariants, schema, and port interface.

- [ ] Add `ai` package (AI SDK 5+) + `nanoid` as dependencies — needed for `UIMessage` types and stateKey generation
- [ ] DB: `ai_threads` table + Drizzle schema (`packages/db-schema/src/ai-threads.ts`) + RLS + migration
  - Schema: `(id, owner_user_id, state_key, messages, metadata, created_at, updated_at, deleted_at)`
  - `UNIQUE(owner_user_id, state_key)`, RLS on `owner_user_id`
- [ ] Port: `ThreadPersistencePort` interface (`src/ports/thread-persistence.port.ts`)
  - `loadThread(ownerUserId, stateKey)`, `saveThread(ownerUserId, stateKey, messages)`, `softDelete`, `listThreads`
- [ ] Adapter: `DrizzleThreadPersistenceAdapter` (`src/adapters/server/ai/thread-persistence.adapter.ts`)
  - `SET LOCAL app.current_user_id` in transaction
  - `SELECT ... FOR UPDATE` on thread row (SERIALIZED_APPENDS)
  - MESSAGES_GROW_ONLY enforcement
  - MAX_THREAD_MESSAGES (200) enforcement — reject saves exceeding limit
- [ ] Contract update (`src/contracts/ai.chat.v1.contract.ts`):
  - Update `STATE_KEY_SAFE_PATTERN` from `/^[A-Za-z0-9._:-]+$/` to `/^[a-zA-Z0-9_-]{1,128}$/`
  - **Breaking change** — dots and colons no longer allowed; acceptable because no threads are persisted yet
- [ ] Mapper: `uiMessagesToMessageDtos()` in `src/features/ai/services/mappers.ts`
  - Converts persisted `UIMessage[]` → `MessageDto[]` for existing `toCoreMessages()` pipeline
  - Maps UIMessage.parts (text, tool-call, tool-result) → MessageDto fields
- [ ] Route refactor (`src/app/api/v1/ai/chat/route.ts`):
  - Extract last `role === "user"` message from `messages[]` (400 if none)
  - stateKey lifecycle: use client value or generate `nanoid(21)`, validate per contract
  - Load authoritative history → append user UIMessage → convert via mapper → execute → persist after pump
  - Return `X-State-Key` response header (always)
  - **No changes to completion facade** — route pre-processes messages before calling it
  - **No wire format change** — keep `createAssistantStreamResponse` (assistant-stream)
- [ ] UIMessage accumulator: parallel consumer of AiEvent stream in route (~30-line accumulator)
  - Builds response `UIMessage { role: "assistant", parts: [...] }` from AiEvent events
  - Runs alongside existing `createAssistantStreamResponse` controller (not a replacement)
- [ ] Masking: regex-based PII masking before `saveThread()`
- [ ] Tests: multi-turn persistence, fabricated history ignored, tool persistence, disconnect safety, tenant isolation, billing unchanged, messages-grow-only, thread message limit

## P0 Scope Boundaries

These are explicitly **NOT in P0** (deferred to P1):

- No wire format change — keep `createAssistantStreamResponse`, NOT `createUIMessageStream()`
- No client transport change — keep `useDataStreamRuntime`, NOT `useChatRuntime`
- No facade refactor — keep `toCoreMessages()`, NOT `convertToModelMessages()`
- No contract shape change — keep `messages[]` input, NOT `{stateKey, message}`

## Validation

Per spec § Acceptance Checks (all 8 checks must pass).

## PR / Links

- Handoff: [handoff](../handoffs/task.0030.handoff.md)
