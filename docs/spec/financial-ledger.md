---
id: financial-ledger-spec
type: spec
title: "Financial Ledger: Double-Entry Treasury with On-Chain Settlement"
status: draft
spec_state: draft
trust: draft
summary: "Double-entry financial ledger using Beancount as source of truth. MerkleDistributor (Uniswap pattern) for on-chain claim settlement. Operator Port for treasury signing actions. Attribution statements are governance commitments — financial events occur only when funds move on-chain."
read_when: Working on treasury accounting, on-chain distributions, settlement workflows, Beancount integration, MerkleDistributor claims, or the Operator Port.
implements: proj.financial-ledger
owner: derekg1729
created: 2026-03-02
verified:
tags: [governance, payments, web3, treasury]
---

# Financial Ledger: Double-Entry Treasury with On-Chain Settlement

## Goal

All money I/O in one place. Inbound USDC → treasury postings. Attribution statements → MerkleDistributor claim trees. Users claim on-chain with inclusion proofs. Beancount is the canonical ledger; Postgres stores operational state. Rotki enriches crypto transaction history and tax lots but is NOT the canonical ledger.

## Core Invariants

| Rule                      | Constraint                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BEANCOUNT_CANONICAL       | Beancount journal files are the source-of-truth financial ledger. All monetary state is reproducible from the journal.                                                                                                                  |
| ATTRIBUTION_NOT_FINANCIAL | A signed attribution statement is a governance commitment (who earned what share), NOT a financial event. No money moves at epoch finalization.                                                                                         |
| FUNDING_IS_FINANCIAL      | Treasury → MerkleDistributor contract funding IS a financial event. Entry: Dr Liability:UnclaimedRewards / Cr Assets:Treasury:USDC.                                                                                                     |
| CLAIM_IS_FINANCIAL        | User on-chain claim from the distributor IS a financial event (liability reduction).                                                                                                                                                    |
| ROTKI_ENRICHMENT_ONLY     | Rotki for crypto transaction enrichment and tax lot validation. NOT the canonical ledger.                                                                                                                                               |
| MERKLE_CLAIMS             | MerkleDistributor (Uniswap pattern, Base mainnet) for on-chain distribution. User-initiated claims with inclusion proofs. Not Splits push distribution.                                                                                 |
| OPERATOR_PORT_REQUIRED    | Treasury actions (fund distributor, rotate Merkle roots, contract management, batch operations) require an Operator Port — a signing + policy boundary with rate limits, approvals, allowlists, and audit logs. NOT a custodial wallet. |
| ALL_MATH_BIGINT           | No floating point in monetary calculations. Inherited from attribution-ledger.                                                                                                                                                          |

## Accounts Hierarchy (Beancount)

```
Assets:Treasury:USDC              ; DAO treasury wallet
Assets:Distributor:USDC           ; Funds locked in MerkleDistributor contract
Liability:UnclaimedRewards        ; Committed but unclaimed distributions
Expense:ContributorRewards        ; Recognized contributor compensation
Income:ServiceRevenue             ; Inbound payments for AI services
Income:x402Settlements            ; x402 per-request settlement revenue
```

## Three Financial Events

1. **Epoch signed (optional accrual)**: Dr Expense:ContributorRewards / Cr Liability:UnclaimedRewards. Only if running accrual accounting. No money moves.
2. **Treasury funds distributor**: Dr Liability:UnclaimedRewards / Cr Assets:Treasury:USDC. Money moves on-chain via Operator Port.
3. **User claims on-chain**: Liability reduction (if tracked per-claim), or no-op if full liability moved at funding time.

## Design

Stub — to be fleshed out when implementation begins. See [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) for the project roadmap.

## Non-Goals

- Custom smart contracts (use battle-tested MerkleDistributor)
- Speculative token economics (co-op patronage, not governance tokens)
- Postgres as financial ledger (Postgres is operational state; Beancount is canonical)
- Raw private key env vars (Operator Port uses keystore/Vault/CDP, never raw keys)

## Related

- [Attribution Ledger](./attribution-ledger.md) — governance truth (who earned what)
- [Billing Evolution](./billing-evolution.md) — current credit system (as-built)
- [x402 E2E](./x402-e2e.md) — per-request settlement (forward path)
- [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) — project roadmap
