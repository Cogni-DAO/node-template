# Usage History Design

> [!CRITICAL]
> Usage history persists message artifacts from AI runs (user input, assistant output). It is a parallel AiEvent stream consumer to billing—neither blocks the other. Not all runs are "conversations."

## Core Invariants

1. **RUN_SCOPED_HISTORY**: All history records reference `run_id`. A run may have 0..N message artifacts.

2. **PARALLEL_TO_BILLING**: HistoryWriterSubscriber consumes AiEvent stream alongside BillingSubscriber. Neither depends on the other. Both are idempotent. RunEventRelay fans out via per-subscriber queues (non-blocking); slow subscribers do not block UI streaming.

3. **IDEMPOTENT_WRITES**: `UNIQUE(run_id, artifact_key)` prevents duplicate inserts on replay. Adapter uses `ON CONFLICT DO NOTHING`, then SELECTs existing row to compare `content_hash`. If hash mismatch, emit error metric (runId + artifactKey only, never content/hashes). Same pattern as billing.

4. **USER_ARTIFACT_AT_START**: User input artifact persisted immediately on run start (before execution). Survives graph crash.

5. **ASSISTANT_FINAL_SINGLE_EMIT**: Executors emit exactly one `assistant_final` event per run with final content. HistoryWriter persists it directly—no delta parsing. Duplicate events are idempotent (logged, not stored twice).

6. **NO_DELTA_STORAGE**: P0 does NOT persist streaming deltas. Only user input + final assistant output. Delta storage is P2+ if needed for replay UX.

7. **RETRY_IS_NEW_RUN**: A retry creates a new `run_id`. No `attempt` field in P0—lineage/retry semantics are P1+ (requires `runs` table).

8. **ARTIFACTS_ARE_CACHE**: `run_artifacts` is a transcript cache for audit/billing/activity—NOT the source of truth for LangGraph state. LangGraph checkpointer owns graph memory; run_artifacts caches final messages for cross-executor use.

9. **THREAD_ID_PROPAGATION**: For LangGraph runs, `thread_id` flows: `GraphRunRequest.threadId` → LangGraph config → relay context → `run_artifacts.thread_id`. Enables resume/time-travel correlation.

10. **RELAY_PROVIDES_CONTEXT**: RunEventRelay provides run context (`runId`, `threadId`) to subscribers. Events are pure payloads without these fields; subscribers receive context from relay. This prevents cross-run attribution bugs.

11. **LANGGRAPH_POSTGRES_SAVER**: LangGraph.js uses self-hosted `PostgresSaver` checkpointer (not LangSmith Threads API). Thread creation is implicit—`thread_id` is just the checkpointer key passed in config. Checkpoint metadata (`checkpointId`, `checkpointNs`) is LangGraph-only; UI must not depend on it in P0.

---

## Implementation Checklist

### P0: Minimal Message Persistence

Persist user input and assistant final output per run. No tool call/result storage yet.

- [ ] Create `RunHistoryPort` interface in `src/ports/run-history.port.ts`
- [ ] Create `run_artifacts` table (see Schema below)
- [ ] Create `DrizzleRunHistoryAdapter` in `src/adapters/server/ai/`
- [ ] Wire `HistoryWriterSubscriber` into `RunEventRelay` fanout (parallel to billing)
- [ ] Persist user artifact at run start in `AiRuntimeService.runGraph()`
- [ ] Add `AssistantFinalEvent` to AiEvent union in `@/types/ai-events.ts`
- [ ] Executors emit `assistant_final` event (LangGraph: from state; direct LLM: assembled from deltas)
- [ ] Persist assistant artifact on `assistant_final` event in `HistoryWriterSubscriber`
- [ ] Add idempotency test: replay `assistant_final` twice → 1 assistant artifact row

#### Chores

- [ ] Observability instrumentation [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation updates [document.md](../.agent/workflows/document.md)

### P1: Tool Call Artifacts (Optional)

Enable if graph tool-calling requires audit/replay.

- [ ] Add `tool_call` artifact type: `{toolName, argsRedacted, resultSummary}`
- [ ] Persist tool artifacts via HistoryWriterSubscriber on `tool_call_result` events
- [ ] Stack test: graph with tool calls → tool artifacts persisted

### P1+: Run Lineage (Future)

Add `graph_runs` table for retry/resume semantics if needed.

- [ ] Evaluate need after P0
- [ ] Add `graph_runs` table: `{run_id PK, parent_run_id?, status, executor_type, graph_name?, timestamps}`
- [ ] Attempt = computed from lineage chain depth
- [ ] **Do NOT build preemptively**

### P2: Thread Linking (Future)

Thread = LangGraph thread_id scope (multi-run accumulation). For non-LangGraph, thread groups related runs.

- [ ] Evaluate need after P1
- [ ] Index on `thread_id` for thread-level queries
- [ ] Add `previous_run_id` column if explicit chaining needed
- [ ] **Do NOT build preemptively**

---

## File Pointers (P0 Scope)

| File                                            | Change                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| `src/ports/graph-executor.port.ts`              | Add `threadId?: string` to `GraphRunRequest`   |
| `src/ports/run-history.port.ts`                 | New: `RunHistoryPort` interface                |
| `src/ports/index.ts`                            | Re-export `RunHistoryPort`                     |
| `src/shared/db/schema.history.ts`               | New: `run_artifacts` table                     |
| `src/adapters/server/ai/run-history.adapter.ts` | New: `DrizzleRunHistoryAdapter`                |
| `src/features/ai/services/ai_runtime.ts`        | Persist user artifact at run start             |
| `src/features/ai/services/history-writer.ts`    | New: HistoryWriterSubscriber consumes AiEvents |
| `src/bootstrap/container.ts`                    | Wire RunHistoryPort                            |
| `src/types/ai-events.ts`                        | Add `AssistantFinalEvent` to AiEvent union     |
| `tests/stack/ai/history-idempotency.test.ts`    | New: replay assistant_final twice → 1 row      |
| `tests/ports/run-history.port.spec.ts`          | New: port contract test                        |

---

## Schema

**New table: `run_artifacts`**

| Column         | Type        | Notes                                         |
| -------------- | ----------- | --------------------------------------------- |
| `id`           | uuid        | PK                                            |
| `run_id`       | text        | NOT NULL                                      |
| `thread_id`    | text        | Nullable (LangGraph thread scope)             |
| `artifact_key` | text        | NOT NULL, e.g. `user/0`, `assistant/final`    |
| `role`         | text        | NOT NULL, `user` \| `assistant` \| `tool`     |
| `content`      | text        | Nullable (text content)                       |
| `content_hash` | text        | Nullable (sha256 hex for mismatch detection)  |
| `content_json` | jsonb       | Nullable (reserved; unused in P0)             |
| `content_ref`  | text        | Nullable (blob storage ref for large content) |
| `metadata`     | jsonb       | Nullable (model, finishReason, etc.)          |
| `created_at`   | timestamptz |                                               |

**Constraints:**

- `UNIQUE(run_id, artifact_key)` — idempotency (one artifact per key per run)
- Index on `run_id` for run-level queries
- Adapter uses `INSERT ... ON CONFLICT DO NOTHING` for idempotent writes

**Hashing rule:** If `content_json != null`, hash stable JSON stringify; else hash `utf8(content)`. Store sha256 hex. Adapter computes on persist; on conflict, SELECT existing hash and compare. Mismatch = error metric (runId + artifactKey only, never content/hashes).

**Idempotency key format:**

| Role        | artifact_key        | When persisted                           |
| ----------- | ------------------- | ---------------------------------------- |
| `user`      | `user/0`            | Run start (before graph execution)       |
| `assistant` | `assistant/final`   | On `assistant_final` event               |
| `tool`      | `tool/{toolCallId}` | P1: On `tool_call_result` (if persisted) |

**Why no `conversation_id`?** Conversations are a UI concept. The underlying primitive is runs. Session/conversation grouping is P2 if needed.

**Why `content` + `content_ref`?** Small messages inline; large messages (images, docs) go to blob storage with a ref. P0: inline only.

**Metadata fields (P0 minimum):** Since no `runs` table exists in P0, artifact metadata carries run-level info for debugging:

- `assistant/final` metadata: `{model, finishReason, executorType, graphName?}`
- `user/0` metadata: `{selectedModel, executorType}`
- LangGraph runs: executor may add `{checkpointId?, checkpointNs?}` to metadata for time-travel correlation (optional, UI must not depend on it)

---

## Design Decisions

### 1. Run vs Thread vs Conversation Terminology

| Term             | Meaning                                         | When to use      |
| ---------------- | ----------------------------------------------- | ---------------- |
| **Run**          | Single graph execution (runId)                  | Always           |
| **Thread**       | LangGraph thread scope (multi-run accumulation) | LangGraph runs   |
| **Conversation** | UI concept over thread/runs                     | Never in backend |

**Rule:** Backend uses `run` and `thread`. Frontend may present as "conversation" but never passes that term to API.

---

### 2. Stream Consumer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ AiRuntimeService.runGraph(request)                                  │
│ ─────────────────────────────                                       │
│ 1. Generate run_id; persist USER artifact (idempotent)              │
│ 2. Call executor → get stream                                       │
│ 3. Start RunEventRelay.pump() → fanout to subscribers               │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┬───────────────┐
              ▼               ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐ ┌─────────────┐
│ UI Subscriber   │ │ Billing Sub     │ │ History Sub       │ │ (Future)    │
│ ──────────────  │ │ ───────────     │ │ ───────────       │ │             │
│ May disconnect  │ │ commitUsageFact │ │ persistArtifact   │ │             │
│                 │ │ on usage_report │ │ on assistant_final│ │             │
└─────────────────┘ └─────────────────┘ └───────────────────┘ └─────────────┘
```

**Key point:** HistoryWriterSubscriber is parallel to BillingSubscriber. Both consume the same AiEvent stream. Neither blocks the other.

**Content strategy:** All executors emit `assistant_final` event with content. HistoryWriter persists directly—no delta parsing required.

```typescript
// New AiEvent type (add to @/types/ai-events.ts)
export interface AssistantFinalEvent {
  readonly type: "assistant_final";
  readonly content: string;
  // No runId/threadId here - relay provides context per RELAY_PROVIDES_CONTEXT
}
```

**Why `assistant_final` instead of buffering?** Decouples HistoryWriter from executor internals. LangGraph extracts final message from state; direct LLM assembles from deltas. Both emit the same event type. Relay provides `runId`/`threadId` context to subscribers.

---

### 3. Idempotency Key Strategy

**Format:** `${role}/${qualifier}`

| artifact_key      | Uniqueness scope         |
| ----------------- | ------------------------ |
| `user/0`          | One user input per run   |
| `assistant/final` | One final output per run |
| `tool/{callId}`   | One per tool invocation  |

**Why this format?** Simple, explicit, and self-documenting. No attempt field in P0—retries create new runs.

---

### 4. ONE_HISTORY_WRITER Enforcement

Only `history-writer.ts` may call `runHistoryPort.persistArtifact()`.

**Depcruise rule** (add to `.dependency-cruiser.cjs`):

```javascript
{
  name: "one-history-writer",
  severity: "error",
  from: {
    path: "^src/features/",
    pathNot: "^src/features/ai/services/history-writer\\.ts$"
  },
  to: {
    path: "^src/ports/run-history\\.port"
  }
}
```

---

### 5. What We're NOT Building in P0

**Explicitly deferred:**

- Streaming delta persistence (full message replay)
- Thread-level queries/indexes
- Content blob storage (large messages)
- Tool call/result persistence
- Message threading/branching
- Edit/regenerate lineage
- LangGraph checkpointer integration (runs use checkpointer directly; artifacts are cache)

**Why:** Start minimal. Validate run-scoped artifacts work before adding complexity.

---

## Port Interface

```typescript
// src/ports/run-history.port.ts

export interface RunArtifact {
  readonly runId: string;
  readonly threadId?: string; // LangGraph thread scope (nullable)
  readonly artifactKey: string;
  readonly role: "user" | "assistant" | "tool";
  readonly content?: string;
  readonly contentHash?: string; // sha256 hex (computed by adapter)
  readonly contentRef?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RunHistoryPort {
  /**
   * Persist a run artifact. Computes content_hash (from content_json if set, else content).
   * Idempotent: duplicate (runId, artifactKey) is no-op; emits error metric on hash mismatch.
   */
  persistArtifact(artifact: RunArtifact): Promise<void>;

  /**
   * Retrieve artifacts for a run.
   * Returns deterministic order: ORDER BY created_at ASC, id ASC.
   */
  getArtifacts(runId: string): Promise<readonly RunArtifact[]>;
}
```

---

## Integration Points

**GraphRunRequest change:** Add `threadId?: string` to `src/ports/graph-executor.port.ts`:

```typescript
export interface GraphRunRequest {
  readonly runId: string;
  readonly threadId?: string; // LangGraph thread scope (optional)
  // ... existing fields
}
```

---

## Related Documents

- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — Run-centric billing, RunEventRelay, pump+fanout
- [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md) — AiEvent types, stream architecture
- [ARCHITECTURE.md](ARCHITECTURE.md) — Hexagonal layers, port patterns

---

**Last Updated**: 2025-12-22
**Status**: Draft (P0 Design)
