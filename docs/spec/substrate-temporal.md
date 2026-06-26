---
id: spec.substrate-temporal
type: spec
title: Temporal Substrate
status: draft
trust: draft
summary: "Temporal is a Cogni substrate. One shared, operator-run worker executes generic workflows and dispatches work into nodes. Nodes schedule their own routes and graphs; no per-workflow Temporal code and no per-node worker by default."
read_when: "Designing how a node runs recurring, triggered, or durable work; before proposing a per-node worker, pg-boss, cron, or an operator-in-the-loop create API."
owner: derekg1729
created: 2026-06-18
verified: 2026-06-18
tags: [temporal, node-template, substrate, scheduling]
---

# Temporal Substrate

## Model

One shared, operator-run worker executes only **generic** workflows and dispatches the work
**into the node**. A node consumes the substrate by scheduling its own routes and graphs
through those generic workflows.

No per-workflow Temporal code. No per-node worker by default.

## Building block

`/schedules` is the node's recurring-work console. A node schedules any route or graph it owns:

| A node wants to...                    | It schedules...                        | The work runs...          |
| ------------------------------------- | -------------------------------------- | ------------------------- |
| run one HTTP ops route on a cron      | `NodeTaskWorkflow` -> the node's route | in the node route handler |
| run one AI graph on a cron or trigger | `GraphRunWorkflow` -> the node's graph | in the node graph runtime |

The workflow types are fixed and generic. The variety lives in node-owned routes and graphs.
A new node should add zero worker code and trigger no shared-worker redeploy for normal
recurring work.

## As-built

- AI graphs run through `GraphRunWorkflow`; the shared `scheduler-worker` dispatches into the
  node graph runtime.
- `NodeTaskWorkflow` is the route-dispatch sibling: fire a node HTTP route on a schedule.
- `/schedules` and `POST /api/v1/schedules` exist for schedule CRUD.

The substrate exists. The remaining sovereignty delta is node-direct schedule create: the
node app should hold its own Temporal client and namespace-scoped credentials, then create
schedules itself instead of routing create through the operator.

## Create vs execute

1. **Create -- node-direct target.** The node's app holds its own Temporal client and calls
   `schedule.create(...)` for `NodeTaskWorkflow` or `GraphRunWorkflow`.
   Today schedule create may still run through the app/operator-owned adapter path; node-direct
   client credentials are the build target.
2. **Execute -- shared and generic.** The shared worker polls shared workload queues, runs the
   generic workflow, and dispatches into the owning node route or graph. The work runs in the
   node.

The shared worker is substrate plumbing, not node-specific business logic.

## Queue model

Tenancy lives in the workflow payload (`nodeId`, grant, route/graph), not in queue topology.
The target worker pool polls a bounded set of workload queues such as `dispatch` and
`graph-exec`. Current deployments may still poll transitional per-node queues; that is
compatibility, not the architecture target.

## Dispatch hop

The shared worker holds no node code, so it calls the node over HTTP for route dispatch or
graph execution. The route or graph must be idempotent for its own business effects. The v0
retry profile is at-most-once (`maximumAttempts: 1`) until the dedup contract is proven.

## Roadmap: durable multi-step and HITL

The current substrate runs one route or one graph per schedule tick. A graph can contain an
in-run AI pipeline, but that is not the durable multi-step answer for
`run graph -> wait for human -> run graph -> branch` or other cross-run orchestration.

The roadmap shape is one generic durable step-list workflow on the shared worker: Temporal
owns signals, waits, timers, and replay; node-specific work still dispatches into node routes
and graphs.

## Escape hatch: per-node worker

A node runs its own Temporal worker only for custom durable orchestration the generic engine
cannot express. That worker registers node-owned workflow definitions and polls its own queue.
This costs a worker pod per node and is not the node-template default.

## Not this

- per-node worker as the default;
- one queue per node as the default isolation model;
- a second scheduler such as pg-boss or cron;
- an operator-in-the-loop schedule create API as the long-term node contract.

## References

- [temporal-patterns.md](./temporal-patterns.md) -- deterministic workflow and schedule rules.
- [langgraph-patterns.md](./langgraph-patterns.md) -- graph execution boundary.
