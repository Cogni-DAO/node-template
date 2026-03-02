---
id: proj.financial-ledger
type: project
primary_charter:
title: "Financial Ledger — Beancount Treasury + MerkleDistributor Settlement"
state: Active
priority: 1
estimate: 5
summary: "All money I/O in one place. Beancount as canonical double-entry ledger. Attribution statements → Merkle claim trees → on-chain user claims via MerkleDistributor. Operator Port for treasury signing. Attribution is governance truth; distribution is financial truth."
outcome: "Every dollar in and every dollar out has a Beancount journal entry. Finalized attribution statements produce Merkle trees published on-chain. Users claim their share with inclusion proofs. Treasury balances auditable via bean-check + on-chain reconciliation."
assignees: derekg1729
created: 2026-02-28
updated: 2026-03-02
labels: [governance, payments, web3, treasury]
---

# Financial Ledger — Beancount Treasury + MerkleDistributor Settlement

> Spec: [financial-ledger](../../docs/spec/financial-ledger.md)
> Ingestion: [data-ingestion-pipelines](../../docs/spec/data-ingestion-pipelines.md)

## Goal

Build the money side of the DAO. The Attribution Ledger answers "who did what and how much credit?" — this project answers "where did the money go?"

**Key accounting separation:** A signed attribution statement is a governance commitment (who earned what share), NOT a financial event. Financial events occur only when funds move on-chain:

1. **Epoch signed** — optional accrual entry (Dr Expense:ContributorRewards / Cr Liability:UnclaimedRewards). No money moves.
2. **Treasury funds distributor** — real financial event (Dr Liability:UnclaimedRewards / Cr Assets:Treasury:USDC). Operator Port executes.
3. **User claims on-chain** — liability reduction via MerkleDistributor claim.

Beancount is the canonical ledger. Postgres stores operational state. Rotki enriches crypto tx history and tax lots but is NOT the canonical ledger.

## Supersedes

**proj.dao-dividends** (Superseded) — Splits-based push distribution replaced by MerkleDistributor user-initiated claims.

## Roadmap

### Crawl (P0) — Beancount Journal + MerkleDistributor + First Settlement

**Goal:** Stand up the Beancount-based treasury. Deploy MerkleDistributor contract (Uniswap pattern). Wire the first settlement path: finalized attribution statement → Merkle tree computation → root publication → user claims.

| Deliverable                                                                                                                            | Status      | Est | Work Item         |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------------- |
| Beancount accounts hierarchy + initial journal structure                                                                               | Not Started | 1   | (create at start) |
| Journal generation: Temporal workflow reads finalized statement → produces Beancount entries → validates with `bean-check`             | Not Started | 2   | (create at start) |
| MerkleDistributor contract deployment on Base (Uniswap pattern, battle-tested)                                                         | Not Started | 2   | (create at start) |
| `computeMerkleTree(statement)` pure function — takes finalized allocation → returns Merkle root + proofs per claimant                  | Not Started | 2   | (create at start) |
| Settlement port interface (`SettlementStore`) — publish Merkle root, record funding tx, track claims                                   | Not Started | 2   | (create at start) |
| Operator Port integration for treasury signing (fund distributor, publish root)                                                        | Not Started | 2   | (create at start) |
| V0 settlement policy: 100% cash via MerkleDistributor                                                                                  | Not Started | 1   | (create at start) |
| On-chain receipt adapter: USDC inbound payments → Beancount journal entries                                                            | Not Started | 2   | (create at start) |
| Temporal workflow: `SettleEpochWorkflow` — reads finalized statement, computes Merkle tree, funds distributor, records Beancount entry | Not Started | 2   | (create at start) |

### Walk (P1) — Co-op Multi-Instrument Settlement + Member Accounts

**Goal:** Settlement splits across three instruments per co-op patronage model. Member capital accounts as Beancount sub-accounts. Reserve fund as Beancount account. Governance controls the split policy.

| Deliverable                                                                                           | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Settlement policy schema: `{ cash_pct, retained_equity_pct, reserve_pct }` in repo-spec               | Not Started | 1   | (create at P1 start) |
| Member capital sub-accounts in Beancount: `Liability:MemberEquity:{userId}`                           | Not Started | 2   | (create at P1 start) |
| Reserve fund Beancount account: `Equity:Reserves:Collective`                                          | Not Started | 1   | (create at P1 start) |
| Multi-instrument `computeSettlement()` — splits each user's share across cash/equity/reserve          | Not Started | 2   | (create at P1 start) |
| Settlement execution for retained equity — Beancount journal entry (no on-chain tx)                   | Not Started | 2   | (create at P1 start) |
| Governance snapshot pinning at settlement: `ledger_code_ref`, `manifest_hash`, settlement policy hash | Not Started | 2   | (create at P1 start) |
| Treasury read API: member balance, reserve balance, settlement history (queries Beancount)            | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Git-Canonical Bundles, Federation, Equity Redemption

**Goal:** Finalized statements and settlements become git-canonical artifacts. Fork-inheritable credit history. Member equity redemption. Federation royalty pool.

| Deliverable                                                                                         | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Git-canonical `bundle.v1.json` — finalized statement + settlement + hash chain (`prev_bundle_hash`) | Not Started | 3   | (create at P2 start) |
| Bundle commit bot: PR flow, Postgres becomes index keyed by `(bundle_hash, commit_sha)`             | Not Started | 2   | (create at P2 start) |
| Equity redemption workflow — convert retained equity to MerkleDistributor cash claim                | Not Started | 2   | (create at P2 start) |
| Federation `upstreams[]` — reference upstream bundles for fork-inheritable credit                   | Not Started | 2   | (create at P2 start) |
| Foundation royalty pool component — enrolled nodes auto-insert upstream royalty into pool           | Not Started | 2   | (create at P2 start) |
| Portable identity mapping — wallet addresses as cross-fork recipient identifiers                    | Not Started | 2   | (create at P2 start) |
| On-chain Merkle root anchoring for settlement bundles                                               | Not Started | 2   | (create at P2 start) |

## Constraints

- Financial Ledger does NOT redefine attribution semantics — it consumes finalized `AttributionStatement` as input
- Attribution finalization is NOT a financial event — it is a governance commitment (liability, not transfer)
- Beancount is the canonical financial ledger; Postgres stores operational state
- Rotki for crypto tx enrichment/tax lots only — NOT the canonical ledger
- All monetary math uses BIGINT (inherits `ALL_MATH_BIGINT` from attribution-ledger spec)
- MerkleDistributor (Uniswap pattern) for on-chain claims — user-initiated, not push distribution
- No custom smart contracts — use battle-tested MerkleDistributor
- Operator Port required for treasury signing — not a custodial wallet, not raw private keys
- Co-op semantics: retained equity is par-value member capital, NOT speculative governance tokens
- Reserve fund is collective/unallocated — not claimable per member on exit
- Settlement policy is governance-controlled, stored in repo-spec (same pattern as `ledger.approvers`)
- Temporal workflow IDs and config keys: use `treasury-*` namespace (separate from `ledger-collect-*`)

## Dependencies

- [x] proj.transparent-credit-payouts P0 — finalized attribution statements exist
- [ ] Operator Port operational (signing + policy boundary for treasury actions)
- [ ] MerkleDistributor contract deployed on Base
- [ ] Beancount tooling integrated (journal generation + `bean-check` validation)

## As-Built Specs

- [financial-ledger](../../docs/spec/financial-ledger.md) — treasury accounting invariants, accounts hierarchy
- [data-ingestion-pipelines](../../docs/spec/data-ingestion-pipelines.md) — shared event archive, Singer taps
- [attribution-ledger](../../docs/spec/attribution-ledger.md) — ingestion spine, receipt schema, cursor model
- [billing-evolution](../../docs/spec/billing-evolution.md) — credit unit standard, charge receipts (current as-built)
- [cred-licensing-policy](../../docs/spec/cred-licensing-policy.md) — federation enrollment model (P2 dependency)

## Design Notes

### Shared event archive, N domain pipelines

```
LAYER 0 — EVENT ARCHIVE (shared, domain-agnostic)
├── ingestion_receipts  (append-only raw facts, NO domain tag)
├── ingestion_cursors   (adapter sync state)
├── Source adapters     (Singer taps + V0 TS adapters, coexisting)
├── Deterministic IDs   (e.g., github:pr:owner/repo:42)
└── Provenance          (producer, producerVersion, payloadHash)

LAYER 1 — DOMAIN PIPELINES (each selects independently from Layer 0)
├── Attribution:  select → evaluate → allocate → statement (governance truth)
├── Treasury:     classify → journal entry → settlement → reconciliation (financial truth)
├── Knowledge:    extract → link → version (future)
└── ???:          whatever the AI-run DAO needs next
```

### Co-op settlement model

An attribution statement says: "User A earned 40%, User B earned 35%, User C earned 25% of a 10,000 credit pool."

Settlement policy (governance-controlled) says: `{ cash_pct: 60, retained_equity_pct: 30, reserve_pct: 10 }`

Settlement produces:

- **Cash now**: 60% of each user's share → claimable from MerkleDistributor contract (user-initiated claim with inclusion proof)
- **Retained equity**: 30% of each user's share → credited to member capital account in Beancount (redeemable later)
- **Reserve fund**: 10% of pool → collective reserve Beancount account (not per-member)

This matches co-op patronage norms: partial cash distribution, partial retained patronage (allocated equity redeemable at face value on a revolving schedule), and collective reserves for stability.

### What is NOT a governance token

Retained equity is NOT a speculative asset. It's a par-value capital credit — you contributed $X of value, the co-op owes you $X, redeemable when the revolving fund schedule allows. No market, no trading, no volatility. This is the clean co-op model.

### OSS reference implementations

- **Uniswap MerkleDistributor** — battle-tested claim contract. Our on-chain settlement primitive.
- **Beancount** — double-entry accounting language + `bean-check` validation. Our canonical ledger.
- **Rotki** — crypto bookkeeping/tax assistant. Enrichment + validation, not canonical.
- **Open Collective** — transaction pairing/grouping, expense→approval→payout flows. Reference for the posting/settlement layer.
- **SourceCred** — `data/ledger.json` in-repo pattern. Reference for P2 git-canonical bundles.

### What V0 explicitly defers

- Multi-instrument settlement (P1 — V0 is 100% cash)
- Retained equity / member capital accounts (P1)
- Reserve fund accounting (P1)
- Governance snapshot pinning (P1)
- Git-canonical finalized bundles (P2)
- Fork-inheritable credit history (P2)
- Federation royalty pool components (P2)
- Equity redemption schedules (P2)
- On-chain Merkle anchoring (P2)
- Voting thresholds / multisig quorum for settlement approval (P2)

## PR / Links

- Handoff: [handoff](../handoffs/proj.financial-ledger.handoff.md)
