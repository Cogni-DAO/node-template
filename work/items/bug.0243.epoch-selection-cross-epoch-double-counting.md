---
id: bug.0243
type: bug
title: "Epoch selection has no cross-epoch deduplication — same receipts selected for multiple epochs"
status: needs_triage
priority: 0
rank: 10
estimate: 3
summary: "getSelectionCandidates() LEFT JOINs epoch_selection scoped only to the current epochId, so every receipt without a selection row for THIS epoch is returned — including receipts already selected by a prior epoch. The selection policy receives no epoch context and cannot deduplicate. Result: identical events appear in both epoch 1 and epoch 2 attribution tables."
outcome: "Each receipt is selected for at most one epoch. Subsequent epochs never re-select receipts that were already included/excluded by a finalized (or open) prior epoch."
spec_refs: [plugin-attribution-pipeline]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-03-31
labels: [attribution, correctness, idempotency, critical]
external_refs:
---

# Epoch selection has no cross-epoch deduplication — same receipts selected for multiple epochs

## Requirements

### Observed

The attribution dashboard shows identical events in both epoch 1 and epoch 2. All 13 contributions from epoch 1 reappear in epoch 2 with the same scores.

**Root cause:** `getSelectionCandidates()` at `packages/db-client/src/adapters/drizzle-attribution.adapter.ts:1772-1804` uses a LEFT JOIN scoped only to the **current** `epochId`:

```sql
LEFT JOIN epoch_selection
  ON (epoch_selection.epoch_id = :currentEpochId
      AND epoch_selection.receipt_id = ingestion_receipts.receipt_id)
WHERE epoch_selection.id IS NULL   -- no row for THIS epoch
   OR epoch_selection.user_id IS NULL  -- unresolved for THIS epoch
```

This means a receipt selected for epoch 1 (`epoch_id=1`) has **no** selection row for epoch 2 (`epoch_id=2`), so the query returns it as a candidate again.

**Contributing factors:**

1. **No cross-epoch exclusion in the query** — the `UNIQUE(epochId, receiptId)` constraint on `epoch_selection` (`packages/db-schema/src/attribution.ts:169`) is per-epoch, explicitly allowing the same receipt in multiple epochs.

2. **Selection policy receives no epoch context** — `SelectionContext` (`packages/attribution-pipeline-contracts/src/selection.ts:32-37`) only has `receiptsToSelect` and `allReceipts`, with no epoch period boundaries or prior-epoch selection data. The policy cannot deduplicate.

3. **Design intent vs. reality** — the schema docstring `SELECTION_POLICY_AUTHORITY` (line 20) states "the selection policy decides epoch membership, not the query." But the policy has no information to make that decision across epochs.

4. **`materializeSelection()`** at `services/scheduler-worker/src/activities/ledger.ts:590-609` passes the unfiltered candidates straight to the selection policy, which processes them identically each time.

### Expected

Each receipt should be selected for **at most one epoch**. When epoch 2 runs `materializeSelection()`, receipts already claimed by epoch 1 should not appear as candidates.

### Reproduction

1. Run the collect-epoch workflow for epoch 1 — receipts R1..R13 are ingested and selected
2. Wait for epoch 2 window to open
3. Run the collect-epoch workflow for epoch 2 — `getSelectionCandidates(nodeId, epoch2Id)` returns R1..R13 again (plus any new receipts)
4. Selection policy includes them again — duplicate attribution

Alternatively, inspect the `epoch_selection` table:

```sql
SELECT receipt_id, COUNT(DISTINCT epoch_id)
FROM epoch_selection
GROUP BY receipt_id
HAVING COUNT(DISTINCT epoch_id) > 1;
```

This will return rows (it should return zero).

### Impact

- **Data integrity:** Credits are double-counted across epochs. The same PR/review earns attribution in multiple periods.
- **Financial:** If epochs are finalized, the same work is paid twice via the DAO treasury.
- **Trust:** Contributors see duplicated entries, undermining confidence in the attribution system.
- **Severity:** Critical (P0) — affects all nodes running multi-epoch attribution.

## Allowed Changes

- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — `getSelectionCandidates()` query
- `packages/attribution-ledger/src/store.ts` — interface docstrings/signatures if needed
- `packages/attribution-pipeline-contracts/src/selection.ts` — `SelectionContext` if epoch context is needed
- `packages/db-schema/src/attribution.ts` — add cross-epoch unique constraint if needed
- `services/scheduler-worker/src/activities/ledger.ts` — `materializeSelection()` if filtering logic moves here
- Tests for the above

## Plan

Two possible fix strategies (decide during implementation):

### Option A: Query-level exclusion (recommended — simplest)

- [ ] Modify `getSelectionCandidates()` to LEFT JOIN against **all** `epoch_selection` rows (not just the current epoch), excluding receipts that already have a selection row in ANY other epoch
- [ ] Update the store interface docstring to reflect the new cross-epoch exclusion behavior
- [ ] Add a test: create two epochs, select receipts for epoch 1, verify epoch 2 candidates exclude epoch-1 receipts

### Option B: Pass epoch context to selection policy

- [ ] Add `epochPeriodStart`/`epochPeriodEnd` to `SelectionContext`
- [ ] Add `priorSelections` (receipt IDs already claimed) to the context
- [ ] Update selection policies to filter out prior-epoch receipts
- [ ] This is more complex but preserves the "policy decides" design philosophy

### Either way

- [ ] Write a migration or data-fix script to clean up duplicate selections in existing epochs
- [ ] Add a DB-level constraint or check to prevent future duplicates

## Validation

**Command:**

```bash
pnpm vitest run --config vitest.config.mts packages/db-client/src/adapters/__tests__/drizzle-attribution-selection.test.ts
```

**Expected:** New test "cross-epoch deduplication" passes — epoch 2 candidates do not include epoch-1 selected receipts.

**Manual verification:**

```sql
SELECT receipt_id, COUNT(DISTINCT epoch_id)
FROM epoch_selection
GROUP BY receipt_id
HAVING COUNT(DISTINCT epoch_id) > 1;
```

**Expected:** Zero rows returned.

## Review Checklist

- [ ] **Work Item:** `bug.0243` linked in PR body
- [ ] **Spec:** SELECTION_POLICY_AUTHORITY invariant upheld or explicitly updated
- [ ] **Tests:** new/updated tests cover cross-epoch deduplication
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
