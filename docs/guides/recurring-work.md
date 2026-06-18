# Recurring work (scheduled tasks)

Run recurring work — metrics ingest, resolve loops, periodic syncs — by creating a
**schedule** that targets one of your node's routes (or a graph). The operator
reconciles it into a Temporal Schedule and runs it on cadence, **under your node's
own identity**. You write **zero Temporal code**, no cron, no boot hook.

> **One path.** Everything goes through `POST /api/v1/schedules` (the `/schedules`
> page). `route` → `NodeTaskWorkflow` (an HTTP dispatch to your route); `graphId` →
> `GraphRunWorkflow` (a graph run). Same converged substrate — there is no second way.

## 1. Build your work as a token-gated route

Expose the work as an internal route on your node, e.g. `POST /api/internal/ops/metrics-ingest`:

- accepts `Authorization: Bearer ${SCHEDULER_API_TOKEN}` (the operator dispatches with it);
- is **idempotent** — it MUST dedup on the `Idempotency-Key` header
  (`<nodeId>/<scheduleId>/<scheduledFor>`); delivery is at-least-once;
- returns `200` and logs an event (so you can read it back in Loki).

(Or skip the route and target a graph by `graphId` instead.)

## 2. Create the schedule

`POST /api/v1/schedules` (or the `/schedules` UI) — `route` **XOR** `graphId`:

```jsonc
// http-dispatch (a route on your node)
{ "route": "/api/internal/ops/metrics-ingest", "input": { "window": "15m" }, "cron": "*/15 * * * *", "timezone": "UTC" }

// graph run
{ "graphId": "langgraph:my-rollup", "input": { "scope": "all" }, "cron": "0 3 * * *", "timezone": "UTC" }
```

That's it — it runs on cadence under your node's identity. `route` is **node-relative**
(must start with `/`, no scheme / `//` / `..` — SSRF / cross-tenant guard).

## What you own vs what the operator owns

| concern | owner |
| --- | --- |
| schedule lifecycle, Temporal, the execution grant, overlap/catchup | operator (you write none of it) |
| the work itself + idempotency on `Idempotency-Key` | your route |

## Lifecycle

- **Change cadence / payload:** update the schedule (same API) — it reconciles.
- **Stop it:** delete the schedule — it pauses, reversibly.

## Proven

Live on candidate-a: a `route` schedule created via `POST /api/v1/schedules` fired and
dispatched to the node's route, idempotency-keyed `nodeId/scheduleId/scheduledFor`, read
back in Loki (operator story.5008). See the operator `infrastructure` knowledge hub:
*"How a node builds its first scheduled feature"* + *"NodeTask schedule dispatch proven live on candidate-a"*.
