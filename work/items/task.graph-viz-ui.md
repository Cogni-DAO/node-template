# Task: Graph Viz UI polish and streaming fix

- [ ] Fix chat streaming: ensure /api/v1/ai/chat returns quickly and SSE delivers; investigate AiExecutionError: internal and Redis run stream wiring.
- [ ] Make /api/v1/ai/graphs/:graphId/viz return 200 for sandbox:openclaw (add viz entry or fallback).
- [ ] Collapse tools in map to a single badge ("<agent> tools (N)") and simplify node visuals (no grid background, no extra corner square).
- [ ] Refine colors: keep transparent fill + accent outline/text, remove heavy gradients.
- [ ] Add 3D/three.js view behind dev flag (optional once perf acceptable).
- [ ] Re-run UX review once streaming and UI adjustments land.

Branch: `feature/graph-viz-ui`
Worktree: `/Users/derek/dev/cogni-template-graph-viz`
