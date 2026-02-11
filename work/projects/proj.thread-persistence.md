---
id: proj.thread-persistence
type: project
primary_charter:
title: Thread Persistence
state: Active
priority: 1
estimate: 4
summary: Server-authoritative thread persistence using AI SDK UIMessage[] per thread, with tenant-scoped RLS, PII masking, and soft delete. P0 is backend-only (server extracts last user message from existing payload); P1 migrates client to useChatRuntime. Supersedes run_artifacts design.
outcome: Multi-turn conversations persisted in `ai_threads` table as `UIMessage[]` JSONB with RLS enforcement. Server extracts last user message from client payload, loads authoritative history from DB. P1 changes wire contract and migrates client.
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

# Thread Persistence

## Goal

Ship server-authoritative conversation persistence so that multi-turn chat works across disconnects, the client cannot fabricate history, and tool messages are inherently server-authored. Use standard AI SDK `UIMessage[]` persistence — no bespoke event-sourcing or run_artifacts for message content. See [thread-persistence spec](../../docs/spec/thread-persistence.md) for all invariants and schema.

## Roadmap

### Crawl (P0): Core Persistence + Route Bridge

**Goal:** Server persists `UIMessage[]` per thread. Route handler loads history, executes graph, assembles response UIMessage from AiEvent stream, and persists after pump completion. Existing billing/observability decorators unchanged.

| Deliverable                                                                   | Status      | Est | Work Item |
| ----------------------------------------------------------------------------- | ----------- | --- | --------- |
| DB: `ai_threads` table + Drizzle schema + RLS + migration                     | Not Started | 1   | —         |
| Port: `ThreadPersistencePort` + `DrizzleThreadPersistenceAdapter`             | Not Started | 2   | —         |
| Route: extract last user message from `messages[]`, load→execute→persist flow | Not Started | 3   | —         |
| Bridge: AiEvent→UIMessageStream + response UIMessage assembly                 | Not Started | 2   | —         |
| Masking: regex-based PII masking before `saveThread()`                        | Not Started | 1   | —         |
| Tests: multi-turn, tenant isolation, messages-grow-only, disconnect safety    | Not Started | 2   | —         |

### Walk (P1): Client Migration + Thread Management

**Goal:** Client sends only the new user message. Thread list UI backed by server. History survives page refresh.

| Deliverable                                                                    | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Contract: change wire format to `{threadId, message}` instead of `messages[]`  | Not Started | 1   | (create at P1 start) |
| Client: `useDataStreamRuntime` → `useChatRuntime` (@assistant-ui/react-ai-sdk) | Not Started | 2   | (create at P1 start) |
| Thread list: `listThreads` endpoint + basic thread selection UI                | Not Started | 2   | (create at P1 start) |
| History load: thread messages loaded from server on mount / thread switch      | Not Started | 1   | (create at P1 start) |

### Run (P2+): Retention + GDPR Deletion + LangGraph Coordination

**Goal:** Production-grade data lifecycle: retention policies, hard delete jobs, and coordinated LangGraph checkpoint + ai_threads deletion for compliant user data removal.

| Deliverable                                                                  | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Retention: configurable soft-delete window + scheduled hard-delete job       | Not Started | 2   | (create at P2 start) |
| LangGraph deletion: coordinated `ai_threads` + checkpoint deletion by thread | Not Started | 3   | (create at P2 start) |
| Enhanced masking: evaluate Presidio for stronger PII detection               | Not Started | 1   | (create at P2 start) |

## Constraints

- All technical invariants are in the [thread-persistence spec](../../docs/spec/thread-persistence.md) — this project does not redefine them
- P0 ships persistence + route bridge without changing the client transport — server extracts last user message from existing `messages[]` payload, ignores client-supplied history
- P0 does not provide GDPR-compliant deletion — deleting `ai_threads` without LangGraph checkpoints is insufficient for `langgraph_server` runs
- No `run_artifacts` table for message content — `UIMessage[]` in `ai_threads` IS the transcript store
- No bespoke event-sourcing — no `run_events`, no `TranscriptStorePort`, no `HistoryWriterSubscriber` fanout
- Billing/observability decorators must remain unchanged (AiEvent internal contract preserved)
- RLS uses `app.current_user_id` setting (same as `billing_accounts`)

## Dependencies

- [x] ~~AiEvent stream architecture~~ — `AssistantFinalEvent` already in `@cogni/ai-core`; executors already emit it
- [x] ~~Billing decorator~~ — `BillingGraphExecutorDecorator` works, unchanged by this project
- [ ] AI SDK 5+ package (`ai`) added as dependency (P0 blocker for `convertToModelMessages()`)
- [ ] `@assistant-ui/react-ai-sdk` package added as dependency (P1 blocker for `useChatRuntime`)

## As-Built Specs

- [Thread Persistence & Transcript Authority](../../docs/spec/thread-persistence.md) — Canonical spec: schema, invariants, port interface, event mapping, assembly pattern

## Design Notes

### Why UIMessage[] JSONB, not normalized rows

AI SDK's `saveChat()` persists the full array. Tool-call parts are embedded in assistant messages — normalizing fights the type system. Thread-level read/write is the only access pattern. Normalize later if per-message search or individual delete is needed.

### Why not run_artifacts

The original design had `run_artifacts` as a run-scoped projection of transcript events with idempotency keys and content hashes. With AI SDK UIMessage persistence, the thread IS the artifact store. Tool calls live inside UIMessage parts. No separate artifact table, no HistoryWriterSubscriber fanout, no idempotency key strategy. Dramatically simpler.

### Handoff

- [Handoff](../handoffs/proj.thread-persistence.handoff.md) — Context, decisions, and next actions for incoming developer

### Superseded specs (deleted)

- `docs/spec/server-transcript-authority.md` — invariants absorbed into [thread-persistence](../../docs/spec/thread-persistence.md)
- `docs/spec/usage-history.md` — `run_artifacts` design fully superseded by `ai_threads` with `UIMessage[]`
