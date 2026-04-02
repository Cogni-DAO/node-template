---
id: task.0250
type: task
title: "Extract @cogni/graph-execution-host package"
status: needs_implement
priority: 1
rank: 21
estimate: 3
summary: Move graph executor factory, providers, decorators, and MCP cache from apps/operator into a shared PURE_LIBRARY package
outcome: "@cogni/graph-execution-host exports all execution components; apps/operator imports from package instead of local adapters; no behavior change"
spec_refs:
  - packages-architecture-spec
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0257
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels:
  - ai-graphs
  - packages
external_refs:
---

# Extract @cogni/graph-execution-host package

## Context

Parent: task.0181. Step 1 of 3 in moving AI runtime out of Next.js.

Move graph execution components from `apps/operator/src/adapters/server/ai/` and `apps/operator/src/bootstrap/graph-executor.factory.ts` into `packages/graph-execution-host/`. This is a **move, not rewrite** — copy existing working logic verbatim and change only the import paths.

After this task, `apps/operator` imports from `@cogni/graph-execution-host` instead of local adapter paths. No behavior change. The internal API route still works. This enables task.0248 (scheduler-worker wiring).

## Requirements

- Package satisfies `PURE_LIBRARY` (no env vars, no ports, no process lifecycle)
- All providers take injected deps via constructor (no `serverEnv()` calls inside package)
- All decorators take injected deps via constructor (no `getContainer()` calls inside package)
- `apps/operator/src/bootstrap/` rewired to import from `@cogni/graph-execution-host`
- Dependency-cruiser passes (no `@/` imports in package, no `src/` imports)
- `pnpm check` passes with no behavior change

## Files

**Create: `packages/graph-execution-host/`**

- `src/index.ts` — public barrel export
- `src/factory.ts` — `createGraphExecutor`, `createScopedGraphExecutor` (adapted from `graph-executor.factory.ts`)
- `src/providers/inproc.provider.ts` — from `adapters/server/ai/langgraph/inproc.provider.ts`
- `src/providers/dev.provider.ts` — from `adapters/server/ai/langgraph/dev.provider.ts`
- `src/providers/sandbox.provider.ts` — lazy sandbox (from `graph-executor.factory.ts`)
- `src/providers/namespace-router.ts` — from `adapters/server/ai/langgraph/namespace-router.ts`
- `src/decorators/billing-enrichment.decorator.ts`
- `src/decorators/usage-commit.decorator.ts`
- `src/decorators/preflight-credit-check.decorator.ts`
- `src/decorators/observability-executor.decorator.ts`
- `src/execution-scope.ts` — AsyncLocalStorage scope
- `src/mcp-cache.ts` — MCP connection cache with error detection
- `package.json` — deps: `@cogni/graph-execution-core`, `@cogni/ai-core`, `@cogni/langgraph-graphs`, `@cogni/ai-tools`
- `tsconfig.json`, `tsup.config.ts`

**Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts`**

- Replace local adapter imports with `@cogni/graph-execution-host` imports
- Keep as thin wiring layer (reads `serverEnv()`, passes to package factory)

**Modify: `apps/operator/src/adapters/server/` barrel exports**

- Re-export from `@cogni/graph-execution-host` where needed for backward compat during migration

## Design Decisions (reviewed 2026-04-01)

### Type ownership — DECIDED: Option A

Define types in package, app re-exports. **Constraint: Checkpoint 3 (rewire app re-exports) must ship in the same PR as Checkpoints 1-2.** Two sources of truth for `LlmService` etc. cannot persist across PRs.

### Constructor injection — DECIDED: Option A

Inject Logger via constructor. Only PURE_LIBRARY-compliant option. Mechanical call-site updates in `graph-executor.factory.ts` are part of Checkpoint 3.

### `isInsufficientCreditsPortError` — DECIDED: Option A (accept as-is)

Name-based check matches app's existing pattern (`accounts.port.ts` uses same `error.name` check). Both break if class renamed — acceptable tech debt.

### EVENT_NAMES — DECIDED: Option A (inline strings)

3 constants used across 2 files. Inline in package. Not worth injection complexity.

### `AccountService` / `AiTelemetryPort` typing — DECIDED: make CompletionStreamFn opaque

Don't expose `CompletionStreamParams` internals from the package. The `CompletionStreamFn` is a fully injected function — the package doesn't validate its params, the injecting app does. Remove `AccountService` / `AiTelemetryPort` / `Clock` / `RequestContext` from package port types entirely. Use a generic or opaque function signature.

## Plan

### Checkpoint 1: Package compiles standalone (ports + decorators + router)

- Milestone: Package exports decorators, namespace router, execution scope. Compiles with `tsc --noEmit`.
- Invariants: PURE_LIBRARY, NO_SRC_IMPORTS
- Todos:
  - [ ] Finalize port type definitions based on design review
  - [ ] Move 4 decorators with fixed imports
  - [ ] Move NamespaceGraphRouter with Logger injection
  - [ ] Move execution-scope.ts
  - [ ] Move content-scrubbing.ts (pure functions)
  - [ ] `tsc --noEmit` on package passes
- Validation: `npx tsc --noEmit --project packages/graph-execution-host/tsconfig.json`

### Checkpoint 2: Add providers + MCP cache

- Milestone: Package exports all providers. Compiles standalone.
- Todos:
  - [ ] Move InProcCompletionUnitAdapter
  - [ ] Move LangGraphInProcProvider
  - [ ] Move Dev provider (4 files: client, thread, stream-translator, provider)
  - [ ] Move MCP connection cache from graph-executor.factory.ts
  - [ ] Update index.ts barrel exports
  - [ ] `tsc --noEmit` on package passes

### Checkpoint 3: Rewire apps/operator + validate

- Milestone: apps/operator imports from `@cogni/graph-execution-host`. `pnpm check` passes. No behavior change.
- Invariants: All from Design section in task.0181
- Todos:
  - [ ] Update `apps/operator/src/bootstrap/graph-executor.factory.ts` to import from package
  - [ ] Update `apps/operator/src/adapters/server/ai/` barrel to re-export from package
  - [ ] Update all consumers that imported from old paths
  - [ ] Remove moved source files from apps/operator (or keep as re-export shims)
  - [ ] `pnpm check` passes
  - [ ] Commit + push

## Validation

```bash
pnpm check
```

**Expected:** All checks pass. No behavior change. Internal API route still works.
