---
id: task.0102
type: task
title: "Allocation computation, epoch auto-close, and FinalizeEpochWorkflow"
status: needs_design
priority: 1
rank: 8
estimate: 3
summary: "Implement computeProposedAllocations (weight policy → epoch_allocations), automatic epoch close-ingestion trigger, and FinalizeEpochWorkflow (payouts + atomic close). Bridges the gap between raw events and payout statements."
outcome: "After each collection run, proposed allocations computed from curated events + weight config. Epochs auto-transition open→review (or open→closed in 2-phase) when period_end+grace passes. FinalizeEpochWorkflow deterministically computes payouts and atomically closes epochs."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0100, task.0101
deploy_verified: false
created: 2026-02-22
updated: 2026-02-22
labels: [governance, ledger, temporal]
external_refs:
---

# Allocation Computation + Epoch Close + Finalize Workflow

## Problem

Three connected gaps prevent the pipeline from producing payouts:

1. **No allocation computation**: Raw events are collected and curated, but `epoch_allocations` is never populated. The pure function `computeProposedAllocations()` is designed (task.0095) but not implemented.
2. **No epoch auto-close**: Epochs are created as `open` and stay open forever. Nothing detects `now > period_end + grace_period` and triggers a transition.
3. **No FinalizeEpochWorkflow**: Designed in task.0095 but deferred. Required to produce payout statements.

## Requirements

### 1. `computeProposedAllocations()` Pure Function

Add to `packages/ledger-core/src/rules.ts`:

```typescript
interface CuratedEventForAllocation {
  eventId: string;
  userId: string; // resolved identity (null events excluded before calling)
  source: string; // "github"
  eventType: string; // "pr_merged", "review_submitted", etc.
  included: boolean;
  weightOverrideMilli: bigint | null;
}

function computeProposedAllocations(
  events: readonly CuratedEventForAllocation[],
  weightConfig: Record<string, number> // "source:eventType" → milli-units
): Array<{ userId: string; proposedUnits: bigint; activityCount: number }>;
```

Logic:

1. Filter to `included === true`
2. For each event: `weight = weightOverrideMilli ?? BigInt(weightConfig[source:eventType] ?? 0)`
3. Group by userId, sum weights → proposedUnits, count → activityCount
4. Return sorted by userId (deterministic)

### 2. `computeAllocations` Activity

New activity in `createLedgerActivities`:

```typescript
computeAllocations(input: {
  epochId: bigint;
  weightConfig: Record<string, number>;
}): Promise<void>
```

Logic:

1. `getCurationForEpoch(epochId)` — get curated events with resolved userId
2. Filter out `userId === null` events (unresolved — IDENTITY_BEST_EFFORT)
3. `computeProposedAllocations(events, weightConfig)` — pure computation
4. `insertAllocations(results)` — upsert into epoch_allocations

### 3. Epoch Auto-Close Mechanism

Two options (choose one during design):

**Option A — CollectEpochWorkflow detects end-of-window:**
After collection + allocation, check `if (now > epoch.periodEnd + gracePeriod)` and call `closeIngestion()` activity. Simple, no new workflow.

**Option B — Separate CloseIngestionWorkflow on Temporal schedule:**
A second schedule (e.g., `LEDGER_CLOSE_CHECK`, daily at period_end + grace) triggers a workflow that finds open epochs past their window and transitions them. More explicit but adds infra.

Recommendation: Option A for V0 (simpler). The CollectEpochWorkflow already runs daily and knows the epoch window.

### 4. FinalizeEpochWorkflow

New workflow in `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts`:

```
Input: { epochId }
Deterministic ID: ledger-finalize-{scopeId}-{epochId}

1. Verify epoch exists and is review/closed (depends on 2-phase or 3-phase status)
2. If already finalized → return existing statement (EPOCH_FINALIZE_IDEMPOTENT)
3. Verify ≥1 base_issuance pool component (POOL_REQUIRES_BASE)
4. Read epoch_allocations — use final_units where set, fall back to proposed_units
5. Read pool components → pool_total_credits = SUM(amount_credits)
6. computePayouts(allocations, pool_total) — BIGINT, largest-remainder
7. computeAllocationSetHash(allocations)
8. Atomic: set pool_total_credits on epoch, update status, insert payout_statement
9. Return statement
```

Single-activity implementation (atomic DB transaction).

### 5. `computeAllocationSetHash()` Pure Function

Add to `packages/ledger-core/src/rules.ts`:

```typescript
function computeAllocationSetHash(
  allocations: readonly FinalizedAllocation[]
): string; // SHA-256 hex of canonical JSON
```

Canonical JSON: sorted by userId, `{ userId, valuationUnits: string }` (bigint as string for JSON).

## Interaction with task.0100

- If task.0100 merges first: epoch status becomes `open → review → finalized`. Auto-close transitions `open → review`, finalize transitions `review → finalized`.
- If this task merges first: use existing 2-phase `open → closed`. task.0100 later adds the `review` intermediate step.
- Either ordering works — the finalize activity checks current status generically.

## Allowed Changes

- `packages/ledger-core/src/rules.ts` (add computeProposedAllocations, computeAllocationSetHash)
- `packages/ledger-core/src/index.ts` (re-export)
- `services/scheduler-worker/src/activities/ledger.ts` (add computeAllocations, finalizeEpoch activities)
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` (add step 5: computeAllocations, add auto-close check)
- `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` (new)
- Tests

## Plan

- [ ] Implement `computeProposedAllocations()` in rules.ts + unit tests
- [ ] Implement `computeAllocationSetHash()` in rules.ts + unit tests
- [ ] Add `computeAllocations` activity to createLedgerActivities
- [ ] Wire computeAllocations into CollectEpochWorkflow (step 5, after curateAndResolve)
- [ ] Add epoch auto-close check to CollectEpochWorkflow (Option A)
- [ ] Implement FinalizeEpochWorkflow + `finalizeEpoch` activity
- [ ] Unit tests: allocation computation with weight overrides, deterministic ordering
- [ ] Unit tests: allocation set hash determinism
- [ ] Stack test: full pipeline collect → allocate → close → finalize → verify payouts

## Validation

```bash
pnpm check
pnpm test -- tests/unit/core/ledger/
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

## Review Checklist

- [ ] **Work Item:** `task.0102` linked in PR body
- [ ] **Spec:** PAYOUT_DETERMINISTIC, POOL_REQUIRES_BASE, EPOCH_CLOSE_IDEMPOTENT, ALL_MATH_BIGINT, IDENTITY_BEST_EFFORT upheld
- [ ] **Tests:** computeProposedAllocations, computeAllocationSetHash unit tested; full pipeline stack tested
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
