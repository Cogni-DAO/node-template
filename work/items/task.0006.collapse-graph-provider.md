---
id: task.0006
type: task
title: "Collapse GraphProvider into GraphExecutorPort — single execution interface + namespace routing"
status: Todo
priority: 1
estimate: 3
summary: Delete GraphProvider interface; providers implement GraphExecutorPort directly. Replace canHandle() with deterministic namespace prefix routing in the aggregator. Same cleanup for AgentCatalogProvider.
outcome: One execution interface (GraphExecutorPort), one routing mechanism (prefix map), no canHandle() anywhere. Adding a new adapter means implementing GraphExecutorPort + registering a providerId.
spec_refs: graph-execution, unified-graph-launch
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [ai-graphs, refactoring]
external_refs:
---

## Problem

`GraphProvider` is effectively a second port with the same `runGraph(req) -> GraphRunResult` signature as `GraphExecutorPort`. Combined with per-provider `canHandle()` logic, this creates two problems:

1. **Duplicate interface** — new adapters must choose between implementing the port or the internal provider. The "correct" pattern (implement provider, register with aggregator) is not enforced by types.
2. **Redundant routing** — `canHandle()` in each provider reimplements the same prefix check (`graphId.startsWith(providerId + ":")`), sometimes with catalog membership checks mixed in. Routing should be deterministic by namespace, not provider-specific.

## Current Architecture

```
GraphExecutorPort (port)
  └─ AggregatingGraphExecutor (adapter, implements port)
       └─ GraphProvider[] (internal interface, same runGraph signature)
            ├─ LangGraphInProcProvider { canHandle: prefix + catalog }
            ├─ LangGraphDevProvider    { canHandle: prefix + availableGraphs }
            ├─ SandboxGraphProvider     { canHandle: prefix + SANDBOX_AGENTS }
            └─ LazySandboxGraphProvider { canHandle: prefix only }

AgentCatalogPort (port)
  └─ AggregatingAgentCatalog (adapter, implements port)
       └─ AgentCatalogProvider[] (internal interface, has canHandle too)
```

## Target Architecture

```
GraphExecutorPort (port — single execution interface)
  └─ NamespaceRouter (adapter, implements port)
       └─ Map<providerId, GraphExecutorPort>
            ├─ "langgraph" → LangGraphInProcProvider (implements GraphExecutorPort)
            ├─ "sandbox"   → SandboxGraphProvider    (implements GraphExecutorPort)
            └─ (future)    → NewProvider              (implements GraphExecutorPort)

AgentCatalogPort (port — discovery only, no routing)
  └─ AggregatingAgentCatalog (adapter, implements port)
       └─ AgentCatalogProvider[] { listAgents() only, no canHandle }
```

## Invariants Enforced

- **SINGLE_EXECUTION_INTERFACE**: Only `GraphExecutorPort` owns `runGraph()`. `GraphProvider` deleted.
- **ROUTING_BY_NAMESPACE_ONLY**: `NamespaceRouter` parses `graphId.split(":")[0]` once, looks up `Map<string, GraphExecutorPort>`. No per-provider routing logic.
- **ADAPTERS_IMPLEMENT_PORTS**: Every provider adapter implements `GraphExecutorPort` directly.
- **DISCOVERY_SEPARATION**: `AgentCatalogProvider` drops `canHandle()`. Discovery is `flatMap(p => p.listAgents())`, not routed.

## Execution Plan

### 1. Refactor providers to implement GraphExecutorPort

Each provider already has the right `runGraph()` signature. Changes:

- Remove `implements GraphProvider`, add `implements GraphExecutorPort`
- Keep `providerId` as a readonly property (used by router for registration)
- Move any catalog-membership checks from `canHandle()` into `runGraph()` as runtime validation (return error result for unknown graph names)

Files:

- `src/adapters/server/ai/langgraph/inproc.provider.ts`
- `src/adapters/server/ai/langgraph/dev/provider.ts`
- `src/adapters/server/sandbox/sandbox-graph.provider.ts`
- `src/bootstrap/graph-executor.factory.ts` (LazySandboxGraphProvider)

### 2. Replace AggregatingGraphExecutor with NamespaceRouter

- Constructor takes `Map<string, GraphExecutorPort>` (or `Record<string, GraphExecutorPort>`)
- `runGraph()` parses `graphId.split(":")[0]`, looks up provider, delegates
- Unknown namespace → error result (same as current "no provider found")
- Rename class: `AggregatingGraphExecutor` → `NamespaceGraphRouter` (or similar)

File: `src/adapters/server/ai/aggregating-executor.ts`

### 3. Delete GraphProvider interface

File: `src/adapters/server/ai/graph-provider.ts` — delete entirely

### 4. Clean up AgentCatalogProvider

- Remove `canHandle()` from interface
- Remove `canHandle()` from all implementers
- `AggregatingAgentCatalog` simplifies to pure fanout

Files:

- `src/adapters/server/ai/agent-catalog.provider.ts`
- `src/adapters/server/ai/langgraph/inproc-agent-catalog.provider.ts`
- `src/adapters/server/ai/langgraph/dev/agent-catalog.provider.ts`
- `src/adapters/server/sandbox/sandbox-agent-catalog.provider.ts`
- `src/adapters/server/ai/aggregating-agent-catalog.ts`

### 5. Update factory wiring

- `createGraphExecutor()` builds `Map<string, GraphExecutorPort>` from providers
- Pass map to `NamespaceGraphRouter` constructor

File: `src/bootstrap/graph-executor.factory.ts`

### 6. Update tests

- Routing tests: verify namespace parsing, unknown namespace → error
- Provider tests: remove canHandle assertions, add runGraph unknown-graph assertions

## Validation

- `pnpm check` — no type errors
- `pnpm test` — all unit/integration pass
- `pnpm test:contract` — contract tests pass
- `pnpm test:stack:dev` — stack tests pass (graph execution still works end-to-end)
- Verify: `GraphProvider` interface no longer exists in codebase
- Verify: no `canHandle` method anywhere in execution layer
