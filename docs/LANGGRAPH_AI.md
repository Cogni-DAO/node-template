# LangGraph AI Guide

> How to create and execute LangGraph agentic workflows (InProc and Server paths).

> [!IMPORTANT]
> All LangChain code lives in `packages/langgraph-graphs/`. Next.js (`src/`) never imports `@langchain/*`. Both InProc and Server executors implement `GraphExecutorPort` for unified billing/telemetry.

## Overview

LangGraph graphs can execute via two paths:

| Path       | Adapter                      | Use Case                                             |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| **InProc** | `InProcGraphExecutorAdapter` | Next.js process; billing via executeCompletionUnit() |
| **Server** | `LangGraphServerAdapter`     | External LangGraph Server container                  |

**Key Principle:** All AI execution flows through `GraphExecutorPort`. The executor choice is an implementation detail behind the unified interface. See [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) for billing/tracking patterns.

---

## Package Structure

```
packages/
├── ai-core/                          # Executor-agnostic primitives (NO LangChain)
│   └── src/
│       ├── completion/types.ts       # CompletionFn, CompletionResult
│       ├── messages/message.ts       # Message, MessageToolCall
│       ├── events/ai-events.ts       # AiEvent union
│       └── usage/usage.ts            # UsageFact, ExecutorType
│
├── ai-tools/                         # Pure tool definitions (NO LangChain)
│   └── src/
│       ├── index.ts                  # Barrel export
│       ├── tool-runner.ts            # ToolContract, BoundTool, toolRunner logic
│       └── tools/
│           └── get-time.ts           # Pure impl: () => { iso, unixMs, tz }
│
└── langgraph-graphs/                 # ALL LangChain code lives here
    └── src/
        ├── graphs/                   # Graph definitions (tools, prompts)
        │   └── chat/                 # Chat graph (executes LangGraph AI internally)
        │       ├── tools.ts          # Tool definitions
        │       └── prompts.ts        # System prompts
        ├── runtime/                  # Shared LangChain utilities
        │   ├── completion-unit-llm.ts # CompletionUnitLLM, toBaseMessage, fromBaseMessage
        │   ├── langchain-tools.ts    # toLangChainTool(), toLangChainTools()
        │   └── subgraph-tool.ts      # createSubgraphTool()
        └── inproc/                   # InProc execution
            ├── chat.ts               # createChatGraph(llm) factory
            └── runner.ts             # createInProcChatRunner()
```

### Subpath Exports

```typescript
// Graph definitions (Server path imports)
import { chatGraph } from "@cogni/langgraph-graphs/graphs";

// Runtime utilities (converters, LLM wrapper)
import {
  CompletionUnitLLM,
  toBaseMessage,
  fromBaseMessage,
} from "@cogni/langgraph-graphs/runtime";

// InProc execution (Next.js adapter imports)
import {
  createInProcChatRunner,
  createChatGraph,
} from "@cogni/langgraph-graphs/inproc";
```

---

## Core Invariants

1. **NO_LANGCHAIN_IN_SRC**: `src/**` cannot import `@langchain/*`. Enforced by dependency-cruiser.
2. **PACKAGES_NO_SRC_IMPORTS**: `packages/**` cannot import from `src/**`. Enforced by dependency-cruiser.
3. **SINGLE_COMPLETIONFN**: Only `@cogni/ai-core` exports `CompletionFn`. All executors use this signature.
4. **FINAL_GATES_COMPLETION**: `final` must not resolve until the graph run completes and the token queue is closed; runner must finalize correctly even if the consumer stops early.
5. **RESULT_REFLECTS_OUTCOME**: `runner.final.ok` must match stream success/failure (deferred promise pattern).
6. **CANCEL_PROPAGATION**: If the consumer stops/cancels the stream, runner must abort underlying completion/graph execution (via AbortSignal or equivalent) and close the queue to avoid leaked work.
7. **ENV_FREE_EXPORTS**: Package exports never read `env.ts` or instantiate provider SDKs directly.
8. **SINGLE_AIEVENT_CONTRACT**: Both InProc and Server executors emit identical AiEvent semantics at the GraphExecutorPort boundary. Executor-specific raw translation is permitted; shared mapping helpers encouraged. Conformance tests verify equivalent event sequences.
9. **NO_AWAIT_IN_TOKEN_PATH**: The path from LLM token emission to AiEvent yield must not await I/O or slow operations. Use synchronous queue push to prevent backpressure-induced stream aborts.
10. **NO_DIRECT_MODEL_CALLS_IN_INPROC_GRAPH_CODE**: In InProc execution, all model calls must go through `CompletionUnitLLM` (via injected `CompletionFn`). No direct `ChatOpenAI`/`initChatModel`/provider SDK calls in graph or tool code. This ensures billing/streaming/telemetry are never bypassed.
11. **DRAIN_BEFORE_FINAL**: Stream must be fully consumed before awaiting final (prevents deadlock).

---

## InProc Execution Path

InProc executes LangGraph within the Next.js process with billing through the adapter layer.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Facade / AI Runtime                                                  │
│ - Creates GraphRunRequest with messages, model, caller               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Bootstrap Factory (graph-executor.factory.ts)                        │
│ - createInProcGraphExecutor() wires GraphResolverFn                  │
│ - Routes "chat" → createLangGraphRunner(adapter)                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ InProcGraphExecutorAdapter                                           │
│ - Wraps executeCompletionUnit → ai-core CompletionFn                 │
│ - Calls createInProcChatRunner() from package                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ @cogni/langgraph-graphs/inproc                                       │
│ - runner.ts: createInProcChatRunner(completionFn, req)               │
│ - Creates CompletionUnitLLM with injected CompletionFn + tokenSink   │
│ - Creates graph with createChatGraph(llm)                            │
│ - Executes via graph.invoke() (NOT stream/streamEvents)              │
│ - Tokens emitted via tokenSink.push() (sync)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### CompletionUnitLLM

`CompletionUnitLLM` (`runtime/completion-unit-llm.ts`) is a LangChain `BaseChatModel` wrapper that routes LLM calls through injected `CompletionFn`:

```typescript
export class CompletionUnitLLM extends BaseChatModel {
  constructor(
    completionFn: CompletionFn,
    modelId: string,
    tokenSink?: { push: (event: AiEvent) => void } // Sync push for streaming
  ) {}

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    // Convert BaseMessage → ai-core Message via fromBaseMessage()
    // Call completionFn, drain stream, push tokens to tokenSink (sync)
    // Collect results for billing aggregation
  }

  getCollectedResults(): CompletionUnitGenerateResult[] {
    // Returns all LLM call results for usage_report emission
  }

  // NOTE: _streamResponseChunks() exists but is NOT called when using
  // createReactAgent (which uses invoke() internally). Token streaming
  // is achieved via tokenSink injection in _generate().
}
```

### Canonical Converters

```typescript
// ai-core Message → LangChain BaseMessage
export function toBaseMessage(msg: Message): BaseMessage;

// LangChain BaseMessage → ai-core Message
export function fromBaseMessage(msg: BaseMessage): Message;
```

### createInProcChatRunner (inproc/runner.ts)

Main entry point for InProc execution:

```typescript
export function createInProcChatRunner(
  completionFn: CompletionFn,
  req: InProcGraphRequest
): { stream: AsyncIterable<AiEvent>; final: Promise<GraphResult> };
```

**Deferred Promise Pattern:** Uses shared deferred promise so `final` reflects actual execution outcome even if stream is not fully consumed.

---

## Server Execution Path

Server path calls external LangGraph Agent Server via SDK. See [LANGGRAPH_SERVER.md](LANGGRAPH_SERVER.md) for infrastructure details.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Facade / AI Runtime                                                  │
│ - Creates GraphRunRequest with messages, model, caller               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LangGraphServerAdapter                                               │
│ - Derives tenant-scoped thread_id (UUIDv5)                           │
│ - Calls SDK client.runs.stream()                                     │
│ - Translates messages-tuple chunks → AiEvents                        │
│ - Emits usage_report with accumulated tokens                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LangGraph Server (External Process)                                  │
│ - Executes graph, owns thread state/checkpoints                      │
│ - Routes LLM calls through LiteLLM proxy                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Billing Contract Divergence (P0 Known Issue)

| Field                       | InProc | Server |
| --------------------------- | ------ | ------ |
| usageUnitId (litellmCallId) | Yes    | No     |
| costUsd                     | Yes    | No     |
| model (resolved)            | Yes    | No     |
| inputTokens / outputTokens  | Yes    | Yes    |

**Decision needed:** Mark server path non-reconcilable for P0, OR enhance server to emit full billing facts.

---

## Creating a New Graph

### 1. Define Graph in Package

Create graph definition in `packages/langgraph-graphs/src/graphs/<name>/`:

```
packages/langgraph-graphs/src/graphs/my-agent/
├── graph.ts          # Graph for Server path
├── tools.ts          # Tool definitions (Zod schemas)
└── prompts.ts        # System prompts
```

### 2. Create InProc Factory (if needed)

If graph needs InProc execution with injected LLM:

```typescript
// packages/langgraph-graphs/src/inproc/my-agent.ts
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { myAgentTools, MY_AGENT_PROMPT } from "../graphs/my-agent";

export function createMyAgentGraph(llm: BaseChatModel) {
  return createReactAgent({
    llm,
    tools: [...myAgentTools],
    prompt: MY_AGENT_PROMPT,
  });
}
```

### 3. Add Runner (InProc path)

Create runner in `packages/langgraph-graphs/src/inproc/`:

```typescript
// Similar to runner.ts but using createMyAgentGraph
export function createInProcMyAgentRunner(
  completionFn: CompletionFn,
  req: InProcGraphRequest
): { stream: AsyncIterable<AiEvent>; final: Promise<GraphResult> };
```

### 4. Wire in Bootstrap Factory

```typescript
// src/bootstrap/graph-executor.factory.ts
const graphResolver: GraphResolverFn = (graphName, adapter) => {
  if (graphName === "chat") return createLangGraphRunner(adapter);
  if (graphName === "my-agent") return createMyAgentRunner(adapter);
  return undefined;
};
```

### 5. Export from Package Index

```typescript
// packages/langgraph-graphs/src/inproc/index.ts
export { createMyAgentGraph } from "./my-agent";
export { createInProcMyAgentRunner } from "./my-agent-runner";
```

---

## Tool Structure

### Definition Location

| Executor   | Tool Location                                          | Notes                        |
| ---------- | ------------------------------------------------------ | ---------------------------- |
| **InProc** | `packages/langgraph-graphs/src/graphs/<name>/tools.ts` | Executed in Next.js process  |
| **Server** | Same package location                                  | Executed in LangGraph Server |

### Tool Contract Pattern

```typescript
// packages/langgraph-graphs/src/graphs/chat/tools.ts
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const webSearchTool = tool(
  async ({ query }) => {
    // Tool implementation
    return JSON.stringify(results);
  },
  {
    name: "web_search",
    description: "Search the web for information",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  }
);

export const chatTools = [webSearchTool];
```

### Tool Separation of Concerns

| Package                   | Owns                                       | Dependencies                         |
| ------------------------- | ------------------------------------------ | ------------------------------------ |
| `@cogni/ai-tools`         | Pure tool logic, schemas (Zod), allowlists | `zod` only                           |
| `@cogni/langgraph-graphs` | LangChain `tool()` wrappers                | `@cogni/ai-tools`, `@langchain/core` |

### LangChain Tool Wrapping

```typescript
// packages/langgraph-graphs/src/runtime/langchain-tools.ts
export function toLangChainTool(opts: {
  contract: ToolContract;
  exec: (name: string, args: unknown) => Promise<string>;
  eventSink?: { push: (event: AiEvent) => void };
  toolCallIdFactory?: () => string;
}): StructuredTool;

export function toLangChainTools(opts: {
  registry: ToolRegistry;
  eventSink?: { push: (event: AiEvent) => void };
  // ...deps
}): StructuredTool[];
```

---

## langgraph.json Configuration

For Server path, graphs are registered in `packages/langgraph-server/langgraph.json`:

```json
{
  "node_version": "20",
  "graphs": {
    "chat": "./src/index.ts:chatGraph",
    "my-agent": "./src/index.ts:myAgentGraph"
  },
  "env": ".env"
}
```

The `langgraph-server` package re-exports graphs from `@cogni/langgraph-graphs/graphs`.

---

## Implementation Checklist

### P0: InProc LangGraph Execution

- [ ] Create `@cogni/ai-core` with canonical types (CompletionFn, Message, AiEvent, UsageFact)
- [ ] Create `@cogni/langgraph-graphs` package structure
- [ ] Implement `CompletionUnitLLM` wrapper in runtime
- [ ] Implement `toBaseMessage()` / `fromBaseMessage()` converters
- [ ] Implement `createInProcChatRunner()` in inproc
- [ ] Implement `createChatGraph(llm)` factory in inproc
- [ ] Create `langgraph-runner.ts` thin adapter (NO `@langchain` imports)
- [ ] Wire `createLangGraphRunner()` in bootstrap factory
- [ ] Add dependency-cruiser rules (NO_LANGCHAIN_IN_SRC, PACKAGES_NO_SRC_IMPORTS)
- [ ] Add grep test: `@langchain` only in `packages/langgraph-graphs/`

### P0: Server Path

- [ ] Create `LangGraphServerAdapter` implementing `GraphExecutorPort`
- [ ] Implement `thread_id` derivation (UUIDv5, tenant-scoped)
- [ ] Implement SDK streaming with usage accumulation
- [ ] Resolve billing contract divergence (missing usageUnitId/costUsd)

### P0: InProc Token Streaming (SINGLE_AIEVENT_CONTRACT)

InProc uses `graph.invoke()` + AsyncQueue pattern (NOT `streamEvents`). Tokens flow from `CompletionUnitLLM` → queue → AiEvent yield. Server keeps SDK SSE streaming.

**Translation Ownership:**

| Component             | Owns                                                            | Shared Helpers                                                        |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Server Adapter**    | SSE decoding, `{event, data}` envelope parsing                  | Content extraction, AiEvent constructors                              |
| **InProc Runner**     | Token queue lifecycle, `invoke()` orchestration, final emission | Content extraction, AiEvent constructors                              |
| **Shared (runtime/)** | —                                                               | `extractTextContent()`, `createTextDeltaEvent()`, `accumulateUsage()` |

**Token Flow:**

- InProc: `CompletionUnitLLM._generate()` → `tokenSink.push()` (sync) → AsyncQueue → yield AiEvent
- Server: SDK `client.runs.stream()` → SSE → `translateChunk()` → yield AiEvent
- Both paths emit identical AiEvent sequences at GraphExecutorPort boundary

**Remaining:**

- [ ] Factor shared helper functions: `extractTextContent()`, `accumulateUsage()`
- [ ] Add conformance test: same prompt → both paths emit comparable AiEvent sequences
- [ ] Verify stack tests: `text_delta` events appear BEFORE `done` event

### P0: Tool Support

- [ ] Create `packages/ai-tools` package (NO `@langchain`, NO `src` imports)
- [ ] Move tool contracts + pure implementations to `packages/ai-tools`
- [ ] Create `toLangChainTool()` wrapper in `packages/langgraph-graphs/src/runtime/`
- [ ] Update `createChatGraph(llm, tools)` to accept injected tools
- [ ] Wire `toolExec` function in `langgraph-runner.ts` (passes to package APIs)
- [ ] Add stack test: tool_call_start/tool_call_result events emitted

### P1: Multi-Graph Support

- [ ] Add second graph type to prove pattern
- [ ] Document graph registration workflow
- [ ] Add eval harness for graph comparison

---

## Anti-Patterns

1. **No `@langchain` imports in `src/`** — All LangChain code in `packages/langgraph-graphs/`
2. **No hardcoded models in graphs** — Model comes from `GraphRunRequest.model` → `config.configurable.model`
3. **No direct `ChatOpenAI` in InProc** — Use `CompletionUnitLLM` wrapper for billing
4. **No raw `thread_id` from client** — Always derive server-side with tenant prefix
5. **No `done` emission in completion unit** — Only graph-level runner emits `done`
6. **No env reads in package exports** — Inject dependencies, don't read `env.ts`
7. **No `await` in token sink** — `tokenSink.push()` must be synchronous; async causes backpressure aborts
8. **No `streamEvents()` for InProc** — Use `invoke()` + AsyncQueue; `streamEvents()` has Pregel lifecycle issues
9. **No circular dependencies** — `ai-tools` must not import `langgraph-graphs`; only `langgraph-graphs` wraps `ai-tools` into LangChain tools
10. **No nested `done`/`final` from subgraphs** — Subgraph invocation runs in "subgraph mode" (no `done`); parent run owns `done`/`final`

---

## Related Documents

- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — Executor-agnostic billing, tracking, UI/UX patterns
- [LANGGRAPH_SERVER.md](LANGGRAPH_SERVER.md) — Infrastructure: Docker, Redis, container deployment
- [LANGGRAPH_TESTING.md](LANGGRAPH_TESTING.md) — Testing strategy for both executors
- [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md) — Correlation IDs, telemetry
- [TOOL_USE_SPEC.md](TOOL_USE_SPEC.md) — Tool execution invariants

---

**Last Updated**: 2025-12-29
**Status**: Draft (Rev 7 - invoke + AsyncQueue pattern, tool support planned)
