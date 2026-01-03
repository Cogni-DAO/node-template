# Tool Use Specification

> [!CRITICAL]
> Tools execute via `toolRunner.exec()` only. Route maps AiEvents to `assistant-stream` format via `controller.addToolCallPart()`.

## Core Invariants

1. **TOOLS_VIA_TOOLRUNNER**: All tool execution flows through `toolRunner.exec()` for InProc execution. LangChain tool wrappers (`@cogni/langgraph-graphs`) must delegate to `toolRunner.exec()` to preserve validation/redaction pipeline. No direct tool implementation calls.

2. **TOOLS_IN_PACKAGES**: Tool contracts + implementations in `@cogni/ai-tools`. Wire DTOs (OpenAI-shaped) in `@cogni/ai-core`. LangChain wrappers in `@cogni/langgraph-graphs/runtime`. Binding in composition roots only. No tool definitions in `src/**`.

3. **TOOLS_IO_VIA_CAPABILITIES**: Tools receive IO capabilities as injected interfaces (defined in packages). No direct adapter/env imports in tool code. Capabilities are bound to adapters in composition roots.

4. **REDACTION_REQUIRED**: Every tool must define deterministic redaction for UI/telemetry outputs. Allowlist is the required mechanism—output fields not in allowlist are stripped. Missing redaction config = error event, not silent pass-through.

5. **TOOLCALLID_STABLE**: Same ID across start→result. Model-provided or UUID at boundary.

6. **LANGGRAPH_OWNS_GRAPHS**: Agentic loops via `@cogni/langgraph-graphs`. No `@langchain/*` imports in `src/**`. See [LANGGRAPH_AI.md](LANGGRAPH_AI.md).

7. **STREAM_VIA_ASSISTANT_STREAM**: Use `assistant-stream` package only. No custom SSE.

8. **ADAPTER_ASSEMBLES_TOOLCALLS**: `litellm.adapter.ts` is the single assembler of streamed `tool_call` deltas into `final.toolCalls`. Assembly state is scoped to a single `completionStream()` call and reset between calls. Graph executes tools only from `final.toolCalls`, never from raw deltas.

9. **BINDING_IN_COMPOSITION_ROOT**: Tool binding (connecting contracts to ports/deps) occurs only in composition roots: `src/bootstrap/**` (Next.js) or `packages/langgraph-server/**` (LangGraph Server). Features and packages never instantiate bound tools.

10. **OPENAI_WIRE_DTOS_CANONICAL**: All tool wire DTOs (tool definitions, tool calls, deltas, tool result messages) use canonical OpenAI-shaped types defined in `@cogni/ai-core/tooling/openai-wire-dtos.ts`. Adapters may map provider formats (e.g., Anthropic `tool_use`/`tool_result`) to/from these DTOs at boundaries; no other module defines wire tool shapes.

11. **JSON_SCHEMA7_PARAMETERS**: Tool definition `parameters` field uses full JSONSchema7 (not a simplified subset). Tool input schemas must compile deterministically from Zod → JSON Schema for wire emission. Use `zod-to-json-schema` or equivalent.

12. **NO_MANUAL_SCHEMA_DUPLICATION**: No hand-written JSON Schema objects alongside Zod schemas. The `parameters` field in wire DTOs must be derived from the contract's Zod schema via `getToolJsonSchema(contract)`. Manual duplication causes drift.

13. **GOLDEN_FIXTURES_ENFORCE_WIRE_FORMAT**: Golden fixture tests enforce OpenAI wire conformance: exact key sets (no extra keys), required fields for tool definitions, correct `tool_calls` delta assembly, and correct tool result message formation. Tests assert structure, not JSON key ordering.

---

## Implementation Checklist

### P0: OpenAI Wire Format Alignment

Per invariants **OPENAI_WIRE_DTOS_CANONICAL**, **JSON_SCHEMA7_PARAMETERS**, **NO_MANUAL_SCHEMA_DUPLICATION**, **GOLDEN_FIXTURES_ENFORCE_WIRE_FORMAT**:

**Wire DTO layer (`@cogni/ai-core`):**

- [ ] Create `@cogni/ai-core/tooling/openai-wire-dtos.ts` with canonical OpenAI types
- [ ] Replace simplified `JsonSchemaObject` with proper `JSONSchema7` import
- [ ] Migrate `LlmToolDefinition`, `LlmToolCall`, `LlmToolCallDelta`, `LlmToolChoice` from `llm.port.ts`

**Schema compilation (`@cogni/ai-tools`):**

- [ ] Add `zod-to-json-schema` dependency
- [ ] Create `getToolJsonSchema(contract)` in `@cogni/ai-tools/schema.ts`
- [ ] Remove manual JSON Schema in `chat.runner.ts` — derive from contract

**Golden fixtures (`tests/contracts/`):**

- [ ] `openai-tool-wire-format.test.ts` — tool definition serialization (exact keys, no extras)
- [ ] `tool-call-delta-assembly.test.ts` — stream delta accumulation matches OpenAI SSE format
- [ ] `tool-result-message.test.ts` — `{ role: "tool", content: string, tool_call_id }` format

### P0: First Tool End-to-End

**Port layer:**

- [x] Add tool types to `llm.port.ts`: `LlmToolDefinition`, `LlmToolCall`, `LlmToolCallDelta`, `LlmToolChoice` (migrate to ai-core)
- [ ] Extend `CompletionStreamParams` with `tools?: LlmToolDefinition[]` and `toolChoice?: LlmToolChoice`
- [ ] Add `tool_call_delta` event to `ChatDeltaEvent` union
- [ ] Add `toolCalls?: LlmToolCall[]` to `LlmCompletionResult`

**Adapter layer:**

- [ ] Update `litellm.adapter.ts` to pass tools/toolChoice to LiteLLM API
- [ ] Parse SSE `delta.tool_calls` and emit `tool_call_delta` events
- [ ] Accumulate tool calls and include in final result

**Package layer:**

- [x] Create `get_current_time` tool in `@cogni/ai-tools/tools/get-current-time.ts`
- [x] Create `@cogni/ai-tools` package with ToolContract, BoundTool types
- [ ] Create `toLangChainTool()` converter in `@cogni/langgraph-graphs/runtime/`
- [ ] Implement agentic loop in `@cogni/langgraph-graphs/inproc/` (LLM→tool→LLM cycle)

**Bootstrap layer:**

- [ ] Create `src/bootstrap/ai/tools.bindings.ts` for tool binding with ports

**Route layer:**

- [x] Route tool handling using `controller.addToolCallPart()` (lines 274-294)

**UI layer (optional for MVP):**

- [ ] Create `ToolFallback.tsx` for generic tool display

#### Chores

- [ ] Observability [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation [document.md](../.agent/workflows/document.md)

### P1: Tool Ecosystem

- [ ] `GraphLlmCaller` type enforcement (graphRunId requires graph_name + graph_version)
- [ ] Include tools in `promptHash` computation (canonical tool schema)
- [ ] `ToolFallback.tsx` for unregistered tool names
- [ ] Tool telemetry in `ai_invocation_summaries` (tool_calls count, latency)

### P2: Advanced (Do NOT Build Yet)

- [ ] Multi-tool parallel execution
- [ ] Tool result streaming (partial results)

---

## File Pointers (P0)

| File                                                 | Change                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `@cogni/ai-core/tooling/openai-wire-dtos.ts`         | New: canonical OpenAI-shaped tool types (definitions, calls, etc.) |
| `@cogni/ai-tools/schema.ts`                          | New: `getToolJsonSchema(contract)` — Zod → JSONSchema7 compiler    |
| `src/ports/llm.port.ts`                              | Migrate tool types to `@cogni/ai-core`, re-export for compat       |
| `src/adapters/server/ai/litellm.adapter.ts`          | Parse `delta.tool_calls` in SSE stream, emit `tool_call_delta`     |
| `src/features/ai/runners/chat.runner.ts`             | Remove manual JSON Schema, use `getToolJsonSchema()`               |
| `@cogni/ai-tools/tools/get-current-time.ts`          | Contract + implementation with capability injection                |
| `@cogni/ai-tools/capabilities/*.ts`                  | Capability interfaces (e.g., Clock) for tool IO                    |
| `@cogni/langgraph-graphs/runtime/langchain-tools.ts` | `toLangChainTool()` wrapper for LangGraph execution                |
| `src/bootstrap/ai/tools.bindings.ts`                 | Bind capabilities → adapters for Next.js runtime                   |
| `src/app/api/v1/ai/chat/route.ts`                    | Uncomment `addToolCallPart()` handling (lines 275-285)             |
| `src/features/ai/components/tools/ToolFallback.tsx`  | New: generic tool result UI component (optional for MVP)           |
| `tests/contracts/openai-tool-wire-format.test.ts`    | New: golden fixture tests for wire format conformance              |

---

## Design Decisions

### 1. Tool Architecture

| Layer            | Location                                     | Owns                                                                  |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Wire DTOs        | `@cogni/ai-core/tooling/openai-wire-dtos.ts` | OpenAI-shaped types: tool definitions, calls, deltas, result messages |
| Contract         | `@cogni/ai-tools/tools/*.ts`                 | Zod schema, allowlist, name, description, redaction                   |
| Implementation   | `@cogni/ai-tools/tools/*.ts`                 | `execute(ctx, args)` — IO via injected capabilities                   |
| Schema compiler  | `@cogni/ai-tools/schema.ts`                  | `getToolJsonSchema(contract)` — Zod → JSONSchema7                     |
| Capability iface | `@cogni/ai-tools/capabilities/*.ts`          | Minimal interfaces tools depend on (e.g., Clock)                      |
| LangChain wrap   | `@cogni/langgraph-graphs/runtime/`           | `toLangChainTool()` converter (delegates to toolRunner)               |
| Binding (Next)   | `src/bootstrap/**`                           | Wire capabilities → adapters for Next.js runtime                      |
| Binding (Server) | `packages/langgraph-server/bootstrap/`       | Wire capabilities → adapters for LangGraph Server                     |
| IO Adapter       | `src/adapters/server/**`                     | Capability implementation                                             |

**Rules:**

- Tool contracts in `@cogni/ai-tools`. Wire DTOs in `@cogni/ai-core`. No tool definitions in `src/**`.
- IO allowed only via injected capabilities — no adapter/env imports in tools.
- Binding in composition roots only.
- Wire DTO layer is OpenAI-shaped; adapters map provider-specific formats (Anthropic, etc.) at boundaries.

**Note:** Per **OPENAI_WIRE_DTOS_CANONICAL**, `@cogni/ai-core` owns the canonical OpenAI wire format. The current `LlmToolDefinition`, `LlmToolCall`, etc. in `llm.port.ts` will migrate to this location. Future Anthropic direct adapter would map `tools[].input_schema` and `tool_use`/`tool_result` content blocks into these canonical DTOs.

### 2. assistant-stream Tool API

Route uses `assistant-stream` controller API:

```typescript
// Tool start
const toolCtrl = controller.addToolCallPart({
  toolCallId: event.toolCallId,
  toolName: event.toolName,
  args: event.args,
});

// Tool result
toolCtrl.setResponse(event.result);
```

**Never** invent custom SSE events. Use official helper only.

### 3. Agentic Loop (chat.graph.ts)

**Critical:** Graph calls `completion.executeStream()`, never `llmService` directly. This keeps billing/telemetry/promptHash centralized.

**Critical:** Graph reads tool calls from `final.toolCalls` only—never from raw `tool_call_delta` events. The adapter assembles deltas; graph consumes assembled results.

```
┌─────────────────────────────────────────────────────────────────────┐
│ LLM Call via completion.executeStream()                              │
│ - Yield text_delta events for content                                │
│ - Adapter accumulates delta.tool_calls internally                    │
│ - Await final: { toolCalls, finishReason, ... }                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (if final.finishReason == "tool_calls")
┌─────────────────────────────────────────────────────────────────────┐
│ Tool Execution via toolRunner.exec() for each final.toolCalls[]      │
│ - Yield tool_call_start event (same toolCallId)                      │
│ - Parse args JSON, execute tool (or emit error if invalid)           │
│ - Yield tool_call_result event (same toolCallId)                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (feed results back)
┌─────────────────────────────────────────────────────────────────────┐
│ Next LLM Call with tool results in messages                          │
│ - Include assistant message with tool_calls                          │
│ - Include tool messages with results                                 │
│ - Repeat until final.finishReason != "tool_calls"                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Finalization:** Emit exactly one `done` event and resolve `final` exactly once—regardless of how many tool loops occurred. No side effects attached to stream iteration.

### 4. OpenAI Tool Call SSE Format

LiteLLM streams tool calls as incremental deltas:

```json
// First chunk: ID + name
{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"generate_title","arguments":""},"type":"function"}]}}]}

// Subsequent chunks: argument fragments
{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"mes"}}]}}]}
{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"sage\":\"hi\"}"}}]}}]}
```

Accumulate by `index`, parse complete JSON when done.

### 5. Tool UI Location

Tool components in `features/ai/components/tools/`. Kit cannot import features.

Register via `makeAssistantToolUI` keyed by tool name:

```typescript
export const GenerateTitleToolUI = makeAssistantToolUI({
  toolName: "generate_title",
  render: ({ args, result, status }) => { ... }
});
```

### 6. Completion Contract for Tool Calls

The `LlmCompletionResult` contract for tool calls:

- `toolCalls` is present iff `finishReason === "tool_calls"`
- Each `LlmToolCall.function.arguments` is a fully assembled JSON string (not fragments)
- Graph must NOT attempt to parse or execute tools until `final` resolves
- Adapter resets assembly state between `completionStream()` calls (per **ADAPTER_ASSEMBLES_TOOLCALLS**)

### 7. Tool Argument Parse Errors

When `toolCall.function.arguments` is invalid JSON:

1. Graph emits `tool_call_start` with the malformed toolCallId (per **TOOLCALLID_STABLE**)
2. Graph emits `tool_call_result` with error payload:
   ```typescript
   {
     ok: false,
     errorCode: "invalid_json",
     message: "Invalid tool arguments JSON"  // Safe message, no raw args leaked
   }
   ```
3. Graph continues: feed error result back to LLM as tool message for self-correction (do NOT halt)
4. LLM may retry with corrected arguments or respond with explanation

---

## Existing Infrastructure (✓ Built)

| Component                | Location                             | Status                                         |
| ------------------------ | ------------------------------------ | ---------------------------------------------- |
| AiEvent types            | `@cogni/ai-core`                     | ✓ Complete                                     |
| ToolContract, BoundTool  | `@cogni/ai-tools`                    | ✓ Complete                                     |
| get_current_time tool    | `@cogni/ai-tools/tools/`             | ✓ Complete                                     |
| tool-runner.ts           | `features/ai/tool-runner.ts`         | ✓ Complete pipeline                            |
| Route tool handling      | `app/api/v1/ai/chat/route.ts`        | ✓ Active (lines 274-294)                       |
| ai_runtime.ts            | `features/ai/services/ai_runtime.ts` | ✓ Uses GraphExecutorPort (no tool routing yet) |
| LlmCaller/GraphLlmCaller | `ports/llm.port.ts`                  | ✓ Types defined                                |

---

## Related Documents

- [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md) — Correlation IDs, telemetry invariants
- [LANGGRAPH_AI.md](LANGGRAPH_AI.md) — Architecture, anti-patterns
- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — GraphExecutorPort, billing, pump+fanout

---

**Last Updated**: 2026-01-03
**Status**: Draft (aligned with LANGGRAPH_AI.md)
