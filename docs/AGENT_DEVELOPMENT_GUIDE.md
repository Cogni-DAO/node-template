# Agent Development Guide

> Quick reference for adding new agent graphs. For architecture details, see [LANGGRAPH_AI.md](LANGGRAPH_AI.md).

## Tier 1: Single-Node Agent (Default)

Use this structure for simple agents with one ReAct loop.

```
packages/langgraph-graphs/src/graphs/<name>/
├── graph.ts      # Factory: createXxxGraph(opts) → CompiledGraph
└── prompts.ts    # System prompt constant(s)
```

### Template: Copy from `ponderer/`

```bash
cp -r packages/langgraph-graphs/src/graphs/ponderer packages/langgraph-graphs/src/graphs/<name>
```

### Files to Edit

**1. `prompts.ts`** — Define your system prompt:

```typescript
export const MY_AGENT_SYSTEM_PROMPT = `Your system prompt here.` as const;
```

**2. `graph.ts`** — Import prompt, rename exports:

```typescript
import { MY_AGENT_SYSTEM_PROMPT } from "./prompts";

export const MY_AGENT_GRAPH_NAME = "my-agent" as const;

export function createMyAgentGraph(
  opts: CreateMyAgentGraphOptions
): MyAgentGraph {
  return createReactAgent({
    llm: opts.llm,
    tools: opts.tools,
    messageModifier: MY_AGENT_SYSTEM_PROMPT,
  }) as unknown as MyAgentGraph;
}
```

**3. `packages/langgraph-graphs/src/graphs/index.ts`** — Add export:

```typescript
export { createMyAgentGraph, MY_AGENT_GRAPH_NAME } from "./my-agent/graph";
```

**4. `packages/langgraph-graphs/src/catalog.ts`** — Add catalog entry:

```typescript
[MY_AGENT_GRAPH_NAME]: {
  displayName: "My Agent",
  description: "What this agent does",
  boundTools: { [GET_CURRENT_TIME_NAME]: getCurrentTimeBoundTool },
  graphFactory: createMyAgentGraph,
},
```

### Build and Verify

```bash
pnpm packages:build && pnpm check
```

## Deprecation Warning

> **`createReactAgent` from `@langchain/langgraph/prebuilt` is deprecated/migrated.**
> LangGraph v1 moves this to `langchain` package. Pin versions in `package.json`.
> Future migration to `createAgent` from `langchain` is expected.

## Tier 2: Composed Graphs (Future)

For multi-node graphs with custom routing, see [LANGGRAPH_AI.md](LANGGRAPH_AI.md) Tier 2 section (planned).

## Related

- [LANGGRAPH_AI.md](LANGGRAPH_AI.md) — Architecture patterns
- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — Execution invariants
- [packages/langgraph-graphs/AGENTS.md](../packages/langgraph-graphs/AGENTS.md) — Package surface
