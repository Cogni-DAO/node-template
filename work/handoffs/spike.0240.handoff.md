---
id: spike.0240.handoff
type: handoff
work_item_id: spike.0240
status: active
created: 2026-03-31
updated: 2026-03-31
branch: worktree-spike+0240-graph-visualization
last_commit: 921f0b32
---

# Handoff: Graph Visualization Frontend (spike.0240)

## Context

- Cogni needs a unified frontend for visualizing Temporal workflows, LangGraph graphs, monitor-core pipeline data, and agent timelines
- Inspired by Gource (animated git history viz) but interactive, zoomable, and in-browser — no video generation
- Two OSS libs selected: `@xyflow/react` (DAG flow diagrams) and `react-force-graph-2d` (Gource-style force-directed timeline)
- Builds on the monitor-core pipeline (task.0227) which provides continuous data streams of entities, signals, and analysis runs
- PR open: [Cogni-DAO/node-template#671](https://github.com/Cogni-DAO/node-template/pull/671)

## Current State

- **Done:** Full implementation — kit components, feature slice, `/graph` route, sidebar nav item, data adapters, AGENTS.md
- **Done:** `pnpm check` passes clean (all 11 checks green)
- **Done:** Design review approved, implementation review approved with fixes applied
- **Not done:** The `/graph` page is functional but shows limited data — only run metadata from `fetchRuns()` is available today. Rich graph structure (node/edge topology within a run) requires LangGraph trace API wiring
- **Not done:** Monitor adapter (`monitor.adapter.ts`) has types ready but no API to consume yet (blocked on task.0227)
- **Not done:** Temporal and Dolt adapters are Phase 2
- **Parked:** User decided to hold off on merging — the page works but needs real data to be useful

## Decisions Made

- Two-lib approach over single lib (@antv/g6 rejected for 7.6MB size + weaker React DX) — see [spike design](../items/spike.0240.graph-visualization-frontend.md#q2-leanest-stack)
- Own `/graph` sidebar route (not a dashboard subtab) — user's explicit request
- `GraphNode.type` is open `string`, not closed union — adapters define their own types
- Canvas rendering in ForceGraph uses raw hex colors (CSS custom properties not available in Canvas API) — documented deviation from TOKENS_ONLY
- Default view: live timeline of current week with auto-advance and 5s polling

## Next Actions

- [ ] Wire LangGraph trace API to get real node/edge topology within runs (not just flat run metadata)
- [ ] Implement monitor-core API routes (`/brain/status`, `/brain/signals`) from task.0227
- [ ] Connect monitor adapter to real API once available
- [ ] Add dagre/elkjs layout to FlowGraph for meaningful DAG positioning (currently grid layout)
- [ ] Consider removing `/graph` route from sidebar until data is richer, or gate behind feature flag
- [ ] Add Temporal workflow adapter when Temporal API is wired to frontend
- [ ] Dolt commit graph adapter when Dolt HTTP API is available

## Risks / Gotchas

- `react-force-graph-2d` has a single maintainer (vasturiano, 3k stars) — if abandoned, evaluate whether `@xyflow/react` with force-layout plugin can cover both modes
- ForceGraph uses `dynamic()` with `ssr: false` — Canvas API not available server-side
- The flow view for a single run currently shows just one node (no internal graph structure) — needs trace API for meaningful DAGs
- TimelineScrubber recreates its interval on every tick (value in deps array) — works but causes GC pressure. Ref-based approach would be cleaner

## Pointers

| File / Resource                                                                                | Why it matters                                                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `work/items/spike.0240.graph-visualization-frontend.md`                                        | Full design spec with library comparison, data model, component architecture             |
| `apps/web/src/components/kit/graph/types.ts`                                                   | `GraphNode`, `GraphEdge`, `GraphSnapshot` — the universal data model all adapters target |
| `apps/web/src/components/kit/graph/`                                                           | Kit wrappers: FlowGraph, ForceGraph, GraphInspector, TimelineScrubber                    |
| `apps/web/src/features/graph-viz/`                                                             | Feature slice: RunFlowView, SystemTimelineView, adapters                                 |
| `apps/web/src/app/(app)/graph/view.tsx`                                                        | Main page view — React Query polling, timeline/flow toggle                               |
| `apps/web/src/features/layout/components/AppSidebar.tsx`                                       | Sidebar nav — Graph item added here                                                      |
| `/Users/derek/dev/cogni-resy-helper/work/items/task.0227.poly-mvp-agent-workflows-and-taps.md` | Monitor engine design — defines the data streams this viz consumes                       |
