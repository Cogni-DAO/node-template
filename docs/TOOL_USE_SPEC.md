# Tool Use Specification

> [!CRITICAL]
> Tools execute via `toolRunner.exec()` only. Route maps AiEvents to assistant-stream format.

## Core Invariants

1. **TOOLS_VIA_TOOLRUNNER**: All tool execution through `toolRunner.exec()`. No direct implementation calls.

2. **TOOLS_FEATURE_SCOPED**: Tool contracts AND implementations in `features/ai/tools/`. Pure functions only.

3. **TOOLS_IO_VIA_PORTS**: Tools needing IO call existing ports. Define new port if needed.

4. **REDACTION_REQUIRED**: Every tool defines allowlist. Missing allowlist = error event.

5. **TOOLCALLID_STABLE**: Same ID across start→result. Model-provided or UUID at boundary.

6. **NO_LANGGRAPH_RUNTIME**: Hand-rolled agentic loop. No `@langchain/langgraph` dependency.

---

## Implementation Checklist

### P0: First Tool End-to-End

- [ ] Add `completionWithTools()` to `LlmService` port
- [ ] Implement in `litellm.adapter.ts`
- [ ] Create `generate_title` tool (contract + impl in `features/ai/tools/`)
- [ ] Bind in `tool-registry.ts` (feature-layer, no bootstrap)
- [ ] Implement agentic loop in `chat.graph.ts`
- [ ] Wire `ai_runtime.ts` to route through graph
- [ ] Uncomment route tool handling (lines 264-285)
- [ ] Create tool UI in `features/ai/components/tools/`

#### Chores

- [ ] Observability [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation [document.md](../.agent/workflows/document.md)

### P1: Tool Ecosystem

- [ ] `GraphLlmCaller` enforcement (graphRunId requires graph_name + graph_version)
- [ ] Add tools to `promptHash` (requires canonical tool schema)
- [ ] `ToolFallback.tsx` for unregistered tools
- [ ] Tool telemetry in `ai_invocation_summaries`

### P2: Advanced (Do NOT Build Yet)

- [ ] Multi-tool parallel execution
- [ ] Tool streaming (partial results)

---

## File Pointers (P0)

| File                                                     | Change                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| `src/ports/llm.port.ts`                                  | Add `completionWithTools()`, `ToolDefinition` |
| `src/adapters/server/ai/litellm.adapter.ts`              | Implement tool calling, parse tool_calls      |
| `src/features/ai/tools/generate-title.tool.ts`           | New: contract + pure implementation           |
| `src/features/ai/tool-registry.ts`                       | Register + bind tool                          |
| `src/features/ai/graphs/chat.graph.ts`                   | Agentic loop                                  |
| `src/features/ai/services/ai_runtime.ts`                 | Route to graph                                |
| `src/app/api/v1/ai/chat/route.ts`                        | Uncomment lines 264-285                       |
| `src/features/ai/components/tools/GenerateTitleTool.tsx` | New: tool result UI                           |

---

## Design Decisions

### 1. Tool Architecture

| Layer           | Location                       | Owns                           |
| --------------- | ------------------------------ | ------------------------------ |
| Contract + Impl | `features/ai/tools/*.tool.ts`  | Schema, allowlist, execute()   |
| Registry        | `features/ai/tool-registry.ts` | Name→BoundTool map             |
| IO Port         | `ports/*.port.ts`              | Interface for tools needing IO |
| IO Adapter      | `adapters/server/**`           | Port implementation            |

**Rule:** Tools stay in features. IO via ports only.

### 2. Agentic Loop

Located in `chat.graph.ts`. Iterates: LLM call → if tool_calls, execute via toolRunner → feed results back → repeat.

### 3. Event Flow

`chat.graph.ts` yields AiEvents → `ai_runtime.ts` passes through → `route.ts` maps to assistant-stream.

### 4. Tool UI

Tool components in `features/ai/components/tools/`. Kit cannot import features.

---

## Related Documents

- [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md) - Correlation IDs, telemetry invariants
- [LANGGRAPH_AI.md](LANGGRAPH_AI.md) - Architecture, anti-patterns

---

**Last Updated**: 2025-12-21
**Status**: Draft
