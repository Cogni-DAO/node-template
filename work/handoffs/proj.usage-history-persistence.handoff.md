---
id: proj.usage-history-persistence.handoff
type: handoff
work_item_id: proj.usage-history-persistence
status: active
created: 2026-02-10
updated: 2026-02-10
branch: feat/openclaw-observability
last_commit: 793098f0
---

# Handoff: Chat Persistence & Usage History

## Context

- The platform currently has **no server-side message persistence** — the client (assistant-ui) sends full conversation history on every request, meaning users can fabricate assistant/tool messages
- We designed a server-authoritative persistence layer using **AI SDK `UIMessage[]` per thread**, replacing two earlier draft specs (`usage-history.md` with `run_artifacts`, and `server-transcript-authority.md` with `chat_messages`)
- The canonical spec is [`docs/spec/chat-persistence.md`](../../docs/spec/chat-persistence.md) — all invariants, schema, port interface, and event mapping live there
- The project roadmap is [`work/projects/proj.usage-history-persistence.md`](../projects/proj.usage-history-persistence.md) — 3 phases: P0 (DB + route bridge), P1 (client migration), P2 (retention + GDPR)
- **No implementation code has been written yet** — only spec, project, and research artifacts

## Current State

- **Done:** Spec approved and committed (`chat-persistence.md`), project rewritten, old specs deleted, all cross-references updated
- **Done:** Research artifact at `docs/research/ai-sdk-transcript-authority-analysis.md` documents AI SDK 5/6 patterns, assistant-ui runtime options, and the AiEvent mapping rationale
- **Not started:** All P0 deliverables (table, port, adapter, route refactor, contract change, masking, tests)
- **Not started:** AI SDK package (`ai`) not yet added as a dependency
- **Not started:** `@assistant-ui/react-ai-sdk` package not yet added

## Decisions Made

- **UIMessage[] JSONB per thread** — not normalized rows, not `run_artifacts`. See [spec: Key Decision 1](../../docs/spec/chat-persistence.md#1-uimessage-jsonb-vs-normalized-message-rows)
- **AiEvent stays internal** — mapped to AI SDK stream parts at the route layer via a ~30-line accumulator. See [spec: Key Decision 2](../../docs/spec/chat-persistence.md#2-aievent-stays-internal)
- **RLS via `owner_user_id` / `app.current_user_id`** — same pattern as `billing_accounts` and `charge_receipts`. See [tenant-scope.ts](../../packages/db-client/src/tenant-scope.ts)
- **MESSAGES_GROW_ONLY** — enforced in adapter code (`saveThread` rejects if `newMessages.length < oldMessages.length`), not a DB constraint
- **Minimal accumulator** — we build the response `UIMessage` ourselves from AiEvent stream, not using AI SDK's `toUIMessageStreamResponse()`. See [spec: Response UIMessage Assembly](../../docs/spec/chat-persistence.md#response-uimessage-assembly)
- **Thread ID prefix validated** — `owner_user_id` is authoritative; threadId prefix `${ownerUserId}:${stateKey}` is verified, never trusted

## Next Actions

- [ ] Create a `task.*` work item for P0 implementation
- [ ] Add `ai` package (AI SDK 5+) as a dependency — needed for `UIMessage` types and `convertToModelMessages()`
- [ ] Create `chat_threads` Drizzle schema in `packages/db-schema/src/chat-threads.ts` per spec schema
- [ ] Create `ChatPersistencePort` in `src/ports/chat-persistence.port.ts` per spec port interface
- [ ] Create `DrizzleChatPersistenceAdapter` with RLS + MESSAGES_GROW_ONLY enforcement
- [ ] Refactor chat route (`src/app/api/v1/ai/chat/route.ts`): load→execute→persist flow with AiEvent→UIMessageStream bridge
- [ ] Refactor contract (`src/contracts/ai.chat.v1.contract.ts`): accept `{threadId, message}` not `{messages[]}`
- [ ] Add PII masking utility (`src/features/ai/services/masking.ts`) applied before `saveThread()`
- [ ] Write stack tests per acceptance checks in spec (multi-turn, tenant isolation, grow-only, disconnect safety)

## Risks / Gotchas

- The existing `useDataStreamRuntime` client will break when the contract changes from `messages[]` to `{threadId, message}` — P0 route must support both during transition, or P1 client migration must ship simultaneously
- `convertToModelMessages()` expects AI SDK `UIMessage` shape — our current `Message` type from `src/core/chat/model.ts` does not match and cannot be used directly for prompt reconstruction
- LangGraph executor manages its own prompt assembly from checkpoints — `convertToModelMessages()` path only applies to `inproc`/`claude_sdk` executors. The spec's `LANGGRAPH_THREAD_DUALITY` invariant covers this
- The `assistant-stream` package (currently used for SSE) will be replaced by AI SDK's `createUIMessageStream()` — this changes the wire protocol from assistant-stream format to AI SDK Data Stream Protocol
- RLS setting is `app.current_user_id` (user-scoped), not account-scoped — `chat_threads.owner_user_id` maps to the authenticated user, not a billing account

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`docs/spec/chat-persistence.md`](../../docs/spec/chat-persistence.md)                                                                 | Canonical spec — all invariants, schema, port interface, event mapping    |
| [`work/projects/proj.usage-history-persistence.md`](../projects/proj.usage-history-persistence.md)                                     | Project roadmap — P0/P1/P2 deliverable tables                             |
| [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md)                 | Research: AI SDK patterns, assistant-ui runtimes, mapping rationale       |
| [`packages/ai-core/src/events/ai-events.ts`](../../packages/ai-core/src/events/ai-events.ts)                                           | AiEvent union — the internal stream contract that gets bridged            |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                             | Current route handler — will be refactored for load→execute→persist       |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                                   | Current contract — will change from `messages[]` to `{threadId, message}` |
| [`src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx) | Current client runtime — P1 migrates to `useChatRuntime`                  |
| [`packages/db-client/src/tenant-scope.ts`](../../packages/db-client/src/tenant-scope.ts)                                               | RLS helper — `SET LOCAL app.current_user_id` pattern to reuse             |
| [`src/adapters/server/ai/billing-executor.decorator.ts`](../../src/adapters/server/ai/billing-executor.decorator.ts)                   | Billing decorator — must remain unchanged (AiEvent contract preserved)    |
