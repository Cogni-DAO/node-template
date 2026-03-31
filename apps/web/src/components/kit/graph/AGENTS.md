# kit/graph · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Reusable graph visualization components wrapping `@xyflow/react` (DAG flow diagrams) and `react-force-graph-2d` (force-directed timeline). Provides a unified `GraphSnapshot` data model consumed by all adapters.

## Pointers

- [types.ts](./types.ts): `GraphNode`, `GraphEdge`, `GraphSnapshot` — the universal data model
- [Architecture Spec](../../../../../../docs/spec/architecture.md): SSR-unsafe library handling

## Boundaries

```json
{
  "layer": "components/kit",
  "may_import": ["@/styles/ui", "@radix-ui/*", "@/components/vendor/shadcn/*", "@/shared/util"],
  "must_not_import": ["@/features", "@/app", "@/adapters", "@/ports", "@/core"]
}
```

## Public Surface

- **Exports (via `@/components` barrel):**
  - `FlowGraph` — `@xyflow/react` wrapper for structured DAG rendering
  - `ForceGraph` — `react-force-graph-2d` wrapper for animated force-directed graphs
  - `GraphInspector` — shadcn Sheet panel for node metadata inspection
  - `TimelineScrubber` — playback controls (play/pause, speed, time scrub)
  - `GraphNode`, `GraphEdge`, `GraphSnapshot` — type exports
- **Env/Config keys:** none

## Responsibilities

- This directory **does**: wrap vendor graph libraries behind kit components, define the shared graph data model, handle SSR-safe dynamic imports
- This directory **does not**: fetch data, define adapters, implement business logic, access ports or services
