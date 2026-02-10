---
id: proj.usage-history-persistence
type: project
primary_charter:
title: Chat Persistence & Usage History
state: Active
priority: 1
estimate: 5
summary: Server-authoritative transcript using core Message[] type. P0 closes transcript-authority gap with in-memory store (no DB, no contract change). P0.5 adds Drizzle DB persistence. P1 refactors contract + client transport.
outcome: Server is the only source of message history. Client-supplied assistant/tool/system messages are ignored. Multi-turn works via server-owned transcript store with per-thread concurrency safety.
assignees:
  - cogni-dev
created: 2026-02-07
updated: 2026-02-10
labels:
  - ai-graphs
  - data
  - security
  - tenant-isolation
---

# Chat Persistence & Usage History

## Goal

Eliminate client-authoritative transcript bugs by making the server the only source of conversation history. Ship in phases: in-memory first (P0), DB persistence next (P0.5), contract/client refactor later (P1). Uses the existing core `Message` type — no new dependencies, no bespoke event-sourcing. See [chat-persistence spec](../../docs/spec/chat-persistence.md) for invariants and port interface.

## Roadmap

### P0: Server Transcript Authority (In-Memory)

**Goal:** Server owns message history. Route loads from `TranscriptStorePort`, ignores client-supplied history, persists server-authored messages after pump. No DB, no API contract change, no client change.

| Deliverable                                                                     | Status      | Est | Work Item |
| ------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Port: `TranscriptStorePort` — `loadThread()` / `appendMessages()` w/ Message[]  | Not Started | 1   | —         |
| Adapter: `InMemoryTranscriptStoreAdapter` (TTL + LRU cap + per-thread mutex)    | Not Started | 2   | —         |
| Route: load from store, ignore client history, persist after pump               | Not Started | 2   | —         |
| Tests: fabrication rejection, multi-turn, tool persist, disconnect, concurrency | Not Started | 2   | —         |

#### Port: TranscriptStorePort

- [ ] Create `TranscriptStorePort` interface in `src/ports/transcript-store.port.ts`
- [ ] `loadThread(threadId): Promise<Message[]>` — returns empty array if thread doesn't exist
- [ ] `appendMessages(threadId, messages: Message[]): Promise<void>` — appends to thread, creates if needed
- [ ] Re-export from `src/ports/index.ts`

#### Adapter: InMemoryTranscriptStoreAdapter

- [ ] Create `InMemoryTranscriptStoreAdapter` in `src/adapters/server/ai/in-memory-transcript-store.adapter.ts`
- [ ] Per-thread mutex (serialize concurrent appends to same thread)
- [ ] TTL-based eviction (configurable, default 24h)
- [ ] LRU cap (configurable, default 1000 threads)
- [ ] Wire into bootstrap container

#### Route: Server-Owned Transcript

- [ ] Extract user text from client input (trust only latest user message content)
- [ ] Construct threadId from `${userId}:${stateKey}` (tenant-scoped)
- [ ] Load history from `TranscriptStorePort.loadThread(threadId)`
- [ ] Append user `Message` to store before execution
- [ ] Pass loaded messages (not client messages) to facade via `toCoreMessages()`
- [ ] After pump: build assistant + tool `Message[]` from existing route accumulators (`assistantFinalContent`, `toolCallControllers`)
- [ ] Append response messages to store after pump
- [ ] No change to `createAssistantStreamResponse` / assistant-stream wire format

#### Tests

- [ ] Client-fabricated assistant/tool messages are ignored (not in store or LLM prompt)
- [ ] Two-turn conversation works using server store only
- [ ] Tool call + tool result persisted as `Message` with `toolCalls`/`toolCallId`
- [ ] Client disconnect does not prevent persistence (pump completes server-side)
- [ ] Two concurrent sends on same thread do not lose messages (SERIALIZED_APPENDS)
- [ ] Tool result >32KB truncated to 32KB with `\n[TRUNCATED]` marker (PERSIST_SIZE_CAPS)
- [ ] Assistant content >128KB truncated with `\n[TRUNCATED]` marker (PERSIST_SIZE_CAPS)
- [ ] User text extraction: last user message used; non-user last message → 400

### P0.5: DB Persistence (Same Port)

**Goal:** Swap `InMemoryTranscriptStoreAdapter` for `DrizzleTranscriptStoreAdapter`. Same port interface, durable persistence across restarts.

| Deliverable                                                               | Status      | Est | Work Item |
| ------------------------------------------------------------------------- | ----------- | --- | --------- |
| Schema: `chat_threads` table + Drizzle + RLS + migration                  | Not Started | 1   | —         |
| Adapter: `DrizzleTranscriptStoreAdapter` implementing TranscriptStorePort | Not Started | 2   | —         |
| Tests: tenant isolation (RLS enforcement), persistence across restart     | Not Started | 1   | —         |

### P1: Contract Refactor + Client Migration

**Goal:** Client sends only user text. Optionally migrate persistence shape to AI SDK `UIMessage` if warranted.

| Deliverable                                                                    | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Contract: accept `{threadId, userText}` instead of `{messages[]}`              | Not Started | 1   | (create at P1 start) |
| Client: `useDataStreamRuntime` → `useChatRuntime` (@assistant-ui/react-ai-sdk) | Not Started | 2   | (create at P1 start) |
| Thread list: `listThreads` endpoint + thread selection UI                      | Not Started | 2   | (create at P1 start) |
| Optional: evaluate UIMessage persistence + `convertToModelMessages()`          | Not Started | 1   | (create at P1 start) |

### P2+: Retention + GDPR Deletion

**Goal:** Production-grade data lifecycle: retention policies, hard delete jobs, coordinated LangGraph checkpoint + chat_threads deletion.

| Deliverable                                                                  | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Retention: configurable soft-delete window + scheduled hard-delete job       | Not Started | 2   | (create at P2 start) |
| LangGraph deletion: coordinated chat_threads + checkpoint deletion by thread | Not Started | 3   | (create at P2 start) |
| Enhanced masking: evaluate Presidio for stronger PII detection               | Not Started | 1   | (create at P2 start) |

## Constraints

- All technical invariants are in the [chat-persistence spec](../../docs/spec/chat-persistence.md) — this project does not redefine them
- P0 uses existing core `Message` type — no AI SDK package dependency, no `UIMessage`, no `convertToModelMessages()`
- P0 does NOT change the API contract — client still sends `{messages[], stateKey, model, graphName}`, server ignores client history
- P0 does NOT change the client transport — `useDataStreamRuntime` unchanged
- P0 uses in-memory persistence — acceptable for MVP (data lost on restart; DB is P0.5)
- Billing/observability decorators unchanged (AiEvent internal contract preserved)
- No bespoke event-sourcing — no `run_events`, no `TranscriptEvent`, no `HistoryWriterSubscriber`

## Dependencies

- [x] ~~AiEvent stream architecture~~ — `AssistantFinalEvent` already in `@cogni/ai-core`; executors already emit it
- [x] ~~Billing decorator~~ — `BillingGraphExecutorDecorator` works, unchanged
- [x] ~~Core Message type~~ — `src/core/chat/model.ts` already has role, content, toolCalls, toolCallId
- [ ] AI SDK 5+ package (P1 — only if UIMessage migration is adopted)
- [ ] `@assistant-ui/react-ai-sdk` package (P1 — `useChatRuntime` migration)

## As-Built Specs

- [Chat Persistence & Transcript Authority](../../docs/spec/chat-persistence.md) — Port interface, invariants, route behavior, event mapping

## Design Notes

### Why Message[], not UIMessage

The existing core `Message` type from `src/core/chat/model.ts` is already the executor contract, the LLM prompt shape, and what LangGraph message converters expect. Persisting `Message[]` means zero new dependencies, zero type conversion, and the same type flows from store → facade → executor. UIMessage introduces a 3-type conversion chain (`UIMessage → ModelMessage → Message`) that adds complexity without P0 benefit. Evaluate UIMessage migration at P1 when client transport changes.

### Why in-memory first

The immediate bug is client-authoritative transcript — the server trusts client-supplied messages. Fixing this requires zero DB changes: load from an in-memory store, ignore client history, persist server-authored messages. Shipping in-memory first (P0) then swapping to DB (P0.5) means the security fix lands in one small PR without schema migrations.

### Handoff

- [Handoff](../handoffs/proj.usage-history-persistence.handoff.md) — Context, decisions, next actions for incoming developer

### Superseded designs

- `docs/spec/usage-history.md` — `run_artifacts` design fully superseded
- `docs/spec/server-transcript-authority.md` — invariants absorbed into chat-persistence spec
