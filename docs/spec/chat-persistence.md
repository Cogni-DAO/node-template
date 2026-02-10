---
id: chat-persistence
type: spec
title: Chat Persistence & Transcript Authority
status: draft
spec_state: draft
trust: draft
summary: Server-authoritative conversation persistence using core Message[] type via TranscriptStorePort. Route accepts current request shape but ignores client-supplied history — loads from store, appends server-authored messages after pump. In-memory adapter for P0; Drizzle DB adapter in P0.5. AiEvent remains the internal stream contract, unchanged.
read_when: Working on chat API, message persistence, multi-turn conversation state, or message security model
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

> Server owns conversation history as `Message[]` per thread via `TranscriptStorePort`. Route accepts the current request shape but ignores client-supplied assistant/tool/system history — extracts only the new user text. Before execution: loads thread from store, appends user message. After pump: builds response `Message[]` from existing route accumulators, appends to store. AiEvent is the internal executor/decorator stream contract — unchanged. No bespoke event-sourcing, no new dependencies.

### Key References

|              |                                                                        |                                          |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------- |
| **Project**  | [Usage History](../../work/projects/proj.usage-history-persistence.md) | Implementation roadmap                   |
| **Spec**     | [Graph Execution](./graph-execution.md)                                | AiEvent stream, billing decorator, pump  |
| **Package**  | `packages/ai-core/src/events/ai-events.ts`                             | AiEvent types (streaming, not persisted) |
| **Domain**   | `src/core/chat/model.ts`                                               | `Message` — persistence shape            |
| **Research** | [AI SDK Analysis](../research/ai-sdk-transcript-authority-analysis.md) | Design research and decision rationale   |

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ POST /api/v1/ai/chat  { messages, stateKey, model, graphName }  ← unchanged│
│                                                                             │
│  1. Extract user text from client input (ignore assistant/tool/system)      │
│  2. Build threadId: ${userId}:${stateKey}                                   │
│  3. Load: Message[] ← TranscriptStorePort.loadThread(threadId)             │
│  4. Append user Message to store                                            │
│  5. Execute: toCoreMessages(history) → graphExecutor.runGraph()            │
│  6. Stream: AiEvent → assistant-stream SSE to client (unchanged)           │
│  7. After pump: build response Message[] from route accumulators            │
│  8. Append response messages to store                                       │
│  9. Return: X-State-Key header (unchanged)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** The API contract is unchanged. Client still sends `{messages[], stateKey, model, graphName}`. Server accepts the request but ignores `messages[]` for history — loads from the store instead. Only the new user text is extracted from the client input. Zero client changes for P0.

### AiEvent → Stream → Persisted Message

AiEvent is the **internal** executor/decorator stream contract. The route bridges to assistant-stream (unchanged) and builds persisted `Message` objects from accumulated stream data:

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
    └─ Route handler
         ├─ assistant-stream controller ← SSE to client (unchanged)
         ├─ Route accumulators ← existing: accumulatedText, toolCallControllers,
         │                       assistantFinalContent
         └─ After pump → build Message[] from accumulators → store.appendMessages()
```

#### Event → Persisted Message Mapping

| AiEvent            | SSE (assistant-stream)            | Persisted Message                                                         |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------- |
| _(user text)_      | _(not streamed)_                  | `{ role: "user", content: userText }` — persisted before execution        |
| `text_delta`       | `appendText(delta)` (unchanged)   | Accumulated into `assistantFinalContent`                                  |
| `tool_call_start`  | `addToolCallPart()` (unchanged)   | `{ role: "assistant", content: "", toolCalls: [{id, name, args}] }`       |
| `tool_call_result` | `finalizeToolCall()` (unchanged)  | `{ role: "tool", content: JSON.stringify(result), toolCallId }`           |
| `assistant_final`  | Text reconciliation (unchanged)   | `{ role: "assistant", content: finalContent }` — authoritative final text |
| `usage_report`     | _(consumed by billing decorator)_ | Not persisted                                                             |
| `done`             | `message-finish` (unchanged)      | Triggers `store.appendMessages(responseMsgs)`                             |
| `error`            | `error` chunk (unchanged)         | Error logged; partial messages may not be persisted (best-effort)         |

### Persistence Model

The core `Message` type is the persistence shape:

```typescript
// src/core/chat/model.ts — unchanged, already exists
interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  toolCalls?: MessageToolCall[]; // assistant messages with tool use
  toolCallId?: string; // tool result messages
}
```

This is the same type used by the graph executor, LangGraph message converters, and the LLM. No translation layer — load from store, pass to executor directly via existing `toCoreMessages()`.

**P0: In-memory.** `InMemoryTranscriptStoreAdapter` with TTL-based eviction, LRU cap, and per-thread mutex. Data lost on restart (acceptable — DB persistence is P0.5).

**P0.5: DB persistence.** Swap adapter to `DrizzleTranscriptStoreAdapter`. Same port interface. See [Future: DB Schema](#future-db-schema-p05) below.

### Response Message Assembly

After the pump completes, the route builds `Message[]` from **existing route accumulators** — no new accumulator needed:

| Existing accumulator      | → Persisted Message                                             |
| ------------------------- | --------------------------------------------------------------- |
| `assistantFinalContent`   | `{ role: "assistant", content: assistantFinalContent }`         |
| `toolCallControllers` map | For each tool call: assistant `Message` with `toolCalls` array  |
| Tool call results         | `{ role: "tool", content: JSON.stringify(result), toolCallId }` |

The route already tracks `accumulatedText`, `assistantFinalContent`, and `toolCallControllers` for the assistant-stream bridge. Building `Message[]` from this data is ~15 lines after the existing stream loop, not a separate accumulator.

### Prompt Reconstruction

On each request, the server loads persisted messages and passes them to the executor:

```typescript
// Existing path, unchanged:
const history = await transcriptStore.loadThread(threadId);
// history is Message[] — same type toCoreMessages() already handles
const coreMessages = toCoreMessages(history, timestamp);
// Pass to graphExecutor.runGraph({ messages: coreMessages, ... })
```

No `convertToModelMessages()`, no AI SDK dependency, no type conversion.

### Client Transport (Unchanged in P0)

The client continues to use `useDataStreamRuntime` from `@assistant-ui/react-data-stream`. It still sends `{messages[], model, graphName, stateKey}` — the server accepts the request but ignores client-supplied messages for history.

**P1 target:** Migrate to `useChatRuntime` so the client sends only `{threadId, userText}`. This is a UX improvement, not a security fix — P0 already closes the transcript authority gap server-side.

## Goal

- Server owns all message history as `Message[]` in `TranscriptStorePort`
- Client cannot fabricate assistant/tool/system messages — server ignores client-supplied history
- Multi-turn works via server store (in-memory for P0, DB for P0.5)
- Tool messages are inherently server-authored (built from AiEvent stream accumulators)
- Zero new dependencies — uses existing `Message` type, `toCoreMessages()`, assistant-stream bridge
- Billing/observability decorators unchanged (AiEvent internal contract preserved)

## Non-Goals

- Bespoke event-sourcing (no TranscriptEvent, no turn/seq, no run_events table)
- `run_artifacts` for message content — transcript store IS the message record
- API contract change — client still sends `{messages[]}`, server ignores it (contract refactor is P1)
- Client transport migration — `useDataStreamRuntime` unchanged (P1)
- UIMessage persistence — `Message[]` is sufficient; evaluate UIMessage at P1
- Message editing/branching — append-only
- GDPR-compliant deletion — requires LangGraph checkpoint coordination (P2)

## Invariants

| Rule                      | Constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER_OWNS_MESSAGES      | All messages persisted server-side via `TranscriptStorePort`. The LLM prompt is loaded from store, never from client-supplied history.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CLIENT_HISTORY_IGNORED    | Route accepts current `{messages[]}` shape for backward compatibility but ignores client-supplied assistant/tool/system messages. Extraction rule: use `content` of the **last** message where `role === "user"`; if no user message exists or the last message is not `role: "user"`, return 400. All other messages in the array are discarded.                                                                                                                                                                                                         |
| TOOLS_ARE_SERVER_AUTHORED | Tool-call and tool-result `Message` objects exist only because the server's graph executor emitted `tool_call_start`/`tool_call_result` AiEvents. No client path can create tool messages.                                                                                                                                                                                                                                                                                                                                                                |
| PERSIST_AFTER_PUMP        | Response messages are appended to store after `RunEventRelay.startPump()` completes. Client disconnect does not prevent persistence. Same drain guarantee billing depends on.                                                                                                                                                                                                                                                                                                                                                                             |
| MESSAGE_IS_CONTRACT       | `TranscriptStorePort` stores the core `Message` shape directly. No UI-specific formats, no UIMessage, no bespoke message types.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| APPEND_ONLY               | Messages are logically append-only — never edited, reordered, or removed during normal operation. The message sequence only grows monotonically. Storage implementations may UPDATE container rows (e.g., JSONB column) but the logical message list must not shrink or mutate. Thread-level soft delete is the deletion primitive (P0.5+).                                                                                                                                                                                                               |
| TENANT_SCOPED_THREAD_ID   | Thread IDs are tenant-scoped: `${userId}:${stateKey}`. Route constructs threadId from authenticated userId (`SessionUser.id` = `users.id`) + client-provided stateKey. Tenant primitive is `userId` via `app.current_user_id` RLS setting; `billingAccountId` is 1:1 isomorphic (`billing_accounts.owner_user_id` UNIQUE). LangGraph thread derivation uses `billingAccountId:stateKey` — equivalent due to 1:1 constraint. **If multi-user accounts are ever introduced, this invariant must be revisited.**                                             |
| PERSIST_SIZE_CAPS         | `Message.content` is truncated at the persistence boundary before `appendMessages()`. Tool results: capped at `MAX_TOOL_RESULT_CHARS` (32KB, reuses contract constant). Assistant text: capped at `MAX_ASSISTANT_CONTENT_CHARS` (128KB). User text: capped at `MAX_MESSAGE_CHARS` (4KB, reuses contract constant). Truncated content ends with `\n[TRUNCATED]` marker. Tool results in `ToolCallResultEvent.result` are already redacted by the tool-runner pipeline (per `REDACTION_REQUIRED` in ai-core) — secrets are not a persistence risk; size is. |
| AIEVENT_UNCHANGED         | AiEvent is the internal stream contract between GraphExecutorPort, decorators, and RunEventRelay. No changes to AiEvent types, billing decorator, observability decorator, or stream bridge.                                                                                                                                                                                                                                                                                                                                                              |

### Port Interface

```typescript
// src/ports/transcript-store.port.ts

import type { Message } from "@/core";

/**
 * Port for server-owned transcript persistence.
 * P0: InMemoryTranscriptStoreAdapter (TTL + LRU + per-thread mutex)
 * P0.5: DrizzleTranscriptStoreAdapter (chat_threads table with RLS)
 */
export interface TranscriptStorePort {
  /** Load thread messages. Returns empty array if thread doesn't exist. */
  loadThread(threadId: string): Promise<Message[]>;

  /**
   * Append messages to a thread. Creates thread if not exists.
   *
   * SERIALIZED_APPENDS: Implementations MUST serialize appends per thread
   * to prevent lost messages under concurrent requests. Mechanisms:
   *   - In-memory: per-thread mutex (e.g., Map<threadId, Mutex>)
   *   - DB/JSONB: advisory lock or serializable transaction per threadId
   *   - DB/rows: INSERT-only (inherently safe, no read-modify-write)
   *
   * Does not validate — caller ensures messages are server-authored.
   */
  appendMessages(threadId: string, messages: Message[]): Promise<void>;
}
```

### File Pointers

| File                                                            | Purpose                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/core/chat/model.ts`                                        | `Message` type — persistence shape (unchanged)                       |
| `packages/ai-core/src/events/ai-events.ts`                      | AiEvent types — internal stream contract (unchanged)                 |
| `src/ports/transcript-store.port.ts`                            | New: `TranscriptStorePort` interface                                 |
| `src/adapters/server/ai/in-memory-transcript-store.adapter.ts`  | New: `InMemoryTranscriptStoreAdapter` (P0)                           |
| `src/app/api/v1/ai/chat/route.ts`                               | Modified: load from store, ignore client history, persist after pump |
| `src/contracts/ai.chat.v1.contract.ts`                          | Unchanged in P0 (contract refactor is P1)                            |
| `src/app/_facades/ai/completion.server.ts`                      | Minor: accept loaded messages instead of client-supplied DTOs        |
| `src/features/ai/services/mappers.ts`                           | Unchanged: `toCoreMessages()` still used                             |
| `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` | Unchanged in P0 (client transport migration is P1)                   |

### Future: DB Schema (P0.5)

When `DrizzleTranscriptStoreAdapter` replaces the in-memory adapter:

**Table:** `chat_threads`

| Column          | Type        | Constraints                   | Description                                                  |
| --------------- | ----------- | ----------------------------- | ------------------------------------------------------------ |
| `id`            | uuid        | PK, DEFAULT gen_random_uuid() | Row identity                                                 |
| `thread_id`     | text        | NOT NULL, UNIQUE              | Conversation thread (tenant-scoped: `${userId}:${stateKey}`) |
| `owner_user_id` | text        | NOT NULL                      | Owner user ID for RLS                                        |
| `messages`      | jsonb       | NOT NULL, DEFAULT '[]'        | `Message[]` — complete conversation history                  |
| `created_at`    | timestamptz | NOT NULL, DEFAULT now()       | Thread creation time                                         |
| `updated_at`    | timestamptz | NOT NULL, DEFAULT now()       | Last message append time                                     |
| `deleted_at`    | timestamptz | nullable                      | Soft delete timestamp                                        |

**RLS:** `owner_user_id = current_setting('app.current_user_id', true)` (same pattern as `billing_accounts`).

### Future: Contract Refactor + UIMessage (P1)

When the client transport migrates to `useChatRuntime`:

- Contract changes to accept `{threadId, userText}` instead of `{messages[]}`
- Client sends only user text — no history at all
- Evaluate `UIMessage` as persistence shape (enables AI SDK `convertToModelMessages()`)
- If adopted: `Message[]` → `UIMessage[]` migration in `chat_threads.messages` JSONB column

## Key Decisions

#### 1. Message[] not UIMessage[] for P0

**Decision: Use existing core `Message` type.**

- `Message` is already the executor contract, LLM prompt shape, and LangGraph converter format
- Zero new dependencies, zero type conversion chain
- UIMessage requires adding `ai` package + `convertToModelMessages()` — adds dep for P0 with no benefit
- Evaluate UIMessage migration at P1 when client transport changes

#### 2. In-Memory Before DB

**Decision: In-memory store for P0, DB for P0.5.**

- The security fix (server owns history) doesn't require DB persistence
- Shipping in-memory first means P0 is 3 new files, 1 modified file, zero schema migrations
- Same port interface → swap adapter in P0.5 without touching route/facade

#### 3. AiEvent Stays Internal

**Decision: Keep AiEvent as-is, bridge at route layer.**

- AiEvent carries billing (`usage_report`), observability hooks, typed error codes
- Decorators (billing, observability) intercept AiEvent streams — don't touch working code
- assistant-stream bridge in route is unchanged

#### 4. Terminology

| Term             | Meaning                                  | When to use      |
| ---------------- | ---------------------------------------- | ---------------- |
| **Run**          | Single graph execution (runId)           | Always           |
| **Thread**       | Conversation scope (threadId, multi-run) | Always           |
| **Message**      | Core domain type — persistence shape     | Persistence      |
| **AiEvent**      | Internal stream event (executor → route) | Execution only   |
| **Conversation** | UI concept                               | Never in backend |

## Acceptance Checks

1. **Fabricated message rejection**
   - Send request with client-supplied assistant/tool messages → server ignores them
   - Load thread from store → only server-authored messages present

2. **Multi-turn persistence**
   - Send user text for turn 1 → response streamed, messages persisted in store
   - Send user text for turn 2 → server loads history from store → LLM sees both turns
   - Assert: store has user + assistant + tool Messages for turn 1

3. **Tool persistence**
   - Execute graph with tool use → assert assistant `Message` has `toolCalls`, tool `Message` has `toolCallId`
   - Load thread → tool messages present in correct order

4. **Disconnect safety**
   - Abort client mid-stream → assert messages still persisted (pump completed)

5. **Concurrent safety (SERIALIZED_APPENDS)**
   - Fire two concurrent requests to the same threadId → both complete, no messages lost
   - Assert: store contains all messages from both requests in arrival order
   - A test without serialization (e.g., naive array push) MUST fail this check

6. **Tool result truncation**
   - Persist a tool result `Message` with `content` > 32KB → stored content truncated to 32KB with `\n[TRUNCATED]` marker
   - Assert: `loadThread()` returns truncated content, not the original oversized payload

7. **Assistant content truncation**
   - Persist an assistant `Message` with `content` > 128KB → stored content truncated with `\n[TRUNCATED]` marker
   - Assert: `loadThread()` returns truncated content

8. **Billing unchanged**
   - Execute graph → `usage_report` events still consumed by `BillingGraphExecutorDecorator`
   - `charge_receipts` table has billing records (existing tests pass)

## Open Questions

- [ ] For `langgraph_server` executor: LangGraph checkpoints already hold messages. Store duplicates for uniform history, or skip for langgraph runs? (Proposed: store for all — enables uniform thread list; LangGraph checkpoints remain canonical for execution)
- [ ] P0.5 JSONB vs normalized rows: JSONB per thread is simpler, but concurrent appends require read-modify-write. Normalized rows allow INSERT-only appends. Decide at P0.5.
- [ ] Retention policy: default days before soft-deleted threads are hard-deleted? (90 days proposed, P2)

## Related

- [Graph Execution](./graph-execution.md) — AiEvent stream, billing decorator, RunEventRelay pump
- [AI Setup](./ai-setup.md) — AiEvent types, stream architecture
- [LangGraph Server](./langgraph-server.md) — Checkpoint ownership, thread_id scoping
- [LangGraph Patterns](./langgraph-patterns.md) — Graph patterns, tenant-scoped thread_id
- [Architecture](./architecture.md) — Hexagonal layers, port patterns
- [Usage History Project](../../work/projects/proj.usage-history-persistence.md) — Implementation roadmap
