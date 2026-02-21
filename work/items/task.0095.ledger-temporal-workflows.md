---
id: task.0095
type: task
title: "Ledger Temporal workflows (collect + finalize) + weekly cron"
status: needs_design
priority: 1
rank: 4
estimate: 2
summary: "Implement 2 Temporal workflows (CollectEpochWorkflow, FinalizeEpochWorkflow) + activity functions. Register weekly Temporal Schedule for automated collection."
outcome: "Weekly epoch collection runs automatically. Admin triggers finalize. Payouts computed deterministically."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
revision: 0
blocked_by: task.0094, task.0097
deploy_verified: false
created: 2026-02-20
updated: 2026-02-21
labels: [governance, ledger, temporal]
external_refs:
---

# Ledger Temporal Workflows

## Requirements

- 2 workflows in `services/scheduler-worker/src/workflows/`:
  - `collect-epoch.workflow.ts`:
    1. Create or find epoch for target time window (EPOCH_WINDOW_UNIQUE)
    2. Check no other epoch open for different window (ONE_OPEN_EPOCH)
    3. For each registered source adapter:
       - Activity: load cursor from `source_cursors`
       - Activity: `adapter.collect({ streams, cursor, window })` → events
       - Activity: insert `activity_events` (idempotent by PK)
       - Activity: save cursor to `source_cursors`
    4. Activity: resolve identities via `user_bindings` lookup
    5. Activity: compute proposed allocations from events + weight_config → insert `epoch_allocations`
  - `finalize-epoch.workflow.ts`:
    1. Verify epoch exists and is open
    2. If already closed, return existing statement (EPOCH_CLOSE_IDEMPOTENT)
    3. Verify POOL_REQUIRES_BASE (at least one `base_issuance`)
    4. Read `epoch_allocations` — use `final_units` where set, fall back to `proposed_units`
    5. Read pool components → `pool_total_credits = SUM(amount_credits)`
    6. `computePayouts(allocations, pool_total)` — BIGINT, largest-remainder
    7. Compute `allocation_set_hash`
    8. Atomic: set `pool_total_credits`, close epoch, insert `payout_statement`

- Deterministic workflow IDs:
  - `ledger-collect-{periodStart}-{periodEnd}` (ISO date strings)
  - `ledger-finalize-{epochId}`

- Activity functions in `services/scheduler-worker/src/activities/ledger.ts` following `createActivities(deps)` pattern

- Activities import pure domain logic from `@cogni/ledger-core` and DB operations from `@cogni/db-client` (`DrizzleLedgerWorkerAdapter`)

- Register a Temporal Schedule for weekly collection (configurable interval)

- Register workflows + activities in the scheduler-worker's Temporal worker

## Allowed Changes

- `services/scheduler-worker/src/workflows/` (2 new workflow files)
- `services/scheduler-worker/src/activities/ledger.ts` (new)
- `services/scheduler-worker/src/activities/index.ts` (add ledger activities)
- `services/scheduler-worker/src/worker.ts` (register workflows)

## Plan

- [ ] Create activity functions in `services/scheduler-worker/src/activities/ledger.ts` with DI injection
- [ ] Implement `CollectEpochWorkflow` — create epoch, run adapters, resolve identities, compute allocations
- [ ] Implement `FinalizeEpochWorkflow` — read allocations + pool, compute payouts, atomic close
- [ ] Register Temporal Schedule for weekly collection
- [ ] Register all workflows in worker startup
- [ ] Add ledger activities to the `createActivities` barrel

## Validation

**Command:**

```bash
pnpm check
pnpm --filter scheduler-worker build
```

**Expected:** Types pass, worker builds successfully. Full pipeline tested in task.0096 stack tests.

## Review Checklist

- [ ] **Work Item:** `task.0095` linked in PR body
- [ ] **Spec:** WRITES_VIA_TEMPORAL, EPOCH_CLOSE_IDEMPOTENT, POOL_REQUIRES_BASE, PAYOUT_DETERMINISTIC, CURSOR_STATE_PERSISTED, ACTIVITY_IDEMPOTENT
- [ ] **Tests:** workflow logic validated via stack tests in task.0096
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
