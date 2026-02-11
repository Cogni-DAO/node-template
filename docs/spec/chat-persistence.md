---
id: chat-persistence
type: spec
title: Chat Persistence & Transcript Authority
status: draft
spec_state: draft
trust: draft
summary: Server-authoritative conversation persistence using AI SDK UIMessage[] per thread. Client sends only the new user message; server loads history from DB, executes graph, persists response UIMessages after pump completion. AiEvent remains the internal executor stream contract, bridged to AI SDK stream parts at the route layer.
read_when: Working on chat API, message persistence, multi-turn conversation state, assistant-ui transport, or message security model
implements: proj.usage-history-persistence
owner: cogni-dev
created: 2026-02-10
verified:
tags:
  - ai-graphs
  - security
  - data
  - tenant-isolation
---

# Chat Persistence & Transcript Authority

> Server owns conversation history as `UIMessage[]` per thread. Client sends `{threadId, message}` (one user message); server loads thread from DB, converts to `ModelMessage[]`, runs graph, constructs response `UIMessage` from AiEvent stream, persists full thread after pump completion. AiEvent is the internal executor/decorator stream contract — bridged to AI SDK stream parts at the route layer. No bespoke event-sourcing, no run_artifacts for message content.

### Key References

|              |                                                                                             |                                          |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Project**  | [Usage History](../../work/projects/proj.usage-history-persistence.md)                      | Implementation roadmap                   |
| **Spec**     | [Graph Execution](./graph-execution.md)                                                     | AiEvent stream, billing decorator, pump  |
| **Package**  | `packages/ai-core/src/events/ai-events.ts`                                                  | AiEvent types (streaming, not persisted) |
| **OSS**      | [AI SDK Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) | Canonical server persistence pattern     |
| **OSS**      | [assistant-ui AI SDK Runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/use-chat)   | Client runtime integration               |
| **Research** | [AI SDK Analysis](../research/ai-sdk-transcript-authority-analysis.md)                      | Design research and decision rationale   |

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ POST /api/v1/ai/chat  { threadId, message: UIMessage }                      │
│                                                                             │
│  1. Validate: message.role === "user" (reject assistant/tool/system)        │
│  2. Load: UIMessage[] ← ChatPersistencePort.loadThread(ownerUserId, threadId) │
│  3. Append user message to thread                                           │
│  4. Convert: UIMessage[] → ModelMessage[] via convertToModelMessages()      │
│  5. Execute: graphExecutor.runGraph({ messages: ModelMessage[], ... })       │
│  6. Stream: AiEvent → createUIMessageStream() parts → SSE to client        │
│  7. Collect: assemble response UIMessage from AiEvent stream events         │
│  8. Persist: ChatPersistencePort.saveThread(ownerUserId, threadId, messages)│
│  9. Return: X-State-Key header for thread continuity                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### AiEvent → AI SDK Stream → Persisted UIMessage

AiEvent is the **internal** executor/decorator stream contract. The route handler bridges it to the AI SDK wire protocol and constructs persisted `UIMessage` parts:

```
GraphExecutorPort.runGraph()
    │
    │  AsyncIterable<AiEvent>
    │  (text_delta, tool_call_start, tool_call_result,
    │   usage_report, assistant_final, done, error)
    │
    ├─ ObservabilityGraphExecutorDecorator ← intercepts assistant_final, done, error
    ├─ BillingGraphExecutorDecorator ← consumes usage_report (never forwarded)
    │
    ├─ RunEventRelay.pump() ← drives stream to completion
    │
    └─ Route handler ← bridges to AI SDK + assembles UIMessage
         ├─ createUIMessageStream() writer ← emits AI SDK stream parts to client
         ├─ UIMessage assembly ← constructs response message from events
         └─ onFinish → saveThread() ← persists full UIMessage[] to DB
```

#### Event Mapping

| AiEvent            | AI SDK Stream Part                          | Persisted UIMessage Part                                                      |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `text_delta`       | `text-delta` (within text-start/end block)  | `{ type: "text", text: "..." }`                                               |
| `tool_call_start`  | `tool-input-start` + `tool-input-available` | `{ type: "tool-call", toolCallId, toolName, args, state: "input-available" }` |
| `tool_call_result` | `tool-output-available`                     | Same part updated: `{ ..., result, state: "output-available" }`               |
| `assistant_final`  | _(no wire equivalent)_                      | Text reconciliation — ensures final text part is complete                     |
| `usage_report`     | _(internal only, consumed by billing)_      | Not persisted in UIMessage                                                    |
| `done`             | `finish` (with usage + finishReason)        | Triggers `saveThread()`                                                       |
| `error`            | `error`                                     | Error metadata on message or stream termination                               |

### Persistence Model

AI SDK 5's `UIMessage` is the persistence contract. Each thread stores a `UIMessage[]` array:

```typescript
// AI SDK type — we persist this directly
interface UIMessage {
  id: string; // server-generated (createIdGenerator())
  role: "user" | "assistant" | "system";
  parts: UIMessagePart[]; // typed: text, tool-call (with lifecycle), reasoning, etc.
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}
```

Tool calls and results live **inside the assistant message as parts** — not as separate message rows. A single `UIMessage[]` per thread captures the full conversation including all tool interactions.

### Response UIMessage Assembly

After the pump completes, the route constructs the response `UIMessage` using a **minimal accumulator** — not AI SDK's `toUIMessageStreamResponse()` or its internal stream-to-message machinery. The accumulator:

1. Accumulates `text_delta` events into a single `{ type: "text" }` part
2. Maps `tool_call_start` → `{ type: "tool-call", state: "input-available" }` part
3. Maps `tool_call_result` → updates the matching tool-call part to `state: "output-available"` with result
4. Uses `assistant_final` for text reconciliation (same existing pattern)
5. Produces one `UIMessage { role: "assistant", parts: [...] }` appended to the thread

This keeps the route thin — no dependency on AI SDK's streaming lifecycle state machine. We own the ~30-line accumulator; AI SDK types are used only as the data shape for persistence and wire serialization.

### Prompt Reconstruction

On each request, the server reconstructs the LLM prompt from persisted messages:

```typescript
// Server-side: UIMessage[] → ModelMessage[] (AI SDK function)
const modelMessages = convertToModelMessages(validatedMessages);
// ModelMessage[] passed to graphExecutor.runGraph({ messages })
```

This replaces our current `toCoreMessages()` transformation. The existing `Message` type from `src/core/chat/model.ts` aligns with `ModelMessage` — it remains the internal executor format but is no longer the persistence shape.

### Client Transport

assistant-ui migrates from `useDataStreamRuntime` (legacy, sends full history) to `useChatRuntime` from `@assistant-ui/react-ai-sdk`:

```
Current (vulnerable):
  Client sends: { messages: [user, assistant, tool, ...], model, graphName }
  Server: passes client history to LLM verbatim
  Risk: client can fabricate any message role

Target:
  Client sends: { message: UIMessage (user only), threadId, model, graphName }
  Server: loads history from DB, appends user message, runs LLM
  Guarantee: server-authored history only
```

## Goal

- Server owns all message history as `UIMessage[]` in `chat_threads` table
- Client sends only the new user message; cannot fabricate assistant/tool messages
- Multi-turn works across disconnects, refreshes, device switches (history in DB)
- Tool messages are inherently server-authored (constructed from AiEvent stream)
- Standard AI SDK patterns for persistence and streaming — no bespoke event-sourcing
- Billing/observability decorators unchanged (AiEvent internal contract preserved)

## Non-Goals

- Bespoke event-sourcing (no TranscriptEvent, no turn/seq, no run_events table)
- `run_artifacts` for message content — UIMessage persistence IS the transcript store
- Message editing/branching — messages grow only for MVP (no rewrite/delete of individual messages)
- Streaming delta persistence — UIMessage stores final state, not incremental deltas
- GDPR-compliant deletion in MVP — requires LangGraph checkpoint coordination (future)
- LangGraph checkpoint deduplication — `chat_threads` duplicates what LangGraph checkpoints hold for `langgraph_server` executor; optimize later

## Invariants

| Rule                      | Constraint                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER_OWNS_MESSAGES      | All messages persisted server-side in `chat_threads`. The LLM prompt is loaded from DB via `convertToModelMessages()`, never from client-supplied history.                                                                                                                                                                                                                               |
| CLIENT_SENDS_USER_ONLY    | Chat API accepts `{threadId, message: UIMessage}` where `message.role === "user"`. Server rejects assistant, tool, or system role in client-supplied message.                                                                                                                                                                                                                            |
| TOOLS_ARE_SERVER_AUTHORED | Tool-call and tool-result parts exist only because the server's graph executor emitted `tool_call_start`/`tool_call_result` AiEvents. No client path can create tool parts.                                                                                                                                                                                                              |
| PERSIST_AFTER_PUMP        | Response UIMessage (with text + tool parts) is persisted after `RunEventRelay.startPump()` completes. Client disconnect does not prevent persistence. Same drain guarantee billing depends on.                                                                                                                                                                                           |
| UIMESSAGE_IS_CONTRACT     | `chat_threads.messages` stores AI SDK `UIMessage[]` directly (JSONB). Parts-based: text, tool-call with lifecycle state, tool-result. No bespoke message shapes.                                                                                                                                                                                                                         |
| TENANT_SCOPED             | All `chat_threads` rows include `owner_user_id` (NOT NULL). RLS policy checks `owner_user_id = current_setting('app.current_user_id', true)`. Postgres enforces with `FORCE ROW LEVEL SECURITY`. Missing setting = access denied. Same pattern as `billing_accounts`.                                                                                                                    |
| TENANT_SCOPED_THREAD_ID   | Thread IDs MUST be tenant-scoped: `${ownerUserId}:${stateKey}`. The route validates that the `threadId` prefix matches the authenticated `owner_user_id` on every request — `owner_user_id` is authoritative, threadId prefix is verified, never trusted. LangGraph checkpoints use the same scoped ID.                                                                                  |
| REDACT_BEFORE_PERSIST     | PII masking applied to message content BEFORE `saveThread()`. Regex-based, best-effort (secrets-first: API keys, tokens). Stored content may still contain PII — retention and deletion must treat all content as personal data.                                                                                                                                                         |
| SOFT_DELETE_DEFAULT       | All reads filter `WHERE deleted_at IS NULL`. Hard delete via scheduled job (future).                                                                                                                                                                                                                                                                                                     |
| MESSAGES_GROW_ONLY        | `saveThread()` rejects any call where `newMessages.length < oldMessages.length`. The JSONB column is always overwritten (UPDATE), but the adapter enforces that messages only grow. Thread-level soft delete is the deletion primitive.                                                                                                                                                  |
| AIEVENT_NEVER_VERBATIM    | AiEvent is the internal stream contract between GraphExecutorPort, decorators, and RunEventRelay. AiEvent is never sent verbatim to the client — the route maps each AiEvent discriminant to the corresponding AI SDK stream part (e.g. `text_delta` → `text-delta`, `tool_call_start` → `tool-input-*`). The route also accumulates events into a response `UIMessage` for persistence. |
| LANGGRAPH_THREAD_DUALITY  | For `langgraph_server` executor, LangGraph checkpoints are the canonical thread state. `chat_threads` is a projection/cache for UI history display. Never reconstruct LangGraph conversation from `chat_threads`. For `inproc`/`claude_sdk` executors, `chat_threads` is the only record.                                                                                                |

### Schema

**Table:** `chat_threads`

| Column          | Type        | Constraints                   | Description                                                       |
| --------------- | ----------- | ----------------------------- | ----------------------------------------------------------------- |
| `id`            | uuid        | PK, DEFAULT gen_random_uuid() | Row identity                                                      |
| `thread_id`     | text        | NOT NULL, UNIQUE              | Conversation thread (tenant-scoped: `${ownerUserId}:${stateKey}`) |
| `owner_user_id` | text        | NOT NULL                      | Owner user ID for RLS (same column name as billing_accounts)      |
| `messages`      | jsonb       | NOT NULL, DEFAULT '[]'        | `UIMessage[]` — complete conversation history                     |
| `metadata`      | jsonb       | nullable                      | Thread-level metadata (model, graphName, etc.)                    |
| `created_at`    | timestamptz | NOT NULL, DEFAULT now()       | Thread creation time                                              |
| `updated_at`    | timestamptz | NOT NULL, DEFAULT now()       | Last message append time                                          |
| `deleted_at`    | timestamptz | nullable                      | Soft delete timestamp                                             |

**Indexes:**

- `UNIQUE(thread_id)` — one row per thread (upsert target)
- `INDEX(owner_user_id)` — RLS performance
- `INDEX(owner_user_id, updated_at DESC)` — thread list sorted by recency

**RLS:** Same pattern as `charge_receipts` / `billing_accounts`:

- Enable + force RLS on table
- `USING` + `WITH CHECK`: `owner_user_id = current_setting('app.current_user_id', true)`
- Missing setting returns NULL → denies all access
- **Transaction scope required:** Adapter runs in explicit DB transaction. `SET LOCAL app.current_user_id = $1` at transaction start (same as `packages/db-client/src/tenant-scope.ts`).

### Port Interface

```typescript
// src/ports/chat-persistence.port.ts

export interface ChatPersistencePort {
  /** Load thread messages. Returns empty array if thread doesn't exist. */
  loadThread(ownerUserId: string, threadId: string): Promise<UIMessage[]>;

  /**
   * Persist full message array (upsert). Creates thread if not exists.
   * MESSAGES_GROW_ONLY: rejects if messages.length < existing length.
   */
  saveThread(
    ownerUserId: string,
    threadId: string,
    messages: UIMessage[]
  ): Promise<void>;

  /** Soft delete thread. Sets deleted_at, messages still in DB for retention. */
  softDelete(ownerUserId: string, threadId: string): Promise<void>;

  /** List threads for owner, ordered by recency. */
  listThreads(
    ownerUserId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<ThreadSummary[]>;
}

export interface ThreadSummary {
  threadId: string;
  updatedAt: Date;
  messageCount: number;
  metadata?: Record<string, unknown>;
}
```

### File Pointers

| File                                                            | Purpose                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/ai-core/src/events/ai-events.ts`                      | AiEvent types — internal stream contract (unchanged)                |
| `src/ports/chat-persistence.port.ts`                            | New: `ChatPersistencePort` interface                                |
| `packages/db-schema/src/chat-threads.ts`                        | New: `chat_threads` table definition (Drizzle)                      |
| `src/adapters/server/ai/chat-persistence.adapter.ts`            | New: `DrizzleChatPersistenceAdapter` with RLS                       |
| `src/contracts/ai.chat.v1.contract.ts`                          | Refactor: accept `{threadId, message}` instead of `messages[]`      |
| `src/app/api/v1/ai/chat/route.ts`                               | Refactor: load→execute→persist flow, AiEvent→UIMessageStream bridge |
| `src/app/_facades/ai/completion.server.ts`                      | Refactor: remove `toCoreMessages()`, use `convertToModelMessages()` |
| `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` | Migrate: `useDataStreamRuntime` → `useChatRuntime`                  |
| `src/core/chat/model.ts`                                        | `Message` type — retained as internal executor format only          |

### Key Decisions

#### 1. UIMessage[] JSONB vs Normalized Message Rows

**Decision: JSONB per thread.**

- AI SDK's `saveChat()` pattern stores the full `UIMessage[]` array per save
- Tool-call parts are embedded in the assistant message (not separate rows) — normalizing would fight the type system
- Thread-level read/write is the only access pattern for chat
- If per-message search or individual deletion is needed later, normalize then

#### 2. AiEvent Stays Internal

**Decision: Keep AiEvent as-is, bridge at route layer.**

- AiEvent carries billing (`usage_report`), observability hooks, typed error codes — concerns AI SDK doesn't model
- Decorators (billing, observability) intercept AiEvent streams — changing AiEvent means rewriting working code
- The bridge from AiEvent → AI SDK stream parts is ~40 lines (already exists in similar form)
- AiEvent has 7 discriminants; AI SDK Data Stream has ~15 part types. Simpler for internal use.

#### 3. Terminology

| Term             | Meaning                                            | When to use       |
| ---------------- | -------------------------------------------------- | ----------------- |
| **Run**          | Single graph execution (runId)                     | Always            |
| **Thread**       | Conversation scope (threadId, multi-run)           | Always            |
| **UIMessage**    | AI SDK message type with parts — persistence shape | Persistence, wire |
| **ModelMessage** | AI SDK prompt format — LLM input shape             | Prompt assembly   |
| **AiEvent**      | Internal stream event (executor → route)           | Execution only    |
| **Conversation** | UI concept                                         | Never in backend  |

## Acceptance Checks

1. **Multi-turn persistence**
   - Send user message for turn 1 → response streamed, thread persisted
   - Send user message for turn 2 → server loads history from DB → LLM sees both turns
   - Assert: `chat_threads.messages` has user + assistant UIMessages with correct parts

2. **Fabricated message rejection**
   - POST with `message.role: "assistant"` → 400
   - POST with `message.role: "user"` + `{threadId}` → 200

3. **Tool persistence**
   - Execute graph with tool use → assert assistant UIMessage has tool-call + tool-result parts
   - Load thread → tool parts present in correct order with lifecycle states

4. **Disconnect safety**
   - Abort client mid-stream → assert thread still persisted (pump completed)

5. **Tenant isolation**
   - Query chat_threads without `SET LOCAL app.current_user_id` → access denied
   - Query with mismatched owner_user_id → no rows returned

6. **Billing unchanged**
   - Execute graph → usage_report events still consumed by BillingGraphExecutorDecorator
   - charge_receipts table has billing records (existing tests pass)

7. **Messages grow only**
   - `saveThread()` with fewer messages than currently stored → error thrown
   - Stack test: load thread with 3 messages, call saveThread with 2 → rejected

## Open Questions

- [ ] Should thread metadata include `lastModel` and `graphName` for thread list display?
- [ ] For `langgraph_server` executor: should `chat_threads` be written at all, or only for non-LangGraph executors? (Write for all — enables uniform thread list UI; LangGraph checkpoints remain canonical for execution)
- [ ] Retention policy: default days before soft-deleted threads are hard-deleted? (90 days proposed)

## Related

- [Graph Execution](./graph-execution.md) — AiEvent stream, billing decorator, RunEventRelay pump
- [AI Setup](./ai-setup.md) — AiEvent types, stream architecture
- [LangGraph Server](./langgraph-server.md) — Checkpoint ownership, thread_id scoping
- [LangGraph Patterns](./langgraph-patterns.md) — Graph patterns, tenant-scoped thread_id
- [Architecture](./architecture.md) — Hexagonal layers, port patterns
- [Database RLS](./database-rls.md) — RLS enforcement patterns
- [Usage History Project](../../work/projects/proj.usage-history-persistence.md) — Implementation roadmap
