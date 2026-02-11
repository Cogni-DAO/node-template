---
id: task.0030
type: task
title: "Thread persistence P0 — ai_threads table, port, route bridge"
status: Todo
priority: 1
estimate: 3
summary: "Implement server-authoritative thread persistence: ai_threads Drizzle schema + RLS, ThreadPersistencePort + adapter (FOR UPDATE concurrency), route refactor (extract last user message, load→execute→persist), AiEvent→UIMessageStream bridge, PII masking, stateKey lifecycle."
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

- [ ] Add `ai` package (AI SDK 5+) as dependency — needed for `UIMessage` types and `convertToModelMessages()`
- [ ] DB: `ai_threads` table + Drizzle schema (`packages/db-schema/src/ai-threads.ts`) + RLS + migration
  - Schema: `(id, owner_user_id, state_key, messages, metadata, created_at, updated_at, deleted_at)`
  - `UNIQUE(owner_user_id, state_key)`, RLS on `owner_user_id`
- [ ] Port: `ThreadPersistencePort` interface (`src/ports/thread-persistence.port.ts`)
  - `loadThread(ownerUserId, stateKey)`, `saveThread(ownerUserId, stateKey, messages)`, `softDelete`, `listThreads`
- [ ] Adapter: `DrizzleThreadPersistenceAdapter` (`src/adapters/server/ai/thread-persistence.adapter.ts`)
  - `SET LOCAL app.current_user_id` in transaction
  - `SELECT ... FOR UPDATE` on thread row (SERIALIZED_APPENDS)
  - MESSAGES_GROW_ONLY enforcement
- [ ] Contract update (`src/contracts/ai.chat.v1.contract.ts`):
  - Update `STATE_KEY_SAFE_PATTERN` from `/^[A-Za-z0-9._:-]+$/` to `/^[a-zA-Z0-9_-]{1,128}$/`
- [ ] Route refactor (`src/app/api/v1/ai/chat/route.ts`):
  - Extract last `role === "user"` message from `messages[]` (400 if none)
  - stateKey lifecycle: use client value or generate `nanoid(21)`, validate per contract
  - Load authoritative history → append user message → convert → execute → persist after pump
  - Return `X-State-Key` response header (always)
  - No changes to completion facade — route pre-processes messages before calling it
- [ ] Bridge: AiEvent→UIMessageStream + response UIMessage assembly (~30-line accumulator in route)
- [ ] Masking: regex-based PII masking before `saveThread()`
- [ ] Tests: multi-turn persistence, fabricated history ignored, tool persistence, disconnect safety, tenant isolation, billing unchanged, messages-grow-only

## Validation

Per spec § Acceptance Checks (all 7 checks must pass).

## PR / Links

- Handoff: [handoff](../handoffs/task.0030.handoff.md)
