---
id: research.ai-sdk-transcript-authority
type: research
title: "AI SDK + assistant-ui: Server Transcript Authority Analysis"
status: draft
trust: draft
summary: Research analysis comparing AI SDK UIMessage persistence + assistant-ui runtime patterns against our bespoke AiEvent/run_artifacts design, with recommendation and MVP plan.
read_when: Evaluating chat persistence architecture decisions or AI SDK adoption rationale
created: 2026-02-10
owner: cogni-dev
tags:
  - ai-graphs
  - architecture
  - research
---

# AI SDK + assistant-ui: Server Transcript Authority Analysis

## Recommendation

**Keep AiEvent as-is; bridge to AI SDK `UIMessage` persistence at the route layer.** Adopt AI SDK 5's `UIMessage` + `parts` as the persisted message schema (replacing our proposed `chat_messages` flat table and the `run_artifacts` projection). AiEvent remains the internal GraphExecutor stream contract — bridged into assistant-stream wire format exactly as today, with a new `onFinish` persistence hook.

---

## Findings

### 1. AI SDK 5/6 Message Persistence Model

AI SDK 5 (July 2025) introduced a strict split:

| Type               | Role                                                           | Persisted?                                        |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------- |
| **`UIMessage`**    | Application state: `{id, role, parts[], metadata, createdAt}`  | Yes — this is the persistence contract            |
| **`ModelMessage`** | LLM prompt format: `{role, content}` (was `CoreMessage` in v4) | No — reconstructed from UIMessage on each request |

**Key insight:** `UIMessage.parts[]` is a typed array (text, tool-call with lifecycle state, reasoning, sources, files, custom data). Tool calls and results live **inside the same assistant message as parts** — not as separate rows. This means one persisted `UIMessage[]` per thread captures the full conversation including all tool interactions.

**Canonical server pattern** (from AI SDK docs):

```
Client sends: { message: UIMessage (just the new user msg), id: threadId }
Server: loadChat(threadId) → validate → convertToModelMessages() → streamText() → onFinish: saveChat()
```

The client sends **only the latest user message**. Server loads history from DB, appends, runs LLM, persists the updated `UIMessage[]` array in `onFinish`.

**Sources:** [AI SDK Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence), [AI SDK UIMessage reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message)

### 2. assistant-ui Runtime Options

We currently use `@assistant-ui/react-data-stream` with `useDataStreamRuntime` — this is the **legacy** approach for AI SDK v4 / custom backends.

The upgrade path:

| Runtime                                       | Sends full history?                         | Server authority?                     | Our fit                                |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------- | -------------------------------------- |
| `useChatRuntime` (@assistant-ui/react-ai-sdk) | Sends only last message (AI SDK v5 pattern) | Yes — `onFinish` persists server-side | **Best fit**                           |
| `useDataStreamRuntime` (current)              | Sends full history                          | No — client-authoritative             | Current (deprecated path)              |
| `ExternalStoreRuntime`                        | You control everything                      | Maximum server authority              | Overkill — more wiring for same result |

**Recommended migration:** Replace `@assistant-ui/react-data-stream` → `@assistant-ui/react-ai-sdk` with `useChatRuntime`. This gives us:

- Client sends only the new user message (threadId + message)
- Server reconstructs prompt from persisted `UIMessage[]`
- Streaming uses AI SDK Data Stream Protocol (SSE) natively
- Tool call UI rendering works out of the box

**Source:** [assistant-ui AI SDK v5 integration](https://www.assistant-ui.com/docs/runtimes/ai-sdk/use-chat), [Picking a Runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime)

### 3. Wire Protocol: AI SDK Data Stream vs assistant-stream

Our current route uses `createAssistantStreamResponse` from `assistant-stream` to map AiEvent → SSE. AI SDK 5+ uses `toUIMessageStreamResponse()` which produces a similar SSE stream with typed parts (text-start/delta/end, tool-input-start/delta/available, tool-output-available, finish).

**These are compatible.** The `@assistant-ui/react-ai-sdk` package consumes the AI SDK Data Stream Protocol. We can either:

- (A) Use `streamText().toUIMessageStreamResponse()` directly (if we make GraphExecutor speak AI SDK), or
- (B) Use `createUIMessageStream()` to manually emit AI SDK stream parts from AiEvent (adapter pattern)

Option (B) is the smallest diff — keep AiEvent internally, bridge at the route.

### 4. What Becomes Unnecessary

If we adopt AI SDK `UIMessage` persistence:

| Current spec/concept                                           | Disposition                                                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_messages` table (server-transcript-authority.md)         | **Replace** with `UIMessage[]` JSON storage per thread (or normalized equivalent)                                                                    |
| `run_artifacts` table (proj.usage-history-persistence.md P0)   | **Largely unnecessary** — UIMessage persistence IS the artifact store. `run_artifacts` becomes a billing/audit concern only, not message persistence |
| `Message` type from `src/core/chat/model.ts`                   | **Retire for persistence** — `UIMessage` replaces it. Keep `Message` only as internal executor format (it maps to `ModelMessage`)                    |
| `toCoreMessages()` in completion facade                        | **Replace** with `convertToModelMessages()` from AI SDK                                                                                              |
| `AssistantFinalEvent` for persistence                          | **Still needed** — but used to construct the persisted `UIMessage` parts, not stored separately                                                      |
| PII masking before persist (proj.usage-history-persistence.md) | **Still needed** — apply before `saveChat()`                                                                                                         |
| HistoryWriterSubscriber fanout                                 | **Unnecessary** — persistence moves to route-level `onFinish` callback                                                                               |
| Custom message-to-wire mapping in route.ts                     | **Simplified** — `createUIMessageStream` + merge replaces manual `controller.appendText()` etc.                                                      |

### 5. Does AiEvent Need Refactoring?

**No.** AiEvent is the right abstraction at the GraphExecutor boundary. Here's why:

- AiEvent carries concerns AI SDK doesn't model: `usage_report` (billing), `assistant_final` (reconciliation), typed `error` codes
- The decorator stack (billing, observability) intercepts AiEvent — changing it would require rewriting two working decorators
- The mapping from AiEvent → AI SDK stream parts is small and mechanical (see table below)
- AiEvent is 7 discriminants; AI SDK Data Stream is ~15 part types. AiEvent is simpler for internal use

The adapter layer (AiEvent → UIMessageStream parts) is ~40 lines in the route handler and already exists in similar form today.

---

## Mapping: AiEvent → AI SDK Stream Part → Persisted UIMessage Part

| AiEvent            | AI SDK Stream Part                                               | Persisted in UIMessage.parts                                                  |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `text_delta`       | `text-delta` (within text-start/end block)                       | `{ type: "text", text: "..." }`                                               |
| `tool_call_start`  | `tool-input-start` + `tool-input-delta` + `tool-input-available` | `{ type: "tool-call", toolCallId, toolName, args, state: "input-available" }` |
| `tool_call_result` | `tool-output-available`                                          | Same part updated: `{ ..., result, state: "output-available" }`               |
| `assistant_final`  | _(no direct equivalent)_                                         | Used for text reconciliation; final text part in UIMessage                    |
| `usage_report`     | _(internal only)_                                                | Not persisted in UIMessage. Billing decorator consumes.                       |
| `done`             | `finish`                                                         | Triggers `onFinish` → `saveChat()`                                            |
| `error`            | `error`                                                          | Error part or message metadata                                                |

**Key:** The route handler bridges AiEvent → AI SDK stream parts using `createUIMessageStream()`. The `onFinish` callback receives the completed `UIMessage[]` and persists them.

---

## MVP Plan (3 PRs, ~1.5 weeks)

### PR 1: Persistence Layer — UIMessage Storage (3 days)

**Scope:**

- Create `chat_threads` table: `{id, thread_id (unique), tenant_id, messages JSONB, created_at, updated_at}`
- Implement `loadChat(threadId)` → `UIMessage[]` and `saveChat(threadId, messages: UIMessage[])`
- RLS on `tenant_id` (same pattern as `charge_receipts`)
- Drizzle schema + migration
- Port interface: `ChatPersistencePort` with `loadThread / saveThread`

**Acceptance:**

- `saveChat` then `loadChat` round-trips `UIMessage[]` with parts (text + tool-call + tool-result)
- RLS prevents cross-tenant reads
- Stack test: persist 2-turn conversation with tool use, reload, verify ordering + parts integrity

**Does NOT change:** route handler, client transport, AiEvent stream, wire format

### PR 2: Route Bridge — AiEvent → UIMessage Persistence + AI SDK Stream (3 days)

**Scope:**

- Add `ai` package (Vercel AI SDK 5+) as dependency
- In chat route: load thread messages from DB before execution
- Convert persisted `UIMessage[]` → `ModelMessage[]` via `convertToModelMessages()` (replaces `toCoreMessages()`)
- After stream completes (pump done): construct response `UIMessage` from AiEvent stream events, persist via `saveChat()`
- Bridge AiEvent → `createUIMessageStream()` parts for wire format (replaces `createAssistantStreamResponse`)
- Contract change: accept `{threadId, message: UIMessage}` instead of `{messages: AssistantUiMessage[]}`
- Keep `assistant_final` for text reconciliation (existing pattern)

**Acceptance:**

- Multi-turn: send user text → get response → send another → server loads history from DB → LLM sees both turns
- Tool use persisted: tool-call + tool-result parts in stored `UIMessage`
- Client disconnect mid-stream → messages still persisted (pump-to-completion unchanged)
- Billing decorators still work (AiEvent stream unchanged internally)
- POST with fabricated assistant messages in `message` field → 400

### PR 3: Client Migration — assistant-ui Runtime Upgrade (2 days)

**Scope:**

- Replace `@assistant-ui/react-data-stream` → `@assistant-ui/react-ai-sdk`
- Replace `useDataStreamRuntime` → `useChatRuntime` with `api: "/api/v1/ai/chat"`
- Client now sends only the new user message + threadId (not full history)
- Thread history loaded from server on mount (via `useChatRuntime` initialMessages or history adapter)
- Remove `AssistantUiMessage[]` from contract input schema

**Acceptance:**

- Chat works: type message → stream response → type another → multi-turn works
- Network tab: POST body contains only 1 message (not full history)
- Page refresh → conversation history reloaded from server
- Tool call UI renders correctly during streaming
- Billing summary refreshes on completion (existing `onFinish` behavior preserved)

---

## What This Supersedes

If this plan is adopted:

1. **`docs/spec/server-transcript-authority.md`** — The `chat_messages` table schema (flat rows per message) is replaced by `chat_threads` with `UIMessage[]` JSONB. The invariants (SERVER_OWNS_MESSAGES, CLIENT_SENDS_USER_ONLY, TOOLS_ARE_SERVER_AUTHORED, PERSIST_AFTER_PUMP, APPEND_ONLY) all still hold — just implemented via AI SDK patterns instead of bespoke.

2. **`work/projects/proj.usage-history-persistence.md` P0** — The `run_artifacts` table for message persistence becomes unnecessary. `UIMessage[]` in `chat_threads` IS the persisted transcript. `run_artifacts` can be reduced to a billing audit concern only (store `run_id → usage summary`, not message content). The masking, tenant isolation, and soft-delete requirements still apply to `chat_threads`.

3. **`HistoryWriterSubscriber`** — Not needed. Persistence happens at the route level in `onFinish`, not via a fanout subscriber.

4. **`RunHistoryPort`** — Replace with `ChatPersistencePort` that stores `UIMessage[]`, not `run_artifacts`.

## Open Questions

- **JSONB vs normalized:** Storing `UIMessage[]` as a single JSONB column per thread is simplest and matches AI SDK's `saveChat()` pattern. But if we need per-message queries (search, individual delete), we'd need to normalize into rows. Start with JSONB; normalize only if needed.
- **Thread ID generation:** AI SDK expects client to send `id` (threadId). Our current `stateKey` maps to this. Server should validate and scope it: `${tenantId}:${stateKey}`.
- **LangGraph checkpoint coordination:** LangGraph Server executor already persists its own checkpoints. For those executors, `chat_threads` is a cache/projection. The `convertToModelMessages()` path may not apply since LangGraph manages its own prompt assembly. Address in a follow-up PR.
