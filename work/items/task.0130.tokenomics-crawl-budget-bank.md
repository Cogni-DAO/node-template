---
id: task.0130
type: task
title: "Tokenomics Crawl: BudgetBank + kill Score UI"
status: needs_implement
priority: 1
rank: 25
estimate: 3
project: proj.transparent-credit-payouts
branch: fix/workflow-zod
summary: "Replace magic pool_config with BudgetBank (vault_total + accrual + bounded unused-budget buffer). Remove 'Score' column from UI — show 'Credits Earned' only. Add budget_bank_ledger table. Pure functions, no contracts."
outcome: "Epoch pools are finite (hard-capped vault), deterministic (policy function), and unused budget carries forward as a bounded buffer. Users see one number ('credits earned'), not two. No more arbitrary inflation."
assignees: derekg1729
created: 2026-03-02
updated: 2026-03-03
labels: [governance, tokenomics, attribution]
---

# Tokenomics Crawl: BudgetBank + Kill Score UI

> Spec: [tokenomics](../../docs/spec/tokenomics.md) (Crawl section)

## Design

### Outcome

Epoch credit pools have a hard cap and deterministic sizing via BudgetBank policy. Users see one number in the UI.

### Approach

**Solution**: BudgetBank pure functions + repo-spec `budget_policy` + UI cleanup

**Reuses**: Existing `pool.ts` framework, existing `PoolComponentEstimate` type, existing epoch lifecycle

**Implementation notes**:

- Crawl keeps **fixed issuance** semantics. `epoch_pool` stays capped at `accrual_per_epoch`; carry is a bounded unused-budget buffer, not burst issuance.
- Add an append-only `budget_bank_ledger` so bank state is reproducible from ledger entries rather than mutable counters.
- Migration seed inserts one `init` row per scope with `balance_after = 0` and `remaining_after = vault_total - SUM(existing finalized base_issuance credits)`. Pre-BudgetBank epochs do not retroactively accumulate carry.

**Rejected**:

- Token deployment now — premature, adds contract risk before economics are proven
- Admin-settable epoch_pool — undermines determinism and trust
- Halvening now — adds complexity; flat accrual proves the model first

### Invariants

- [ ] BUDGET_HARD_CAP: `SUM(all epoch_pools) ≤ vault_total` (spec: tokenomics)
- [ ] EPOCH_POOL_DETERMINISTIC: policy function, not admin choice (spec: tokenomics)
- [ ] ONE_USER_FACING_UNIT: UI shows credits only, no "score" (spec: tokenomics)
- [ ] BUDGET_BANK_APPEND_ONLY: ledger entries immutable (spec: tokenomics)
- [ ] POOL_REPRODUCIBLE: each component stores algo + inputs + amount (spec: attribution-ledger)
- [ ] ALL_MATH_BIGINT: no floating point (spec: attribution-ledger)

### Files

**New:**

- `packages/attribution-ledger/src/budget-bank.ts` — `BudgetBankState`, `accrue()`, `spend()`, `canSpend()` pure functions
- `src/adapters/server/db/migrations/0020_<slug>.sql` — add `budget_bank_ledger` table `(id, node_id, scope_id, epoch_id, entry_type, amount, balance_after, remaining_after, created_at)` plus append-only trigger and seed/backfill
- `packages/attribution-ledger/tests/budget-bank.test.ts` — unit tests for accrual, spend, carry cap, vault exhaustion, zero-activity epochs

**Modify:**

- `packages/db-schema/src/attribution.ts` — add `budgetBankLedger` table definition
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — add BudgetBank ledger read/write helpers and seed-aware state loading
- `packages/repo-spec/src/schema.ts` — add `budgetPolicySchema` (vault_total, accrual_per_epoch, max_carry_epochs)
- `packages/repo-spec/src/accessors.ts` — add `getBudgetPolicy()` accessor
- `packages/attribution-ledger/src/pool.ts` — add `computeEpochBudget(bankState, policy)` returning `PoolComponentEstimate`
- `.cogni/repo-spec.yaml` — replace `pool_config` with `budget_policy`
- `services/scheduler-worker/src/activities/ledger.ts` — read bank state, compute pool via `computeEpochBudget`
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — switch pool-component orchestration from config constant to BudgetBank-backed estimation
- `src/features/governance/components/EpochDetail.tsx` — remove "Score" column header + `totalScore` computation
- `src/features/governance/components/ContributionRow.tsx` — remove score display

**Test:**

- `packages/attribution-ledger/tests/pool.test.ts` — add `computeEpochBudget` tests
- `services/scheduler-worker/tests/ledger-activities.test.ts` — cover BudgetBank-backed pool component insertion and zero-activity no-spend behavior
- `services/scheduler-worker/tests/allocation-dispatch-architecture.test.ts` — update architectural expectations if the collect flow changes shape

### Migration Notes

1. Existing finalized epochs remain untouched. Their `epoch_pool_components` rows are already canonical.
2. Seed `budget_bank_ledger` with one `init` entry per scope using historical finalized `base_issuance` totals to compute `remaining_after`.
3. Start new BudgetBank accrual from `balance_after = 0`; no retroactive carry is inferred for pre-BudgetBank epochs.
4. New epochs use `budget_policy`; legacy `pool_config.base_issuance_credits` is retired for future epochs only.

## Validation

- [ ] `pnpm check` passes
- [ ] Budget bank unit tests cover: accrual, spend, carry cap, vault exhaustion, zero-activity epoch
- [ ] Migration seed computes `remaining_after` correctly for scopes with existing finalized `base_issuance` rows
- [ ] UI shows "Credits Earned" column, no "Score" column
- [ ] `repo-spec.yaml` uses `budget_policy` instead of `pool_config`
- [ ] Existing finalized epochs are unaffected (backward compat)
