---
id: openclaw-thread-persistence-duplication
type: research
title: "Thread Persistence Scoping: ai_threads vs Executor State vs Industry Patterns"
status: active
trust: reviewed
verified: 2026-02-11
summary: Analysis of ai_threads persistence scoping against OpenClaw's JSONL transcripts, LangGraph checkpoints, and industry patterns (OpenAI Conversations API, AI SDK). Identifies sandbox opacity as the real gap — ai_threads loses all intermediate tool-use for black-box executors. Recommends dual-store UI projection for P0, gateway streaming enrichment for P1.
read_when: Working on thread persistence, OpenClaw multi-turn, sandbox observability, or evaluating executor state ownership
owner: cogni-dev
created: 2026-02-11
tags: [ai-graphs, sandbox, openclaw, data, architecture]
---

# Thread Persistence Scoping: ai_threads vs Executor State vs Industry Patterns

> date: 2026-02-11

## Questions

1. When `ai_threads` stores `UIMessage[]` per thread AND external executors (OpenClaw, LangGraph Server) maintain their own conversation state, what data duplication results?
2. Is `ai_threads` persistence **under-scoped**? Should we model after OpenClaw's richer transcript format?
3. How do top AI teams (OpenAI, Vercel/AI SDK) handle this persistence?
4. Is the gateway session key (`runId`-based) actually broken for multi-turn?

## Context

The [thread-persistence spec](../spec/thread-persistence.md) establishes `ai_threads` as the server-authoritative store for all conversation history as `UIMessage[]` JSONB. The P0 flow: load from DB → append user message → convert → run graph → accumulate response UIMessage from AiEvents → persist.

Meanwhile, external executors manage their own conversation state:

| Executor           | Internal State Store          | Format                           | Lifecycle                  |
| ------------------ | ----------------------------- | -------------------------------- | -------------------------- |
| In-proc LangGraph  | None (stateless per run)      | —                                | Destroyed after run        |
| LangGraph Server   | Checkpoints (sqlite/postgres) | LangGraph checkpoint format      | Persistent                 |
| OpenClaw Ephemeral | Workspace filesystem          | JSONL (`{sessionId}.jsonl`)      | Destroyed with container   |
| OpenClaw Gateway   | `OPENCLAW_STATE_DIR` sessions | JSONL + `sessions.json` metadata | Persistent across requests |

The thread-persistence spec already acknowledges the tension:

> `langgraph_server` executor manages its own history via checkpoints — it would receive only the new user message, not the full thread. History loading is a caller decision based on executor type. The `ai_threads` table always stores the full UIMessage[] regardless of executor, so the UI has a uniform thread history view.

## Findings

### 1. The Duplication Map

```
                    Execution-time state        Persistent state (after run)
                    ────────────────────        ──────────────────────────────
In-proc LangGraph   In-memory Message[]    →    ai_threads only              ← NO DUPLICATION
LangGraph Server    Checkpoints            →    ai_threads + checkpoints     ← DUAL STORE
OpenClaw Ephemeral  Container filesystem   →    ai_threads only              ← NO DUPLICATION
OpenClaw Gateway    JSONL transcripts      →    ai_threads + JSONL           ← DUAL STORE
```

The duplication is not byte-identical. The stores have different granularity:

| Aspect          | `ai_threads` (UIMessage[])                                                                                            | OpenClaw JSONL                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Granularity** | User message + final assistant response per Cogni request                                                             | Every intermediate LLM turn including all tool-use loops                 |
| **Tool calls**  | Collapsed into assistant UIMessage parts (tool-call + tool-result) — **but only if executor emits AiEvents for them** | Separate message entries per tool turn                                   |
| **Format**      | AI SDK UIMessage with typed parts                                                                                     | OpenAI-format messages with usage metadata                               |
| **Compaction**  | None (grow-only, max 200 messages)                                                                                    | OpenClaw manages context compaction (summarization)                      |
| **Metadata**    | Thread-level metadata JSONB                                                                                           | Per-session: model overrides, token counts, delivery routing, 50+ fields |

### 2. ai_threads IS Under-Scoped (for Sandbox Executors)

This is the critical finding. The "duplication" question was the wrong frame — the real problem is **data loss**.

#### What each executor path captures

**In-proc LangGraph** (e.g., chat graph with tool use):

AiEvents emitted per tool-use turn: `text_delta` → `tool_call_start` → `tool_call_result` → `text_delta` → `assistant_final` → `done`

The route handler sees EVERY intermediate tool call as a live AiEvent. The UIMessage accumulator captures all of this in one assistant UIMessage with typed parts: `[text, tool-call, tool-result, text]`. **Full fidelity.**

**OpenClaw Ephemeral/Gateway** (agent does 8 tool-use turns internally):

AiEvents emitted: `text_delta` (final response text only) → `usage_report` ×8 → `assistant_final` → `done`

`SandboxGraphProvider` collapses the entire multi-turn tool-use loop into a single `text_delta` of the final response (`sandbox-graph.provider.ts:304-308` for ephemeral, `:502-503` for gateway). **All intermediate tool calls, results, and reasoning are invisible to the host.** The UIMessage accumulator captures: `[text: "final response"]`. No tool-call parts. No reasoning trace.

#### What gets lost

| Detail                  | In-proc LangGraph           | OpenClaw Sandbox           |
| ----------------------- | --------------------------- | -------------------------- |
| Final response text     | Captured                    | Captured                   |
| Tool calls (name, args) | Captured as UIMessage parts | **Lost**                   |
| Tool results            | Captured as UIMessage parts | **Lost**                   |
| Intermediate reasoning  | Captured as text deltas     | **Lost**                   |
| Number of LLM calls     | Known from AiEvents         | Known from billing only    |
| Per-call billing        | Captured (`usage_report`)   | Captured (proxy audit log) |

For an OpenClaw run that reads 5 files, runs 3 bash commands, and edits 2 files — the user sees: _"I fixed the bug in auth.ts."_ No trace of how.

This is not a persistence architecture problem — it's a **sandbox observability** problem. Even with perfect persistence, we can't store what we can't see.

### 3. The Gateway Session Key: Real Limitation, Masked Today

Current gateway session key construction (`sandbox-graph.provider.ts:459`):

```typescript
const sessionKey = `agent:main:${caller.billingAccountId}:${runId}`;
```

Since `runId` is unique per HTTP request (generated from `ctx.reqId` in `run-id-factory.ts`), every gateway call creates a **fresh** OpenClaw session. Multi-turn context does NOT carry across Cogni requests via the gateway session.

**Why multi-turn appears to work today**: The client sends full `messages[]` history every request. For **ephemeral** mode, `SandboxGraphProvider` writes ALL messages to `/workspace/.cogni/messages.json` (`sandbox-graph.provider.ts:234`) — the agent reads full history from the workspace file. Multi-turn works because history is injected via filesystem, not via OpenClaw session state.

For **gateway** mode, the provider only sends the last user message text (`sandbox-graph.provider.ts:473-475`). If the client stops sending full history (which is exactly what thread-persistence does — server loads from DB instead), gateway multi-turn breaks because:

1. Server loads history from `ai_threads`
2. Converts to `Message[]` and passes to `runGraph()`
3. `SandboxGraphProvider` extracts only last user message, sends to gateway
4. Gateway has a fresh session (runId-based key) — no prior context

**stateKey does NOT change per message.** It's the conversation/thread identifier:

- First request: no stateKey → server generates UUID (`route.ts:366`) → returns via `X-State-Key` header
- Subsequent requests: client echoes same stateKey → server reuses it
- Equivalent to OpenAI's `conversation_id` or AI SDK's chat `id`

**Fixed**: Gateway now uses `stateKey` exclusively for session key construction (`sandbox-graph.provider.ts:470`):

```typescript
const sessionKey = `agent:main:${caller.billingAccountId}:${stateKey}`;
```

`stateKey` is required — the route always generates one (`route.ts:366`), and the gateway path throws if it's missing. The `billingAccountId` prefix is still needed because stateKey is only unique per-tenant in `ai_threads` (scoped by `owner_user_id`), while OpenClaw's session store is a single flat namespace.

With this, the same OpenClaw gateway session persists across Cogni requests. OpenClaw's `loadSessionEntry()` (`openclaw/src/gateway/server-methods/agent.ts:227-310`) already supports session resume — if the sessionKey exists, it loads the existing `SessionEntry` and its conversation history.

### 4. How Top AI Teams Do Persistence

The industry has converged on a single-store, full-fidelity pattern.

#### OpenAI: Conversations API + Responses API

Source: [OpenAI Conversations API](https://platform.openai.com/docs/api-reference/conversations/object), [Conversation State Guide](https://platform.openai.com/docs/guides/conversation-state)

- A **Conversation** is a durable object storing typed **items**: messages, tool calls, tool outputs, reasoning, computer calls
- `store: true` persists EVERYTHING — every intermediate step, every tool call, every tool result
- Items are typed: `message`, `function_call`, `function_call_output`, `reasoning`, `computer_call`, etc.
- The Conversation IS both the UI view AND the execution state — **single store**
- `previous_response_id` chains responses for automatic context reconstruction
- Conversations have no 30-day TTL (responses alone do)

**Key pattern**: No separate "UI projection." What the LLM sees IS what gets stored IS what the user can view.

#### AI SDK 5+: UIMessage[] with Parts

Source: [AI SDK Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)

- `UIMessage.parts[]` stores everything: text, tool-call (with lifecycle state), tool-result, reasoning, sources
- `saveChat()` persists the complete `UIMessage[]` array after each exchange
- `convertToModelMessages()` reconstructs LLM-ready format from the same UIMessage[] — **single source of truth**
- Tool calls and results live INSIDE the assistant message as typed parts — not separate message rows
- `validateUIMessages()` ensures round-trip fidelity before sending to model

**Key pattern**: Same store serves UI rendering AND prompt reconstruction. No lossy projection.

#### OpenClaw/Pi SDK: JSONL Transcripts

- JSONL per session (one JSON object per line)
- First line: session header with metadata (version, id, timestamp, cwd)
- Subsequent lines: every message including intermediate tool-use turns
- Assistant messages include: `stopReason`, `api`, `provider`, `model`, `usage` (per-turn tokens), `timestamp`
- Session metadata in `sessions.json`: 50+ fields (model overrides, token counts, compaction tracking, delivery routing)
- Built-in context compaction when history exceeds context window

**Key pattern**: Full execution trace. Every intermediate turn stored. Rich per-message metadata.

#### The Industry Pattern

```
What the user sees  ═══  What gets stored  ═══  What the LLM sees next turn
        │                       │                         │
        └───────── ALL THE SAME THING ────────────────────┘
```

Top teams do NOT maintain a separate "UI projection" store. They store everything at full fidelity in one place — including intermediate tool calls, reasoning traces, and per-turn metadata — and reconstruct the LLM prompt from that same store.

### 5. Options Analysis

#### Option A: Accept Dual Storage as "UI Projection" (Current Spec)

`ai_threads` is the user-facing thread view. Executor-internal state is the execution-fidelity store. No sync between them.

**Pros**: Simplest. No format converters. Route always writes forward.
**Cons**: ai_threads is lossy for sandbox executors (no tool-call parts). Two stores for external executors. Diverges from industry single-store pattern.

**Verdict**: Acceptable for P0, but leaves the sandbox observability gap unfixed.

#### Option B: Enrich AiEvents from Sandbox (Recommended Path)

Make the sandbox emit structured intermediate events — tool calls, results, reasoning — so the host UIMessage accumulator captures them the same way it does for in-proc graphs.

**How it works**:

- **Gateway**: OpenClaw's WS protocol streams chat events including tool-use frames. The gateway client (`openclaw-gateway-client.ts`) currently captures `text_delta` and `chat_final` — extend it to also capture `tool_call_start`/`tool_call_result` equivalents and emit them as AiEvents.
- **Ephemeral**: OpenClaw `--json` output currently returns only `payloads[0].text`. Extend parsing to include tool-use metadata from `meta.agentMeta` or request richer output format.

**Pros**: Single-store pattern. `ai_threads` has full fidelity for all executors. UIMessage parts include tool calls from sandbox runs. Matches industry patterns.
**Cons**: Requires understanding OpenClaw's WS event structure. Ephemeral may need OpenClaw-side changes for richer `--json` output.

**Verdict**: The right long-term path. Addresses the real problem (observability gap) rather than the symptom (duplication).

#### Option C: Post-hoc Transcript Extraction

After each sandbox run, read OpenClaw's JSONL transcript and convert to UIMessage parts before persisting.

**Pros**: Gets full fidelity into ai_threads without protocol changes.
**Cons**: Fragile coupling to OpenClaw's internal JSONL format. Requires Docker volume reads for ephemeral (container destroyed). Complex: OpenClaw has 18 entries for what maps to ~4 UIMessage parts.

**Verdict**: Backup if Option B is too complex. Works for gateway (JSONL is accessible). Doesn't work for ephemeral (container destroyed before read).

#### Option D: External Executors Don't Use ai_threads

Only in-proc graphs persist to `ai_threads`. External executors own their own persistence. UI queries different stores.

**Verdict**: Unacceptable. Breaks uniform thread view — the whole point of `ai_threads`.

## Recommendation

### P0: Accept the Dual-Store Gap (Option A)

The current thread-persistence spec is correct for in-proc graphs. For sandbox graphs, `ai_threads` stores the user message + final response text — lossy but functional. This is acceptable for P0 because:

1. In-proc is the primary execution path today
2. Sandbox observability enrichment is a separable concern
3. The persistence architecture (UIMessage[] with parts) is already designed to hold tool-call parts — it's the sandbox provider that doesn't emit them, not a persistence limitation

### P1: Gateway Streaming Enrichment (Option B)

Modify `OpenClawGatewayClient` to capture structured tool-use events from the WS stream and emit them as `tool_call_start`/`tool_call_result` AiEvents. The UIMessage accumulator then captures them automatically. This closes the observability gap and achieves the single-store pattern for gateway mode.

### Done: Stable Gateway Session Key

Fixed in this research pass. Gateway now uses `stateKey` exclusively for session key construction — no `runId` fallback. OpenClaw's built-in session continuity now works for multi-turn gateway conversations. `ai_threads` stores the user-visible thread; OpenClaw's session stores the execution-fidelity trace. Both persist, no sync needed.

### No Changes Needed for Ephemeral Multi-Turn

Ephemeral mode already receives full history via `messages.json` workspace file. With thread persistence, the route loads from `ai_threads` → passes to `runGraph()` → `SandboxGraphProvider.setupWorkspace()` writes to workspace → agent reads history. The path is: DB → UIMessage[] → MessageDto[] → Message[] → messages.json. Fidelity is limited to what `ai_threads` stores (no tool-call parts from prior sandbox runs), but the conversation text carries through correctly.

## Open Questions

- **Gateway WS tool events**: Does the OpenClaw gateway WS protocol expose structured tool-use events (tool name, args, result) in the chat stream? Or only text deltas? Need to inspect the WS frame types in `openclaw/src/gateway/server-methods/agent.ts`.

- **Ephemeral enrichment**: Can OpenClaw's `--json` output include intermediate tool-use details? The current `SandboxProgramContract` envelope only has `payloads[0].text` + `meta`. Richer output would require an OpenClaw-side change.

- ~~**Gateway session key scoping**~~: Resolved. Using `billingAccountId` because stateKey is only per-tenant unique in `ai_threads`, and OpenClaw's session store is a single flat namespace. `billingAccountId` scopes more tightly than `ownerUserId` (one user could have multiple billing accounts).

- **History round-trip fidelity**: When `ai_threads` stores a prior sandbox response as `[text: "I fixed the bug"]` (no tool parts), and this gets loaded → converted → sent to the agent on the next turn, the agent loses tool-use context from prior turns. Is this acceptable? For in-proc graphs (which store tool parts), the round-trip is full-fidelity.

## Proposed Layout

### Spec Updates

**thread-persistence.md** — add "Executor State Duality" section:

- Document that `ai_threads` is a UI projection for external executors, single source for in-proc
- Note the sandbox observability gap (AiEvents don't carry intermediate tool-use from black-box executors)
- Clarify that the UIMessage parts schema already supports tool-call parts — the gap is in event emission, not persistence

**openclaw-sandbox-spec.md** — add "Conversation Continuity" subsection under Gateway Mode:

- Document the session key lifecycle (`runId` vs `stateKey`)
- Document the interaction with thread persistence

### Future Tasks (not P0)

1. **Gateway streaming enrichment** — Capture tool-use events from OpenClaw WS stream, emit as AiEvents. Closes the sandbox observability gap for gateway mode.
2. ~~**Stable gateway session key**~~ — Done. Gateway now uses `stateKey` exclusively.
3. **Ephemeral output enrichment** — Investigate richer `--json` output from OpenClaw to capture tool-use metadata in ephemeral mode.

## References

- [AI SDK Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) — Canonical UIMessage[] persistence pattern
- [OpenAI Conversations API](https://platform.openai.com/docs/api-reference/conversations/object) — Durable conversation objects with typed items
- [OpenAI Conversation State Guide](https://platform.openai.com/docs/guides/conversation-state) — `store: true`, `previous_response_id`, Conversations API
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) — Response chaining and storage
- [Thread Persistence Spec](../spec/thread-persistence.md) — ai_threads design, UIMessage accumulator, persistence invariants
- [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — Sandbox execution modes, gateway protocol, billing
- [Graph Execution Spec](../spec/graph-execution.md) — AiEvent types, GraphExecutorPort, billing invariants
- [AI SDK Transcript Authority Research](./ai-sdk-transcript-authority-analysis.md) — Design rationale for UIMessage adoption
