---
id: bug.0419
type: bug
title: "Polymarket V2 cutover — Enable Trading targets V1 USDC.e exchanges; V2 spends pUSD via CollateralOnramp.wrap"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: 'PR #1118''s `@polymarket/clob-client-v2` swap fixes order placement at the wire (orders now sign against the V2 exchange contracts `0xE111180000…` / `0xe2222d27…`), but `privy-poly-trader-wallet.adapter.ts:140-145` still hardcodes the V1 exchange addresses (`0x4bFb…982E` / `0xC5d5…f80a`) as the `setApprovalForAll` + `approve` targets. Existing tenants who ran Enable Trading approved the V1 exchanges to spend their USDC.e + move their CTF positions; CLOB now matches against V2 exchanges, sees zero allowance, and rejects every order with `"the balance is not enough"` (CLOB conflates balance and allowance in this message). Symptom on candidate-a: Derek''s tenant wallet `0x9A9e…160A` has real USDC balance but every BUY rejects with `error_code=insufficient_balance, balance: 0`.'
outcome: "After this PR, every code path that sets or checks Polymarket approvals targets the V2 exchange addresses ONLY. V1 addresses are purged from the codebase — no fallbacks, no dual-grant, no backwards compat. A DB migration nulls every existing `trading_approvals_ready_at` stamp so all tenants re-run Enable Trading against the V2 contracts on next interaction. Validation on candidate-a: Derek's tenant re-runs Enable Trading, the on-chain `approve(V2_EXCHANGE, MaxUint256)` + `setApprovalForAll(V2_EXCHANGE, true)` succeed, and a subsequent mirror BUY logs `event=poly.clob.place phase=ok status=matched filled_size_usdc>0` with a real `order_id`."
spec_refs:
  - poly-trader-wallet-port
  - poly-copy-trade-phase1
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-clob-sell-fak-dust
created: 2026-04-28
updated: 2026-04-28
deploy_verified: false
labels: [poly, polymarket, clob, v2-migration, approvals, p0]
external_refs:
  - work/items/bug.0405.poly-clob-sell-fak-generates-dust.md
  - work/items/bug.0418.poly-clob-order-version-mismatch.md
  - work/items/task.0355.poly-trading-wallet-enable-trading.md
---

# bug.0419 — Complete the V2 cutover: purge V1 approval addresses

## Why this exists

[bug.0418](bug.0418.poly-clob-order-version-mismatch.md) (fixed in PR #1118 via `@polymarket/clob-client-v2` swap) flipped the **order envelope** to V2. It did not flip the **approval target addresses** — those are hardcoded in our adapter and must match the contract that CLOB now uses to settle.

State today on candidate-a (PR #1118 SHA `c415d36`):

```
20:06 (pre-rollout):  reason="order_version_mismatch"           ← envelope V1, CLOB V2 → reject
20:11 (post-rollout): reason="not enough balance / allowance"   ← envelope V2, allowance V1 → reject
```

Same wallet, same balance, real USDC on chain. The error class shifted from envelope-mismatch (which we fixed) to allowance-against-the-wrong-contract (which this bug fixes).

## V2 = new collateral token + new wrap step (correction from earlier draft)

V2 is more than an exchange-address swap. The trade currency itself changed:

- **Old (V1):** orders spent USDC.e (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`).
- **New (V2):** orders spend **pUSD** (`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`). USDC.e is bridged in via a new `CollateralOnramp` contract (`0x93070a847efEf7F70739046A929D47a521F5B8ee`) which exposes `wrap(amount)` to convert USDC.e → pUSD on-chain 1:1.

The original `ContractConfig.collateral` field on `clob-client-v2`'s exported config is now pUSD (verified in the SDK's `MATIC_CONTRACTS`). The `CollateralOnramp` address is NOT in the SDK config — it must be hardcoded.

V1 is fully deprecated; no compat needed. Single user (Derek) on candidate-a / preview / production — no bulk DB migration needed; he'll re-run Enable Trading once per env.

## Enable Trading ceremony — V2 (8 steps)

| #   | Action                                  | Token                 | Spender / Operator                    |
| --- | --------------------------------------- | --------------------- | ------------------------------------- |
| 1   | `USDC.e.approve(spender, MaxUint256)`   | USDC.e                | CollateralOnramp                      |
| 2   | `CollateralOnramp.wrap(usdcEBalance)`   | (n/a — moves balance) | —                                     |
| 3   | `pUSD.approve(spender, MaxUint256)`     | pUSD                  | V2 CTF Exchange                       |
| 4   | `pUSD.approve(spender, MaxUint256)`     | pUSD                  | V2 NegRisk Exchange                   |
| 5   | `pUSD.approve(spender, MaxUint256)`     | pUSD                  | NegRisk Adapter (belt-and-suspenders) |
| 6   | `CTF.setApprovalForAll(operator, true)` | CTF                   | V2 CTF Exchange                       |
| 7   | `CTF.setApprovalForAll(operator, true)` | CTF                   | V2 NegRisk Exchange                   |
| 8   | `CTF.setApprovalForAll(operator, true)` | CTF                   | NegRisk Adapter                       |

Step 2 is the new beast — a stateful balance-moving call (not idempotent). For v0 single-user, simplest is: read live USDC.e balance, wrap all of it. If balance is 0 (already wrapped), step is `satisfied`. Subsequent runs wrap whatever remains.

## Concrete code

**Adapter** (`nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`):

- Constants: derive `EXCHANGE_POLYMARKET = exchangeV2`, `NEG_RISK_EXCHANGE_POLYMARKET = negRiskExchangeV2`, `PUSD_POLYGON = collateral`, `CTF_POLYGON = conditionalTokens`, `NEG_RISK_ADAPTER_POLYMARKET = negRiskAdapter` from `clob-client-v2.getContractConfig(137)`. Hardcode `COLLATERAL_ONRAMP_POLYGON = 0x93070a847efEf7F70739046A929D47a521F5B8ee` (not in SDK config).
- Replace `USDC_E_SPENDERS` (3 V1 entries) → `[{Onramp}]` (1 entry — only Onramp needs to spend USDC.e).
- New `PUSD_SPENDERS = [V2_Exchange, V2_NegRiskExchange, NegRiskAdapter]` (3 entries — these spend pUSD on BUYs).
- Replace `CTF_OPERATORS` to V2 + adapter (3 entries).
- New private method `submitCollateralWrap(publicClient, walletClient, signing, billingAccountId, amountUsdcE)`.
- Rewrite `ensureTradingApprovals` ceremony for the 8-step sequence. Idempotent: each step checks live state and skips when satisfied.

**Port** (`packages/poly-wallet/src/port/poly-trader-wallet.port.ts`): add `"collateral_wrap"` to `TradingApprovalStepKind`.

**Contract** (`packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts`): mirror the enum change.

**Wallet overview** (read path): switch USDC balance read source from USDC.e → pUSD (post-wrap, USDC.e balance is 0). Affects `wallet-analysis-service.ts` and the dashboard's `TradingWalletCard`.

**Experiment script** (`scripts/experiments/approve-polymarket-allowances.ts`): same V1→V2 swap + add wrap step. The operator wallet runs this once at deploy time per env.

**Migration**: SKIPPED. Single user manually re-runs Enable Trading.

## Out of scope

- "Stale" tag UX work (downstream symptom; resolves on its own once approvals re-run).
- Multi-user re-approval flow / banner.
- Splitting wrap into "amount picker" UI — wrap-all is fine for v0.
- pUSD label changes throughout the codebase ("today_spent_usdc" etc.) — math is 1:1 unchanged; cosmetic-only.

## Out of scope

- Changing the `trading_approvals_ready_at` semantic — it remains the single readiness signal.
- New UI — the existing "Enable Trading" button in `TradingWalletPanel.tsx` already works; it just calls the route which calls the adapter which now signs V2-target approvals.
- Dual-grant / fallback / V1-compat path — explicitly purged per the directive: "no lingering legacy/backwards compat."
- The "stale" tag on the trading wallet card (`TradingWalletCard.tsx:124`) — that's a downstream symptom of `data.warnings.length > 0` from the wallet overview endpoint, which itself fires when V1 approvals can't be resolved. The tag will silence on its own once tenants re-run Enable Trading against V2.

## Validation

**exercise:** On candidate-a after this lands:

1. `POST /api/v1/poly/wallet/enable-trading` (or click the dashboard "Enable Trading" button) for tenant `0x9A9e…160A`. Expect 200 + `ready: true`.
2. Observe the on-chain txs: 3 USDC.e `approve` (Exchange-V2 + NegRiskExchange-V2 + NegRiskAdapter) + 3 CTF `setApprovalForAll(true)` for the same three operators.
3. Wait for next mirror BUY signal (or place agent trade). Expect `event=poly.clob.place phase=ok status=matched filled_size_usdc>0` in Loki at the deployed SHA.

**observability:**

```logql
# Should drop to zero post-fix
{env="candidate-a",service="app"} | json
  | error_code="insufficient_balance"
  | reason=~".*balance is not enough.*"

# Should appear post-fix — first real successful placement
{env="candidate-a",service="app"} | json
  | event="poly.clob.place"
  | phase="ok"

# Re-approval activity from this fix
{env="candidate-a",service="app"} | json
  | event=~"poly.wallet.enable_trading.*"
```
