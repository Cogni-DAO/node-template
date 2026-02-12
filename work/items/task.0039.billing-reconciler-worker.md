---
id: task.0039
type: task
title: "Billing reconciler — periodic run-level receipt reconciliation in scheduler worker"
status: Todo
priority: 0
estimate: 2
summary: "Add interval-driven billing reconciliation to the scheduler-worker process. Queries for runs missing charge_receipts after a grace period, marks them reconciled or unreconciled, emits alerts. No new container, no synchronous barrier."
outcome: "Runs that complete without charge_receipts are detected within minutes and surfaced via structured log + metric. No silent revenue leakage."
spec_refs: [billing-ingest-spec]
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [billing, reconciliation, scheduler, p0]
external_refs:
---

# task.0039 — Billing reconciler in scheduler worker

## Context

task.0029 replaces synchronous receipt barriers with callback-driven billing via LiteLLM webhook. Gateway mode correlates by `run_id` (not `call_id`). The missing piece: **what happens when a callback never arrives?**

This task adds a periodic reconciliation job to the existing `services/scheduler-worker/` process. It detects runs that completed without receipts and surfaces them as alerts — never blocks the user response.

Related:

- task.0029 — callback-driven billing (the ingest side)
- bug.0037 — gateway proxy zero-cost streaming (the motivating bug)

## Design

### Placement

Module in the existing `services/scheduler-worker/` process. **No new container.** No new hex port unless unavoidable.

### Trigger

Interval job (every 1–5 minutes). Implementation options:

- `setInterval` in `main.ts` alongside the Temporal worker
- Temporal cron schedule dispatching a reconciliation activity

Prefer whichever is simpler given the existing Temporal infrastructure.

### Work Selection

```sql
SELECT id, run_id, graph_id, billing_account_id, completed_at
FROM graph_runs  -- or equivalent run tracking table
WHERE billing_status IN ('COMPLETED_UNRECONCILED', 'RUNNING_STALE')
  AND updated_at < now() - interval '${grace_period_minutes} minutes'
ORDER BY updated_at ASC
LIMIT ${batch_size}
```

### Reconcile Logic

For each selected run:

1. **If** `EXISTS charge_receipts WHERE run_id = ?` → mark `RECONCILED`
2. **Else if** age > `hard_timeout` → mark `RECONCILE_MISSING` + emit alert/metric
3. **Else** → leave pending (will retry next tick)

### Idempotency

Updates guarded by expected current status + `updated_at` or version check. Concurrent ticks are safe — worst case is a no-op retry.

### Backpressure

Process `batch_size` runs per tick, ordered oldest first. No unbounded scans.

### Defaults

| Parameter              | Default |
| ---------------------- | ------- |
| `grace_period_minutes` | 2       |
| `hard_timeout_minutes` | 30      |
| `batch_size`           | 100     |

## Ultra-Lean Constraints

- No new container
- No new port unless unavoidable; keep as a module in scheduler worker
- No synchronous "receipt barrier" in gateway mode
- No attempt to reconstruct per-call costs until gateway stream exposes `call_id` reliably

## Requirements

- Reconciler runs in `services/scheduler-worker/` process
- Uses the worker's existing DB connection (`createServiceDbClient`)
- Structured log on each `RECONCILE_MISSING` detection (Pino JSON → Loki)
- Prometheus counter metric: `billing_reconciliation_missing_total`
- Config via env vars: `RECONCILER_GRACE_MINUTES`, `RECONCILER_HARD_TIMEOUT_MINUTES`, `RECONCILER_BATCH_SIZE`, `RECONCILER_INTERVAL_MS`
- Graceful shutdown: interval cleared in the existing `shutdown()` handler

## Allowed Changes

- `services/scheduler-worker/src/main.ts` — start reconciler alongside Temporal worker
- `services/scheduler-worker/src/reconciler/` — new module directory
- `services/scheduler-worker/src/config.ts` — add reconciler env vars
- `packages/db-client/` — add query for unreconciled runs + status update (if not already exposed)
- `platform/infra/services/runtime/docker-compose*.yml` — add env vars to scheduler-worker service
- `docs/spec/billing-ingest.md` — add reconciliation section

## Plan

- [ ] **1. Schema** — Ensure `graph_runs` (or run-tracking table) has a `billing_status` column with states: `PENDING`, `COMPLETED_UNRECONCILED`, `RECONCILED`, `RECONCILE_MISSING`
- [ ] **2. DB queries** — Add `findUnreconciledRuns()` and `updateBillingStatus()` to `@cogni/db-client`
- [ ] **3. Reconciler module** — `services/scheduler-worker/src/reconciler/billing-reconciler.ts` with the tick logic
- [ ] **4. Wire into main** — Start interval in `main.ts`, clear on shutdown
- [ ] **5. Observability** — Structured log + Prometheus counter for missing receipts
- [ ] **6. Config** — Env vars with defaults, validated in `config.ts`

## Acceptance Criteria

- Reconciler runs in scheduler-worker process (verified by structured log on startup)
- Runs with receipts are marked `RECONCILED` within `grace_period + interval`
- Runs without receipts after `hard_timeout` are marked `RECONCILE_MISSING` with alert log
- No user-facing latency impact (fully async, never in request path)
- Graceful shutdown stops the interval before process exit

## Validation

**Command:**

```bash
pnpm --filter @cogni/scheduler-worker test
```

**Expected:** Unit test for reconciler tick logic (mock DB, assert status transitions). Integration test optional (depends on task.0029 ingest endpoint being available).

## Review Checklist

- [ ] **Work Item:** `task.0039` linked in PR body
- [ ] **Spec:** `billing-ingest.md` updated with reconciliation section
- [ ] **Tests:** Unit test for tick logic covering all 3 branches (reconciled, missing, pending)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0029 (callback-driven billing — provides the ingest side)
- Related: bug.0037 (gateway zero-cost streaming — motivating bug)
- Spec: docs/spec/billing-ingest.md

## Attribution

-
