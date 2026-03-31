# graph-viz · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Feature slice for graph visualization. Composes kit/graph components into view-level compositions and provides data adapters that transform domain-specific API responses into the universal `GraphSnapshot` model.

## Pointers

- [kit/graph](../../components/kit/graph/AGENTS.md): underlying visualization components

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["components", "core", "ports", "shared", "types", "contracts"],
  "must_not_import": ["adapters", "app"]
}
```

## Public Surface

- **Exports:**
  - `RunFlowView` — single-run DAG view (FlowGraph + GraphInspector)
  - `SystemTimelineView` — system-wide timeline (ForceGraph + TimelineScrubber + GraphInspector)
  - `runsToTimelineSnapshot` — adapter: `RunCardData[]` → `GraphSnapshot`
  - `monitorToSnapshot` — adapter: monitor-core entities/signals/runs → `GraphSnapshot`
- **Env/Config keys:** none

## Responsibilities

- This directory **does**: compose kit graph components, transform API data into `GraphSnapshot`, manage view-level state (selected node, playback, time filtering)
- This directory **does not**: fetch data directly (consumers pass data via props), define new ports, access database or external services

## Notes

- Monitor adapter types match future `packages/monitor-core` schemas (task.0227) — ready when APIs land
- Dolt adapter deferred to Phase 2
