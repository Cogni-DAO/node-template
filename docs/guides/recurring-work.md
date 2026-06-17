# Recurring work (scheduled tasks)

Declare recurring work — metrics ingest, resolve loops, periodic syncs — in your
node's `.cogni/repo-spec.yaml`. The operator reconciles each entry into a Temporal
Schedule and runs it **on your behalf, under your node's own identity**. You write
**zero Temporal code**.

> **The operator is the _trigger_, never the executor of your request path.** Scheduled
> work runs against *your* node's routes/graphs with *your* node's grant. The managed
> Temporal substrate is a hosted convenience — a sovereign node can later swap in its
> own Temporal + worker behind this same contract (the schedule declaration doesn't change).

## Declare it

```yaml
# .cogni/repo-spec.yaml
schedules:
  - id: metrics-ingest # stable id → workflowId/scheduleId; rename = new schedule
    cron: "*/15 * * * *" # standard 5-field cron
    timezone: UTC # IANA tz, defaults to UTC
    route: /api/internal/ops/metrics-ingest # http-dispatch: a route on YOUR node
    payload: { window: "15m" } # opaque to the operator; your route owns its meaning

  - id: nightly-rollup
    cron: "0 3 * * *"
    graph: my-rollup-graph # graph: run one of your graphs instead of a route
    payload: { scope: "all" }
```

**Each entry is `route` XOR `graph`** — exactly one:

- **`route`** → **http-dispatch**: the operator POSTs your node-relative route on a
  schedule. Use this for non-graph work (ingest, resolve, sync, cache warm).
- **`graph`** → **graph run**: the operator runs one of your graphs on a schedule.

`overlap` and `catchupWindow` are **operator-fixed** (overlap=skip, no backfill) — not
node-tunable, so a slow run never stacks on itself.

## The http-dispatch contract (read this if you use `route`)

When your `route` fires, the operator sends:

```
POST https://<your-node-host><route>
Authorization: Bearer <your node's own dispatch credential>
Idempotency-Key: <nodeId>/<scheduleId>/<scheduledFor>
Content-Type: application/json

<your payload>
```

- **Your route MUST dedup on `Idempotency-Key`.** Deliveries are at-least-once; a key
  your handler ignores is not idempotent. Treat the same key as the same run.
- **`route` is relative to your own host.** Absolute or foreign URLs are rejected at
  parse time (SSRF / cross-tenant guard) — you can only dispatch to yourself.
- The call authenticates as **your node's tenant principal** under a per-node execution
  grant scoped to exactly this `route`. It cannot touch another node.
- The route should be **token-gated, internal, and side-effecting-but-idempotent**
  (e.g. `/api/internal/ops/*`).

## What you do NOT do

- No Temporal SDK, no worker, no schedule CRUD — the operator owns all of that
  (`SYSTEM_OPS_ONLY`). You declare; the operator reconciles.
- Don't run recurring side-effects from a cron in your own container — declare a
  schedule so it's observable, idempotent, and runs under your grant.

## Lifecycle

- **Add/change**: edit `schedules` in your repo-spec; the operator reconciles on your
  next provision/flight (create / update-on-drift / pause-on-removal).
- **Remove**: delete the entry → the operator pauses it (reversible), never silently drops it.

## Availability

Requires an operator + `@cogni/repo-spec` that ships the `schedules` block (operator
story.5008). If `pnpm` reports `schedules` as an unknown key, your node's `@cogni/repo-spec`
predates it — bump to the version that includes node schedules. See the operator design
SoT: `docs/design/node-temporal-tenant-interface.md` and the `infrastructure` knowledge hub.
