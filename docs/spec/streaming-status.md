---
id: streaming-status
type: spec
title: Streaming Status Events
status: draft
spec_state: draft
trust: draft
summary: Adds a StatusEvent to the AiEvent stream so clients can show agent activity phases (thinking, tool use, compaction) instead of silence. Leverages existing OpenClaw agent events and LangGraph update events with zero upstream changes.
read_when: Working on chat streaming, agent status indicators, OpenClaw gateway integration, or LangGraph stream translation
owner: cogni-dev
created: 2026-02-16
verified: 2026-02-16
tags: [ai-graphs, streaming, openclaw, ux]
---

# Streaming Status Events

> Surface agent activity phases (thinking, tool use, compaction) through the AiEvent stream so clients see status instead of silence during long-running agent execution.

### Key References

|              |                                                                              |                                     |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------- |
| **Spec**     | [Graph Execution](./graph-execution.md)                                      | AiEvent stream, billing, pump       |
| **Spec**     | [Thread Persistence](./thread-persistence.md)                                | AiEvent → wire mapping, UIMessage   |
| **Spec**     | [OpenClaw Sandbox](./openclaw-sandbox-spec.md)                               | Gateway protocol, session isolation |
| **Research** | [Gateway Header Injection](../research/openclaw-gateway-header-injection.md) | Session config, thinking field      |

## Design

### Event Flow

```
OpenClaw Gateway                           Cogni
─────────────────                          ──────────────────────────────────

emitAgentEvent({                    ┌──  WS frame: { type: "event",
  stream: "lifecycle",              │      event: "agent",
  data: { phase: "start" }         │      payload: { stream, data, sessionKey }
})                                  │    }
                                    │
emitAgentEvent({                    │    openclaw-gateway-client.ts
  stream: "tool",                   ├──▶   filter by sessionKey
  data: {                           │      map to StatusEvent
    phase: "start",                 │
    name: "exec",                   │    SandboxGraphProvider
    toolCallId: "tc1"               │      yield { type: "status", ... }
  }                                 │
})                                  │    Chat route
                                    │      writer.write(annotation)
emitAgentEvent({                    │
  stream: "assistant",              │    Client
  data: { text: "..." }            │      status indicator UI
})                                  └──
```

### OpenClaw Agent Events (Already Emitted)

OpenClaw broadcasts `"agent"` events alongside `"chat"` events. Cogni currently drops them (`openclaw-gateway-client.ts:354`). These events carry:

| `stream`       | `data.phase` | `data` fields                | Maps to                                |
| -------------- | ------------ | ---------------------------- | -------------------------------------- |
| `"lifecycle"`  | `"start"`    | `startedAt`                  | `status:thinking`                      |
| `"lifecycle"`  | `"end"`      | `endedAt`                    | _(no emit — stream ends naturally)_    |
| `"lifecycle"`  | `"error"`    | `error`                      | _(handled by existing ErrorEvent)_     |
| `"tool"`       | `"start"`    | `toolCallId`, `name`, `args` | `status:tool_use`                      |
| `"tool"`       | `"end"`      | `toolCallId`, `result`       | `status:thinking` (back to thinking)   |
| `"compaction"` | `"start"`    | —                            | `status:compacting`                    |
| `"compaction"` | `"end"`      | `willRetry`                  | `status:thinking` (back to thinking)   |
| `"assistant"`  | —            | `text`                       | _(redundant with chat delta — ignore)_ |

Agent events include `sessionKey` in the payload (enriched by `server-chat.ts:327`), so the existing WS_EVENT_CAUSALITY filter applies.

### OpenClaw Verbose Level

Tool event emission is gated by a per-session `verboseLevel` setting:

- `"off"` — tool events suppressed (current default)
- `"names"` — tool name + args emitted, result stripped
- `"full"` — everything including results

Set via `agents.defaults.verboseDefault` in gateway config. For this feature, set to `"names"` — we need tool names for status display but not results.

### LangGraph Alignment

LangGraph's stream translator (`stream-translator.ts`) currently handles `chunk.event === "messages"` only. Two paths for status events:

1. **Existing tool events**: `tool_call_start` and `tool_call_result` AiEvents already exist. The route can derive `status:tool_use` from these without changes to the translator.
2. **Future node events**: Adding `streamMode: ["messages-tuple", "updates"]` would provide node-level transitions. Not required for MVP.

### New AiEvent Type

```typescript
// packages/ai-core/src/events/ai-events.ts

export interface StatusEvent {
  readonly type: "status";
  /** Current agent phase. */
  readonly phase: "thinking" | "tool_use" | "compacting";
  /** Optional label for display (e.g., tool name). Obfuscated in v0. */
  readonly label?: string;
}

export type AiEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | UsageReportEvent
  | AssistantFinalEvent
  | StatusEvent // new
  | DoneEvent
  | ErrorEvent;
```

### Wire Mapping (AiEvent → AI SDK Data Stream)

StatusEvent is mapped to an AI SDK **stream annotation**, not a message part. Annotations are metadata sent alongside the stream but not persisted in UIMessage:

```typescript
// In chat route, within createUIMessageStream execute callback:
if (event.type === "status") {
  writer.write({
    type: "annotation",
    value: { status: event.phase, label: event.label },
  } as UIMessageChunk);
}
```

**Rationale**: Status events are ephemeral — they represent the current agent phase during streaming, not persisted conversation content. Annotations are the AI SDK mechanism for exactly this: metadata alongside the stream that the client can consume but that doesn't become part of the message.

### Client Consumption

```typescript
// Client reads annotations from the stream
// assistant-ui runtime exposes annotations via message metadata
// v0: simple text indicator — "Thinking...", "Using tool: exec", "Compacting..."
```

### Session Activity (Problem 2)

For v0, session activity visibility is derived from the StatusEvent stream itself — no new infrastructure needed:

1. **During streaming**: The client already knows the agent is active because it's receiving SSE events. StatusEvents just add specificity (thinking vs tool_use).
2. **Cross-session visibility**: Deferred. Requires either a polling endpoint or a presence system. Not in this spec.

The gateway client already tracks `accepted` → `done` lifecycle. If the client receives `accepted` but no `done` within a timeout, it can show "agent is working" generically.

## Goal

Enable clients to show meaningful status indicators during agent execution instead of silence. Zero OpenClaw code changes. Consistent across OpenClaw and LangGraph providers.

## Non-Goals

- Exposing internal agent reasoning or tool results (obfuscated in v0)
- Cross-session activity dashboard ("who else is active?")
- Persisting status events in UIMessage or ai_threads
- Extended thinking block streaming (model-level thinking content)
- Real-time presence system or heartbeat infrastructure

## Invariants

| Rule                       | Constraint                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STATUS_IS_EPHEMERAL        | StatusEvent is never persisted in `ai_threads.messages`. It maps to a stream annotation, not a UIMessage part. The UIMessage accumulator ignores it.                           |
| STATUS_BEST_EFFORT         | StatusEvent emission is best-effort. Missing status events must not break streaming, persistence, or billing. Client must handle streams with zero StatusEvents gracefully.    |
| STATUS_SESSIONKEY_FILTERED | OpenClaw agent events are filtered by `sessionKey` using the same WS_EVENT_CAUSALITY invariant as chat events. Agent events with mismatched or missing sessionKey are dropped. |
| STATUS_NEVER_LEAKS_CONTENT | StatusEvent `label` field contains at most a tool name (e.g., `"exec"`, `"memory_search"`). Never tool arguments, results, or reasoning content.                               |
| AIEVENT_NEVER_VERBATIM     | Unchanged — StatusEvent is an AiEvent mapped to wire format by the route, never sent verbatim.                                                                                 |
| VERBOSE_NAMES_DEFAULT      | OpenClaw gateway config sets `agents.defaults.verboseDefault: "names"` to enable tool name emission without result content.                                                    |

### File Pointers

| File                                                        | Purpose                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `packages/ai-core/src/events/ai-events.ts`                  | Add `StatusEvent` to AiEvent union                       |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts`    | Consume `"agent"` events (currently dropped at line 354) |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`     | Map gateway agent events → StatusEvent                   |
| `src/app/api/v1/ai/chat/route.ts`                           | Map StatusEvent → annotation in createUIMessageStream    |
| `services/sandbox-openclaw/openclaw-gateway.json`           | Set `verboseDefault: "names"`                            |
| `src/adapters/server/ai/langgraph/dev/stream-translator.ts` | Future: derive StatusEvent from LangGraph update events  |

## Acceptance Checks

1. **StatusEvent in AiEvent union**
   - `pnpm check` passes with StatusEvent added to ai-events.ts
   - TypeScript enforces exhaustive handling in switch statements on AiEvent.type

2. **OpenClaw agent events consumed**
   - Gateway client yields StatusEvent when receiving `stream: "tool"` agent events
   - SessionKey filter applies to agent events (mismatched keys dropped)
   - `stream: "assistant"` agent events are ignored (redundant with chat delta)

3. **Wire annotation emitted**
   - Chat route writes `{ type: "annotation", value: { status, label } }` for StatusEvent
   - UIMessage accumulator does NOT include StatusEvent content

4. **Status not persisted**
   - After a streaming chat turn, `ai_threads.messages` contains no status/annotation data
   - Only text parts and tool-call parts are persisted (existing behavior unchanged)

5. **Graceful degradation**
   - If OpenClaw `verboseDefault` is `"off"`, no StatusEvents are emitted and streaming works unchanged
   - If gateway drops agent events, chat delta/final events still produce correct output

6. **No content leakage**
   - StatusEvent `label` contains only tool name string, never args or results
   - Stack test: assert StatusEvent payloads contain no content beyond phase + label

## Open Questions

- [ ] Should LangGraph InProc provider emit `status:thinking` on first `text_delta`? (Would require synthetic StatusEvent before first content — adds complexity for marginal UX gain with InProc graphs)
- [ ] Should the client derive `status:thinking` implicitly from `accepted` + no content yet, or should the provider emit it explicitly? (Explicit is cleaner but requires lifecycle.start to arrive before first delta)
- [ ] AI SDK annotation type — is `UIMessageChunk` the right cast, or does assistant-ui expose a typed annotation writer? (Needs verification against @assistant-ui/react-ai-sdk 0.12.x API)

## Related

- [Graph Execution](./graph-execution.md) — AiEvent stream, billing decorator, pump mechanics
- [Thread Persistence](./thread-persistence.md) — AiEvent → wire mapping, UIMessage accumulator
- [OpenClaw Sandbox](./openclaw-sandbox-spec.md) — Gateway protocol, WS_EVENT_CAUSALITY invariant
- [OpenClaw Sandbox Controls](./openclaw-sandbox-controls.md) — Session configuration, model override
