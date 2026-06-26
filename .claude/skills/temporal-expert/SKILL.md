---
name: temporal-expert
description: Use when adding scheduled, recurring, or AI workflow behavior to a Cogni node; deciding graph vs route vs own Temporal worker; working with /api/v1/schedules, GraphRunWorkflow, NodeTaskWorkflow, defineScheduledJob, or the shared scheduler-worker substrate.
---

# Temporal Expert

Read `docs/guides/node-temporal.md` first. It is the node-author guide.

Default stance:

- Scheduled AI work is a graph run via `GraphRunWorkflow`.
- Plain recurring work is a route, preferably declared with `defineScheduledJob`, via `NodeTaskWorkflow`.
- Normal nodes do not add Temporal workflow code and do not run their own worker.
- Per-node workers are a rare escape hatch for custom durable orchestration that the shared generic substrate cannot express.

When changing substrate design, also read:

- `docs/spec/substrate-temporal.md`
- `docs/spec/temporal-patterns.md`
- `docs/spec/langgraph-patterns.md`
