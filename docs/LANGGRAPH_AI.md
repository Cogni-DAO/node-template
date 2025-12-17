# LangGraph AI Architecture

> Design decisions, file structure, and schema for LangGraph integration in cogni-template.

## Overview

LangGraph graphs live in `packages/ai-core` as pure logic with no HTTP/DB dependencies. The app orchestrates graph execution via `src/features/ai/services/`, bridging ai-core's ports to the app's adapters.

**Key Principle:** `packages/ai-core` MUST NOT import from `src/`. See [PACKAGES_ARCHITECTURE.md](PACKAGES_ARCHITECTURE.md).

---

## Package Structure

```
packages/ai-core/
├── src/
│   ├── index.ts                     # Public exports
│   ├── ports/
│   │   └── llm.port.ts              # Canonical LLM port definitions
│   ├── hashing/
│   │   └── prompt-hash.ts           # Canonical prompt hash computation
│   ├── graphs/
│   │   └── <graph-name>.graph.ts    # Graph definitions
│   ├── prompts/
│   │   └── <graph-name>.prompt.ts   # Prompt templates
│   └── tools/
│       └── <tool-name>.tool.ts      # Tool contracts (Zod schema + handler interface)
├── tests/
├── package.json                      # @cogni/ai-core
├── tsconfig.json                     # composite: true
└── tsup.config.ts                    # platform: node
```

---

## Port Definitions

### Caller Types

| Type              | Required Fields                                            | Usage                              |
| ----------------- | ---------------------------------------------------------- | ---------------------------------- |
| `AiCoreLlmCaller` | `billingAccountId`, `virtualKeyId`, `requestId`, `traceId` | Direct LLM calls (no graph)        |
| `GraphLlmCaller`  | All above + `graphRunId` (required)                        | LLM calls within a graph execution |

**Invariant:** Graph APIs must accept `GraphLlmCaller` (with required `graphRunId`), NOT optional `graphRunId`.

### LLM Port

| Interface         | Location                           | Purpose                                        |
| ----------------- | ---------------------------------- | ---------------------------------------------- |
| `AiCoreLlmPort`   | `@cogni/ai-core/ports/llm.port.ts` | Canonical LLM completion interface             |
| `AiCoreLlmResult` | `@cogni/ai-core/ports/llm.port.ts` | Return type with required `promptHash`         |
| `LlmService`      | `src/ports/llm.port.ts`            | App extension (re-exports ai-core + streaming) |

---

## Prompt Hash Canonicalization

### Location

`packages/ai-core/src/hashing/prompt-hash.ts` (canonical; app re-exports from here)

### Canonical Payload Fields

| Field                 | Included         | Notes                                          |
| --------------------- | ---------------- | ---------------------------------------------- |
| `prompt_hash_version` | Yes              | Version tag embedded in payload (e.g., `'v1'`) |
| `model`               | Yes              | Model identifier                               |
| `messages`            | Yes              | Array of `{ role, content }`                   |
| `temperature`         | Yes              | Float                                          |
| `max_tokens`          | Yes              | Integer                                        |
| `tools`               | Yes (if present) | Tool definitions array                         |

### Excluded from Hash

- `request_id`, `trace_id`, `user`, `metadata` (correlation/billing fields)

### Single Computation Site

**Invariant:** Only `src/adapters/server/ai/litellm.adapter.ts` computes `promptHash`. Graph code receives it in `AiCoreLlmResult.promptHash`; never re-computes.

---

## Graph Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATION LAYER (src/features/ai/services/<graph>.ts)           │
│ 1. Generate graphRunId (UUID, once per graph invocation)            │
│ 2. Create GraphLlmCaller with graphRunId + graphName + graphVersion │
│ 3. Bridge app's LlmService to ai-core's AiCoreLlmPort               │
│ 4. Call graph function with config + context                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GRAPH LAYER (packages/ai-core/src/graphs/<graph>.graph.ts)          │
│ - Pure logic, no IO                                                 │
│ - Receives LLM port via DI config                                   │
│ - All LLM calls use same GraphLlmCaller (same graphRunId)           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ADAPTER LAYER (src/adapters/server/ai/litellm.adapter.ts)           │
│ - Computes promptHash (single call site)                            │
│ - Extracts litellmCallId, providerCostUsd                           │
│ - Returns AiCoreLlmResult with all fields                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TELEMETRY (src/features/ai/services/completion.ts)                  │
│ - Writes ai_invocation_summaries row per LLM call                   │
│ - Enforces: if graphRunId → graph_name + graph_version non-null     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Correlation ID Requirements

### Essential (Always Required)

| ID              | Scope                     | Persisted To                             |
| --------------- | ------------------------- | ---------------------------------------- |
| `request_id`    | One per inbound request   | ai_invocation_summaries, charge_receipts |
| `trace_id`      | One per distributed trace | ai_invocation_summaries                  |
| `invocation_id` | One per LLM call attempt  | ai_invocation_summaries (UNIQUE)         |

### Essential for Graphs

| ID              | Scope                   | Persisted To            |
| --------------- | ----------------------- | ----------------------- |
| `graph_run_id`  | One per graph execution | ai_invocation_summaries |
| `graph_name`    | Graph identifier        | ai_invocation_summaries |
| `graph_version` | Git SHA at build        | ai_invocation_summaries |

**Enforcement:** If `graph_run_id` is present, `graph_name` and `graph_version` must be non-null.

### Nice-to-Have (Nullable)

| ID                  | Scope             | Notes                                 |
| ------------------- | ----------------- | ------------------------------------- |
| `langfuse_trace_id` | Langfuse-specific | Equals trace_id when Langfuse enabled |
| `litellm_call_id`   | LiteLLM call ID   | Null on errors; join to /spend/logs   |

---

## Schema: ai_invocation_summaries

See [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md#schema-ai_invocation_summaries) for full schema.

**Graph-specific columns:**

| Column          | Type | Notes                                               |
| --------------- | ---- | --------------------------------------------------- |
| `graph_run_id`  | text | Nullable; identifies graph execution within request |
| `graph_name`    | text | Nullable; null = direct LLM call                    |
| `graph_version` | text | Nullable; git SHA of graph code                     |

**Invariant:** If `graph_run_id` is NOT NULL, then `graph_name` and `graph_version` must also be NOT NULL.

---

## Tool Structure

### Contract (in ai-core)

| File                                        | Contents                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| `packages/ai-core/src/tools/<tool>.tool.ts` | Tool name, Zod input/output schemas, handler interface |

### Implementation (in adapters)

| File                                | Contents                           |
| ----------------------------------- | ---------------------------------- |
| `src/adapters/tools/<tool>.impl.ts` | IO, policy checks, instrumentation |

### Registry (in features)

| File                               | Contents                                |
| ---------------------------------- | --------------------------------------- |
| `src/features/ai/tool-registry.ts` | Binds tool contracts to implementations |

**Port guidance:** One port per external system, NOT per tool.

| Port              | Backs Tools            |
| ----------------- | ---------------------- |
| `KnowledgePort`   | RAG search, doc lookup |
| `WebResearchPort` | Web search, URL fetch  |
| `RepoPort`        | Code search, file read |
| `McpPort`         | MCP server calls       |

---

## File Pointers

| File                                          | Purpose                                           |
| --------------------------------------------- | ------------------------------------------------- |
| `packages/ai-core/src/ports/llm.port.ts`      | Canonical `AiCoreLlmPort`, `GraphLlmCaller` types |
| `packages/ai-core/src/hashing/prompt-hash.ts` | `computePromptHash()`, `PROMPT_HASH_VERSION`      |
| `packages/ai-core/src/graphs/*.graph.ts`      | Graph definitions (pure logic)                    |
| `packages/ai-core/src/tools/*.tool.ts`        | Tool contracts (Zod schemas)                      |
| `src/ports/llm.port.ts`                       | Re-exports from ai-core + app streaming extension |
| `src/features/ai/services/*.ts`               | Orchestration services (generates graphRunId)     |
| `src/adapters/server/ai/litellm.adapter.ts`   | LLM adapter (sole promptHash computation site)    |
| `src/adapters/tools/*.impl.ts`                | Tool implementations (IO)                         |
| `src/features/ai/tool-registry.ts`            | Tool contract → implementation binding            |
| `src/shared/db/schema.ai.ts`                  | ai_invocation_summaries table                     |

---

## Anti-Patterns

1. **No IO in ai-core** — Tool contracts define schemas; implementations live in adapters
2. **No graphs in app routes** — LangGraph stays in packages/ai-core, never absorbs HTTP/DB
3. **No port-per-tool** — Ports per external system; tools compose on top
4. **No optional graphRunId in graph APIs** — Use distinct caller types with required fields
5. **No duplicate promptHash computation** — Only adapter computes; graph receives result
6. **No span_id persistence** — span_id is for tracing UI only; not a durable join key

---

## Related Docs

- [AI_SETUP_SPEC.md](AI_SETUP_SPEC.md) — P0/P1/P2 checklists, ID map, invariants
- [AI_EVALS.md](AI_EVALS.md) — Eval harness structure, CI gates
- [PACKAGES_ARCHITECTURE.md](PACKAGES_ARCHITECTURE.md) — Package creation rules
- [ARCHITECTURE.md](ARCHITECTURE.md) — Hexagonal layers

---

**Last Updated**: 2025-12-17
**Status**: Design Approved (P1 implementation pending)
