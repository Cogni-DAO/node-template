---
id: bug.0345
type: bug
title: "Polymarket neg-risk SELL close fails unless CTF setApprovalForAll also covers the Neg-Risk Adapter"
status: needs_implement
priority: 1
rank: 6
estimate: 2
branch: feat/poly-exit-path-dashboard
pr: https://github.com/Cogni-DAO/node-template/pull/999
deploy_verified: false
created: 2026-04-23
updated: 2026-04-23
summary: "Our current trading-readiness model is wrong for neg-risk exits. The app, specs, and onboarding flow still assume 3× USDC.e approvals + 2× CTF operator approvals are sufficient. Live validation against the funded prototype wallet proved that a real neg-risk position can be opened successfully, but close fails with `spender: 0xd91E80... allowance: 0` until the CTF contract also grants `setApprovalForAll(true)` to the Neg-Risk Adapter. This is a multi-tenant provisioning bug, not a one-off user account issue."
outcome: "Enable Trading / readiness / docs / tests all treat Polymarket onboarding as 6 required approvals: 3× USDC.e `approve(MaxUint256)` and 3× CTF `setApprovalForAll(true)` including the Neg-Risk Adapter. A newly provisioned tenant wallet can open and then close a neg-risk position without manual intervention."
spec_refs:
  - poly-trader-wallet-port
  - poly-position-exit
assignees: []
project: proj.poly-copy-trading
labels: [poly, polymarket, wallet, approvals, neg-risk, exit, multi-tenant, bug]
external_refs:
  - work/items/task.0355.poly-trading-wallet-enable-trading.md
  - work/items/task.0357.poly-position-exit-authoritative-close-redeem.md
---

# bug.0345 — Neg-risk SELL close needs CTF approval for the adapter too

> Surfaced during PR #999 live validation on 2026-04-23. This bug was not inferred from stale logs alone; it was reproduced hands-on by opening and then closing a real position with the funded prototype wallet.

## Symptom

User close on a live neg-risk position fails with the repeating Polymarket rejection:

- `PolymarketClobAdapter.placeOrder: CLOB rejected order`
- `error_code=insufficient_balance`
- `reason="not enough balance / allowance: the allowance is not enough -> spender: 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296, allowance: 0"`

The same failure appears:

- in candidate-a / `poly-test` on the app route
- in direct wallet-level use of `sellPositionAtMarket(...)` against the same CLOB

So this is not a session-routing bug and not a single-user DB bug.

## Live Validation Performed

Hands-on validation run on 2026-04-23 using the funded prototype wallet `0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB`:

1. Confirmed Polymarket account + collateral balance/allowance via `scripts/experiments/probe-polymarket-account.ts`.
2. Confirmed full BUY-side readiness and existing SELL readiness checks with `scripts/experiments/approve-polymarket-allowances.ts`.
3. Resolved the live Avalanche market:
   - event: `2026-nhl-stanley-cup-champion`
   - market: `will-the-colorado-avalanche-win-the-2026-nhl-stanley-cup`
   - YES token: `101738487887518832481587379955535423775326921556438741919099866785354159699479`
4. Placed a real BUY:
   - order id: `0x6433219186dbb84882452cb523c8d18ab2f09e9c9e2841652cb203bda1acaa27`
   - status: `filled`
   - filled size: `1.49322` USDC
5. Attempted to close the real position with `PolymarketClobAdapter.sellPositionAtMarket(...)`.
6. Reproduced the exact failure:
   - neg-risk adapter spender `0xd91E80...`
   - allowance reported as `0`
7. Queried Polymarket `getBalanceAllowance({ asset_type: CONDITIONAL, token_id })` directly.
   Result:
   - `Exchange`: approved
   - `Neg-Risk Exchange`: approved
   - `Neg-Risk Adapter`: `0`
8. Queried the CTF contract on-chain with `isApprovedForAll(owner, operator)`.
   Result:
   - `Exchange`: `true`
   - `Neg-Risk Exchange`: `true`
   - `Neg-Risk Adapter`: `false`
9. Manually submitted:
   - `CTF.setApprovalForAll(0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296, true)`
   - tx: `0x78a0f6f572e0ca90cea7a4ebc35b478629bc40109edde4795685673a0bfa1d16`
10. Re-queried Polymarket conditional balance/allowance.
    Result:
    - adapter allowance now non-zero / max
11. Re-ran the exact same close.
    Result:
    - order id: `0xec013069d7ec33a742d188628d65d5450a48b1e65d2d82d087e9bbcbc1632caf`
    - status: `filled`
    - filled size: `2.7328` USDC
12. Re-checked the position after a short delay.
    Result:
    - position gone (`null`)
    - conditional balance/allowance shows token balance `0`

## Root Cause

Our onboarding/readiness model encodes the wrong approval set:

- current model: `3× USDC.e approve + 2× CTF setApprovalForAll`
- actual required model for neg-risk exit: `3× USDC.e approve + 3× CTF setApprovalForAll`

The missing third CTF operator is:

- `Neg-Risk Adapter` — `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`

This means:

- BUY can work
- standard readiness can report `true`
- but neg-risk SELL close still fails permanently

That is why users saw the same message over and over.

## Why this matters for multi-tenant wallets

This is not an operator-wallet-only quirk. It is a provisioning bug that affects every newly connected tenant wallet:

- wallet connect succeeds
- funding succeeds
- enable-trading can claim success under the old 5-approval model
- first neg-risk close strands the user behind an avoidable approval gap

The fix belongs in the productized multi-tenant onboarding path, not in an experiment script or one-off recovery flow.

## Immediate Fix

- Expand the required CTF operator set in `ensureTradingApprovals(...)` to include the Neg-Risk Adapter.
- Treat `trading_approvals_ready_at` as valid only after all 6 approvals are satisfied.
- Update the Money-page / Enable-Trading UX and contract copy from 5 approval steps to 6.

## Proper Fix

- Make the pinned readiness matrix the single source of truth across:
  - port docs
  - adapter constants
  - route contracts
  - UI copy
  - provisioning guide
  - tests
- Add an explicit regression test proving that a neg-risk position can be:
  - opened
  - then closed
  - with no manual approval step after Enable Trading

## Validation

- **exercise:** provision or use a funded tenant wallet, run Enable Trading, open a tiny position on any active neg-risk market, then close it through the app. Expect no manual post-onboarding approval step and no `allowance: 0` error for `0xd91E80...`.
- **observability:** deployed SHA shows successful `poly.wallet.enable_trading.*` covering 6 approval targets and a later `poly.clob.place` SELL with no rejection for the neg-risk adapter spender.
