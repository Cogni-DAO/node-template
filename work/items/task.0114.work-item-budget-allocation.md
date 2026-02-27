---
id: task.0114
type: task
title: "work-item-budget-v0 allocation algorithm"
status: needs_triage
priority: 1
rank:
estimate: 2
summary: "New allocation algorithm that consumes cogni.work_item_links.v0 artifacts to distribute credit budgets per work item. Each work item gets budget = estimate * priority_multiplier; contributors split that budget by their linked event weights. Unlinked events fall back to flat weights. Replaces weight-sum-v0."
outcome: "Credit allocation is anchored to planned work items with capped budgets. Event-spam on a single work item splits a fixed budget, not an unbounded sum. Priority and estimate from .md frontmatter directly affect payout distribution."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0113]
deploy_verified: false
created: 2026-02-27
updated: 2026-02-27
labels: [governance, ledger, scoring, allocation]
external_refs:
---

# work-item-budget-v0 Allocation Algorithm

## Problem

`weight-sum-v0` assigns flat weights per event type (PR=1000, review=500, issue=300 milli-units) and sums per user. This is gameable: splitting work into many small PRs inflates score. Nothing ties rewards to planned work, estimates, or priorities.

## Design

### Updated Allocation Signature

**File**: `packages/ledger-core/src/allocation.ts`

```typescript
export function computeProposedAllocations(
  algoRef: string,
  events: readonly CuratedEventForAllocation[],
  weightConfig: Record<string, number>,
  artifacts?: ReadonlyMap<string, unknown> // artifact_type → payload
): ProposedAllocation[];
```

Artifacts are an opaque map. Each algorithm picks what it needs. `work-item-budget-v0` reads `cogni.work_item_links.v0`.

### Algorithm: `work-item-budget-v0`

1. Parse `cogni.work_item_links.v0` artifact from `artifacts` map
2. Build lookups: `eventId → workItemId[]`, `workItemId → budgetMilli`
3. **Linked events** (budget > 0): for each work item, compute V0 event weights for all linked events, distribute the work item's fixed `budgetMilli` proportionally among users. Largest-remainder rounding within each work item (sum === budget exactly).
4. **Unlinked events**: apply V0 flat weights directly (fallback)
5. Sum per user, sort by userId, return `ProposedAllocation[]`

**Key property**: adding more PRs to the same work item splits a fixed budget. Event-spam is capped per work item.

**All math is BIGINT.** Deterministic: same events + same artifacts → identical output.

**Unit semantics**: `proposedUnits` are **milli-units** — same unit as `budgetMilli` and `weightOverrideMilli`. Both linked (budget-split) and unlinked (flat-weight) paths produce milli-units, so they're additive. `computePayouts()` treats them as proportional weights: `payout = (userUnits / totalUnits) * poolTotalCredits`.

**Known limitation (v0)**: Unlinked events produce uncapped flat-weight sums identical to `weight-sum-v0`. If most events are unlinked, the algorithm degrades to the old behavior. Acceptable for v0 — the `unlinkedEventIds` array in the artifact enables monitoring the unlinked ratio.

### Config

- `deriveAllocationAlgoRef("cogni-v0.1")` → `"work-item-budget-v0"`
- Update `.cogni/repo-spec.yaml`: `credit_estimate_algo: cogni-v0.1`

### Updated `computeAllocations` Activity

**File**: `services/scheduler-worker/src/activities/ledger.ts`

- Load `status='final'` (or `status='draft'` for UI) artifacts from `epoch_artifacts`
- Parse `cogni.work_item_links.v0` payload
- Pass to `computeProposedAllocations()` alongside events + weightConfig

## Scope

- [ ] Add `work-item-budget-v0` algorithm to `allocation.ts`
- [ ] Update `computeProposedAllocations` signature to accept `artifacts` map
- [ ] Add `deriveAllocationAlgoRef("cogni-v0.1")` mapping
- [ ] Update `computeAllocations` activity to load and pass artifacts
- [ ] Update `.cogni/repo-spec.yaml` to `cogni-v0.1`
- [ ] Update workflow to pass artifacts through to allocation
- [ ] Unit tests: determinism, budget caps, largest-remainder rounding per work item, mixed linked/unlinked, multi-user work item splits
- [ ] Stack test: full pipeline — collect → enrich → allocate → payout with budget-based scoring

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test
```

- [ ] Budget per work item = estimate \* priority_multiplier (from pinned artifact)
- [ ] Sum of all user shares within one work item === work item budget exactly
- [ ] Unlinked events contribute V0 flat weights (fallback path works)
- [ ] Same inputs + same artifacts → identical output (determinism)
- [ ] Adding more events to a work item splits budget, does not increase total
- [ ] `proposedUnits` are milli-units (same unit as `budgetMilli` and flat weights)
- [ ] Linked + unlinked contributions are additive (same unit)
- [ ] Unlinked event ratio is observable from artifact's `unlinkedEventIds`
