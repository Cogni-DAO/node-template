---
id: tokenomics-spec
type: spec
title: "Tokenomics: Budget Policy + Settlement Handoff"
status: draft
spec_state: proposed
trust: draft
summary: "Tokenomics contract for BudgetBank economics and settlement-layer handoff. Defines hard-capped issuance, deterministic epoch pools, one user-facing unit, and how finalized credits hand off to future token settlement."
read_when: Understanding credit economics, pool sizing, emission schedules, or settlement design.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-03-02
verified: 2026-03-03
tags: [governance, tokenomics, attribution]
---

# Tokenomics: Budget Policy + Settlement Handoff

> The attribution pipeline answers "who did what." This spec answers "how much is the pool, where does it come from, and what do the numbers mean to the user."

## Goal

Replace arbitrary, inflationary credit issuance with principled tokenomics:

1. **One user-facing unit** — kill the score/credits split
2. **Hard-capped supply** — finite pool, no infinite minting
3. **Deterministic epoch pools** — policy function, not admin discretion
4. **Carry-over buffer** — quiet weeks bank unused budget; later epochs draw from that bank without exceeding `accrual_per_epoch`
5. **Separation of concerns** — attribution (governance truth) vs. settlement (financial truth) vs. governance (voting power)

## Non-Goals

- Deploying smart contracts (Crawl phase is off-chain only)
- Token trading, liquidity pools, or price discovery
- Multi-token architecture in Crawl
- Changing the attribution pipeline math (weights, enrichers, allocators stay as-is)

## Problems with Status Quo

| Problem                     | Evidence                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Infinite inflation**      | `base_issuance_credits: "10000"` mints 10K every epoch forever. No cap.                                   |
| **Two meaningless numbers** | UI shows "Score" (`units/1000`) AND "Credits" (`proportional share × pool`). Neither has intrinsic value. |
| **Magic pool size**         | `estimatePoolComponentsV0()` returns config value unchanged. `algorithmVersion: "config-constant-v0"`.    |
| **No scarcity signal**      | Credits accumulate without bound. No reason to value them.                                                |
| **Admin discretion risk**   | If admin could set `epoch_pool` arbitrarily, trust breaks.                                                |

## Invariants

| Rule                        | Constraint                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUDGET_HARD_CAP             | `SUM(all epoch_pools ever) ≤ vault_total`. Enforced by BudgetBank balance check.                                                                                                                        |
| EPOCH_POOL_DETERMINISTIC    | `epoch_pool = min(accrued_this_period, bank_balance)`. Policy function, not admin choice. Admin can reduce (exclude receipts, zero-weight), never inflate above policy.                                 |
| ONE_USER_FACING_UNIT        | Users see one number in one denomination. Internal milli-units are never displayed.                                                                                                                     |
| BUDGET_BANK_APPEND_ONLY     | Bank accrual and spend are append-only ledger entries. No retroactive edits.                                                                                                                            |
| SETTLEMENT_DECOUPLED        | Attribution statements are governance commitments. Settlement (how entitlements become claims) is a separate, pluggable layer.                                                                          |
| GOVERNANCE_REWARD_PLUGGABLE | The attribution pipeline outputs `creditAmount`. Whether credits settle into the same governance token or separate instruments is a settlement-layer decision. Attribution remains instrument-agnostic. |

## Design

---

### Crawl — Fix the Economics (Off-Chain, No Token)

**Ship first. No contracts. No token. Just correct the math and the UI.**

#### C1. Kill "Score" — One Number, One Name

| Before                                    | After                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| UI: "Score" column = `units/1000`         | **Gone.**                                                        |
| UI: "Credits" = proportional share × pool | **"Credits Earned"** — the only number shown.                    |
| `creditAmount` in DB                      | Unchanged — still BIGINT, still the output of allocation math.   |
| `units` / `finalUnits` in DB              | Unchanged — still internal pipeline state. Never shown to users. |

The UI shows: **"You earned 3,420 credits this epoch (34.2% of pool)"**

"Credits" remain the unit. They are off-chain ledger entries — signed governance commitments. What they're _worth_ is a settlement concern (Walk phase).

**Files changed:**

- `src/features/governance/components/EpochDetail.tsx` — remove "Score" column, keep "Share" + "Credits Earned"
- `src/features/governance/components/ContributionRow.tsx` — remove score display, show weight as tooltip only

#### C2. BudgetBank — Finite Supply + Carry-Over

Replace the magic `base_issuance_credits: "10000"` with a vault + accrual model.

```
┌─────────────────────────────────────────────────────────────┐
│  BudgetBank (per scope)                                     │
│                                                             │
│  vault_total:  520,000 credits  (hard cap, set once)        │
│  remaining:    520,000          (decremented per epoch)      │
│                                                             │
│  accrual_per_epoch:  10,000     (credits added to bank)     │
│  max_carry:          40,000     (4 epochs of accrual)        │
│  bank_balance:       10,000     (spendable this moment)     │
│                                                             │
│  epoch_pool = min(accrual_per_epoch, bank_balance)          │
│            = min(10000, 10000) = 10,000                     │
│                                                             │
│  After epoch: bank_balance -= epoch_pool                    │
│               remaining    -= epoch_pool                    │
│               bank_balance += accrual_per_epoch (next)      │
│               bank_balance  = min(bank, max_carry)          │
│                                                             │
│  When remaining = 0 → no more credits. Ever.                │
└─────────────────────────────────────────────────────────────┘
```

**Key behaviors:**

- **Normal week**: bank accrues 10K, epoch spends 10K. Net = 0 carry.
- **Quiet week** (no activity): epoch_pool = 0 (no receipts → nothing to distribute). Bank accrues to 20K.
- **Big week after quiet**: epoch_pool = min(10K, 20K) = 10K. Bank drains to 10K. Steady state restores.
- **Max carry hit**: bank capped at 40K. Excess accrual lost (use it or lose it beyond 4 weeks).
- **Vault exhausted**: remaining = 0. No more credits issued. Period. (Governance can vote to extend — that's a new vault, not an edit.)

Carry is a **buffer**, not a catch-up multiplier. Quiet weeks preserve runway; they do not increase the next epoch's issuance above `accrual_per_epoch`.

**Why `epoch_pool` is NOT admin-settable:**
The admin controls _what activity counts_ (include/exclude receipts, weight overrides, identity resolution). The admin does NOT control _how big the pool is_. The pool is a policy function of the BudgetBank state. This prevents inflation attacks while preserving admin curation of attribution quality.

#### C3. repo-spec.yaml Changes (Crawl)

```yaml
activity_ledger:
  epoch_length_days: 7
  approvers: ["0x..."]
  budget_policy:
    vault_total: "520000" # hard cap (credits, not tokens yet)
    accrual_per_epoch: "10000" # credits added to bank each epoch
    max_carry_epochs: 4 # bank caps at 4× accrual
  activity_sources:
    github:
      attribution_pipeline: cogni-v0.0
      source_refs: ["cogni-dao/cogni-template"]
      streams: ["pull_requests", "reviews", "issues"]
```

`pool_config.base_issuance_credits` is **replaced** by `budget_policy`. Migration: existing epochs keep their stored `pool_components`; new epochs use BudgetBank.

#### C4. Code Changes (Crawl)

| File                                             | Change                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/repo-spec/src/schema.ts`               | Add `budgetPolicySchema`. Deprecate `poolConfigSpecSchema`.                                                                                   |
| `packages/repo-spec/src/accessors.ts`            | Add `getBudgetPolicy()` accessor.                                                                                                             |
| `packages/attribution-ledger/src/pool.ts`        | Add `computeEpochBudget(bankState, policy)` pure function. Keep `estimatePoolComponentsV0` for backward compat.                               |
| `packages/attribution-ledger/src/budget-bank.ts` | **New.** `BudgetBankState` type, `accrue()`, `spend()`, `canSpend()` pure functions.                                                          |
| DB migration                                     | Add `budget_bank_ledger` table: `(node_id, scope_id, epoch_id, entry_type, amount, balance_after, remaining_after, created_at)`. Append-only. |
| `services/scheduler-worker/`                     | `CollectEpochWorkflow` reads bank state, computes epoch_pool via policy, records pool component.                                              |

#### C5. Budget Bank State Machine

```
                    ┌──────────────┐
     epoch start ──►│    ACCRUE     │──► bank += accrual_per_epoch
                    │              │    bank = min(bank, max_carry)
                    └──────┬───────┘    remaining -= 0 (no spend yet)
                           │
                           ▼
                    ┌──────────────┐
     close epoch ──►│    SPEND      │──► if included receipts exist:
                    │              │      epoch_pool = min(accrual, bank)
                    └──────┬───────┘      bank -= epoch_pool
                                           remaining -= epoch_pool
                                         else:
                                           epoch_pool = 0
                                           bank unchanged
                           │
                           ▼
                    ┌──────────────┐
     finalize    ──►│   FINALIZED   │──► pool_total locked on statement
                    └──────────────┘    (existing POOL_REPRODUCIBLE invariant)
```

If `remaining = 0`, ACCRUE is a no-op and `epoch_pool = 0`. Epoch still runs (activity is recorded for transparency) but no credits are distributed.

---

### Walk + Run — Settlement Handoff Contracts

> **These phases are design inputs for [proj.financial-ledger](../../work/projects/proj.financial-ledger.md).** This spec defines the economics and handoff constraints only; the settlement roadmap lives in the project.

Credits distributed by the attribution pipeline represent **equity ownership / governance stake** — not cash compensation. The MVP settlement path is single-token:

```
Attribution credits (off-chain)
  → Aragon GovernanceERC20 claims (on-chain)
  → Voting power + ownership claim
```

**Settlement contracts:**

- The settlement token is the Aragon `GovernanceERC20` created at node formation.
- Node formation must move from founder bootstrap minting to a fixed-supply mint into a DAO-controlled emissions holder.
- BudgetBank remains the off-chain release policy. It governs how much of the fixed token supply becomes claimable each epoch.
- Merkle settlement consumes signed `creditAmount` entitlements from the finalized statement, not internal `finalUnits`.
- USDC distributions remain a separate, governance-voted financial action.

#### Edge Cases

| Edge Case               | Resolution                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `total_points = 0`      | Epoch pool remains in bank. No statement produced. SPEND does not fire for epochs with no included receipts or zero total weight.                                                      |
| Unresolved claimants    | Already handled by `IdentityClaimant` type. Claimant key is stable (`identity:github:12345`). Statement finalization can proceed, but on-chain settlement waits for wallet resolution. |
| Address changes         | Wallet binding layer (existing `user_bindings`). Statement references `claimantKey`, not wallet address. Claim address resolved at settlement time.                                    |
| Forked scopes           | Each scope has its own BudgetBank. Fork = new scope = new vault. No cross-contamination.                                                                                               |
| Root rotation authority | Walk: operator multisig calls `setEpochRoot`. Run: TimelockController gates it.                                                                                                        |
| Unclaimed tokens        | `sweep(epochId)` after claim window → treasury. Swept amounts are NOT re-emitted.                                                                                                      |

## Token Lifecycle — Creation to Claim

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        TOKEN LIFECYCLE                                    │
│                                                                          │
│  1. CREATE            2. HOLD               3. RELEASE    4. CLAIM       │
│  ─────────            ──────                ─────────     ─────────      │
│                                                                          │
│  DAOFactory           EmissionsHolder       BudgetBank    Merkle proof   │
│  .createDao()         (DAO-owned)           policy        + claim()      │
│       │                    │                    │              │          │
│       ▼                    ▼                    ▼              ▼          │
│  ┌─────────┐        ┌───────────┐        ┌──────────┐   ┌──────────┐    │
│  │ Aragon  │  mint  │ Emissions │ release│  Merkle  │   │  User's  │    │
│  │ Gov     │───────►│ Holder    │───────►│Distributor│──►│  Wallet  │    │
│  │ ERC20   │  fixed │ (vault)   │per epoch│          │   │          │    │
│  └─────────┘ supply └───────────┘        └──────────┘   └──────────┘    │
│                           │                                   │          │
│                    totalSupply -              token = voting   │          │
│                    SUM(released)              power + equity   │          │
│                                                               │          │
│                                              unclaimed after  │          │
│                                              window ──► sweep │          │
│                                              back to treasury │          │
└──────────────────────────────────────────────────────────────────────────┘
```

**One token, three roles:** governance voting, ownership stake, contributor reward. No separate reward token. Reuses the Aragon `GovernanceERC20` from [node formation](./node-formation.md).

### Per-Epoch Settlement Flow

```
Finalized AttributionStatement (off-chain, signed)
  │
  ├─► computeMerkleTree(statement.creditAmounts)
  │     → root + per-claimant proofs
  │
  ├─► Operator: transfer epoch_pool tokens
  │     EmissionsHolder → MerkleDistributor
  │
  ├─► Operator: setEpochRoot(epochId, root, totalAmount)
  │
  └─► Contributors: claim(epochId, index, account, amount, proof)
        → GovernanceERC20 transferred to wallet
        → (epochId, index) marked claimed
```

### Key Facts

| Question                     | Answer                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| What token?                  | Aragon `GovernanceERC20` (minted at DAO creation, no new contract)                     |
| Who holds unreleased supply? | DAO-controlled emissions holder (replaces current founder-gets-all mint)               |
| How much released per epoch? | `epoch_pool` from BudgetBank policy (see C2). Never exceeds `accrual_per_epoch`        |
| Credit:token mapping?        | V0: 1 credit = 1 token unit (18 decimals). Governance can change ratio                 |
| What do tokens give you?     | Voting power + ownership stake. NOT automatic cash                                     |
| USDC payouts?                | Separate governance vote. Not automated. See [financial-ledger](./financial-ledger.md) |
| Unclaimed tokens?            | `sweep()` after claim window → treasury. NOT re-emitted                                |
| Vault exhausted?             | No more tokens. Governance can vote to extend (new action, not an edit)                |

### Open Design Decisions

| Decision              | Options                                     | Status    |
| --------------------- | ------------------------------------------- | --------- |
| Total token supply    | Governance decision (e.g., 1M, 10M)         | Undecided |
| Emissions holder type | Safe multisig or dedicated vault contract   | Undecided |
| Distributor model     | Per-epoch or reusable multi-epoch           | Undecided |
| Claim window          | 90 days? 180 days? Governance-configurable? | Undecided |

## OSS Building Blocks

| Need                | OSS                                                  | Status                           |
| ------------------- | ---------------------------------------------------- | -------------------------------- |
| Governance token    | Aragon GovernanceERC20 (from node formation)         | Walk                             |
| Merkle claims       | Uniswap MerkleDistributor (extended for multi-epoch) | Walk                             |
| Governance          | OpenZeppelin Governor + TimelockController           | Run                              |
| Streaming (alt)     | Sablier Lockup / Superfluid                          | Run (optional)                   |
| Double-entry ledger | Beancount                                            | Walk (via proj.financial-ledger) |

## What Does NOT Change

- Epoch lifecycle (open → review → finalized)
- Weight config per event type
- Allocation algorithms (weight-sum-v0, future versions)
- EIP-712 signing flow
- Plugin system (enrichers, allocators)
- Claimant model (user vs identity)
- All 79 attribution-ledger invariants
- BIGINT math, largest-remainder rounding
- Determinism guarantees
