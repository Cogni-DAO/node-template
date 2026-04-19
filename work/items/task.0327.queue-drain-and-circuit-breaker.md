---
id: task.0327
type: task
title: "Drain legacy Temporal queue + add HTTP circuit breaker on scheduler-worker"
status: needs_design
priority: 3
rank: 7
estimate: 2
summary: "Two follow-ups to task.0280 phase 2 (per-node queue isolation): (1) migrate any remaining Temporal Schedules off the legacy `scheduler-tasks` drain queue and stop polling it; (2) wrap the HTTP adapter calls with a per-node circuit breaker (opossum) so a flapping node fails fast and frees Temporal retry budget instead of burning concurrency on doomed calls."
outcome: "Worker polls only per-node queues (`scheduler-tasks-<uuid>`). No user or governance schedule remains on the legacy queue. HTTP adapter opens a per-node circuit after N consecutive failures, half-opens on a timer, closes on success; Temporal sees fast nonRetryable failures instead of exhausting retry attempts."
spec_refs:
  - docs/spec/multi-node-tenancy.md
  - docs/spec/scheduler.md
assignees: []
credit:
project: proj.unified-graph-launch
initiative:
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0280
deploy_verified: false
related:
  - bug.0322
  - task.0280
created: 2026-04-19
updated: 2026-04-19
labels:
  - multi-node
  - scheduler
  - reliability
external_refs:
---

# Drain legacy queue + HTTP circuit breaker

## Part A — drain legacy `scheduler-tasks` queue

task.0280 phase 2 introduced per-node task queues but kept a Worker polling the legacy `scheduler-tasks` queue as a drain for any Temporal Schedules that had not yet been rewritten. Governance schedules rewrite on next `syncGovernanceSchedules` run; user schedules rewrite on next update. Both eventually migrate, but "eventually" is not a plan.

### Work

1. One-shot migration script (`scripts/ops/migrate-temporal-schedules-taskqueue.ts`):
   - Iterate every Temporal Schedule in the namespace.
   - If its Action is `StartWorkflow` with `taskQueue === "scheduler-tasks"`, derive the owning `nodeId` from the workflow args (payload.nodeId) and update the Schedule action to `scheduler-tasks-${nodeId}`.
   - Emit a per-schedule log line (id, old queue, new queue, nodeId).
   - Dry-run flag + confirmation prompt.
2. Run in staging → check no Schedule remains on the legacy queue → run in prod.
3. After a cool-down week with zero activity on `scheduler-tasks`:
   - Remove the legacy queue from `queues` set in `services/scheduler-worker/src/worker.ts`.
   - Keep `env.TEMPORAL_TASK_QUEUE` as the base prefix (its only remaining role).

### Acceptance

- `temporal workflow list --task-queue scheduler-tasks` returns nothing for 7 consecutive days in prod.
- Worker log on boot shows only per-node queues (no "legacy drain" entry).

## Part B — HTTP adapter circuit breaker

### Motivation

With per-node queue isolation, a flapping poly node's queue grows but its Worker still pulls tasks and burns concurrency on doomed HTTP calls — each one waits for a full HTTP timeout before failing. Temporal retries add another layer. We can fail fast at the adapter level.

### Work

1. Add `opossum` (or equivalent) to `services/scheduler-worker/package.json`.
2. Wrap `fetch` calls in `src/adapters/run-http.ts` with a per-node `CircuitBreaker` keyed on `nodeId`.
3. Config:
   - `errorThresholdPercentage: 50`, `rollingCountWindow: 60_000ms`, `rollingCountBuckets: 10`
   - `resetTimeout: 30_000ms`
   - `timeout: 5_000ms` (matches current implicit timeout expectations)
4. When the breaker is open: throw `RunHttpClientError(message, 0, retryable=false)` so the activity translator emits `ApplicationFailure.nonRetryable`. Temporal marks the workflow as failed fast; operator/resy traffic is unaffected (per-node queues).
5. Emit Prometheus gauge `scheduler_worker_circuit_state{node_id}` with values 0 (closed), 1 (half-open), 2 (open).
6. Unit tests: simulate N consecutive 5xx, assert breaker opens; wait through reset timeout, assert half-open probes.

### Acceptance

- Induce a 5xx-spammer on a canary node; verify:
  - The breaker opens within one rolling window.
  - Other nodes' chat continues unaffected.
  - Activities for the bad node fast-fail with nonRetryable, so Temporal doesn't burn its retry budget.
  - Grafana shows `scheduler_worker_circuit_state` transitioning correctly.

## Out of scope

- Worker concurrency tuning (`maxConcurrentActivityTaskExecutions` per Worker) — separate tune-up, measure first.
- Ledger DATABASE_URL rename — task.0326.
- Bearer aud/nodeId claim — future bug.

## Validation

- Part A: `temporal workflow list --task-queue scheduler-tasks` empty for 7 days in prod.
- Part B: induce 5xx on a canary node; assert breaker opens within one rolling window and other nodes continue serving.
