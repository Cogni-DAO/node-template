---
id: guide.node-temporal
type: guide
title: Building recurring & AI workflows in a node
status: draft
trust: draft
summary: "How a node-template node builds recurring and AI workflows on the shared Temporal substrate. The default needs NO node worker: AI work that fits in one graph run is scheduled through GraphRunWorkflow; plain crons are routes. Durable multi-step and human-in-the-loop composition is roadmap work, with per-node workers only as a rare escape hatch."
read_when: "You are a node dev adding scheduled, recurring, AI, or human-in-the-loop work to a node; deciding graph vs route vs own-worker; or wondering whether you need a Temporal worker."
owner: derekg1729
created: 2026-06-18
verified: 2026-06-18
tags: [temporal, langgraph, node-template, scheduling, guide]
---

# Building recurring & AI workflows in a node

Temporal is a provisioned substrate ([substrate-temporal.md](../spec/substrate-temporal.md)).
**One shared worker** runs generic workflows and dispatches the work **into your node**.
You almost never run your own worker -- you write a **graph** or a **route**.

## Pick your tier

| You're building...                                                                                               | You write...                                    | Needs a node worker?         |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| **AI work that fits inside one run** (ingest -> reason -> score -> branch)                                       | a **LangGraph graph** in your `graphs/` package | **No** -- schedule it        |
| **plain recurring job** (no AI, e.g. metrics ingest)                                                             | a **route** (`defineScheduledJob`)              | **No**                       |
| **durable multi-step / human-in-the-loop** (state between graph runs, approvals, long waits, cross-crash resume) | a **generic durable step-list engine**          | **No by default** -- roadmap |
| **custom durable orchestration** the generic engine cannot express                                               | a **Temporal workflow** on your **own worker**  | **Yes** -- rare escape hatch |

The first two are the default and the substrate already runs them. Durable composition
between runs is not solved by pretending one graph is the whole answer; it is roadmap work.

## Create schedules from the node app

Node users create recurring work through the node app's schedule surface:

- `POST /api/v1/schedules` with `graphId` starts `GraphRunWorkflow`.
- `POST /api/v1/schedules` with `route` starts `NodeTaskWorkflow`.
- `defineScheduledJob` is the node-author shortcut for plain recurring route work.

The node provides a graph or route. The shared worker runs the generic workflow and
dispatches into the node. Do not add workflow code or a worker service for ordinary
scheduled AI, cron, or route work.

## Default: AI work is a graph

If the work can complete inside one graph run, keep the AI pipeline **inside one LangGraph
graph**. LangGraph handles steps, branching, tools, and loops within that run. Schedule the
graph; the shared worker runs it via `GraphRunWorkflow`, dispatched into your node runtime.
See [langgraph-patterns.md](../spec/langgraph-patterns.md).

```ts
// graphs/ -- your node owns this. "300 workflows" = 300 graphs.
export const growthLoop =
  compileGraph(/* ingest -> analyze (LLM) -> score -> draft (LLM) */);
// then schedule it (cron) -> GraphRunWorkflow runs it.
```

## Default: plain cron is a route

```ts
export const metricsIngest = defineScheduledJob({
  id: "metrics-ingest",
  cron: "*/15 * * * *",
  run: async (ctx) => {
    /* the work, inline -- no node worker, no Temporal workflow code */
  },
});
```

## Roadmap: durable multi-step and HITL

The moment a workflow must carry durable state **between** graph/route steps, or **pause for a
human** across hours or days, a single graph run is the wrong tool. That does **not** require
a worker per node.

The target is **one generic durable workflow engine on the shared worker** that interprets a
node-supplied step list -- `run graph -> await human signal -> run graph -> branch` -- where:

- human waits are generic Temporal mechanics;
- node-specific work still dispatches into the node as graph runs or routes;
- a node defines its HITL workflow as data, not Temporal code.

A **per-node worker** is the last resort for arbitrary custom durable logic the generic engine
cannot express.

## Rules

- Use Temporal Schedules, not cron.
- Schedule lifecycle belongs to app CRUD endpoints.
- Tenancy lives in the schedule/workflow payload. Queue topology is shared-worker
  infrastructure; do not create one worker per node by default.
- AI runs inside graphs/activities, never in workflow code.
- Dispatch is at-most-once for v0; make routes idempotent.

## References

- [substrate-temporal.md](../spec/substrate-temporal.md) -- shared-worker substrate.
- [langgraph-patterns.md](../spec/langgraph-patterns.md) -- graph execution.
- [temporal-patterns.md](../spec/temporal-patterns.md) -- deterministic workflow rules.
