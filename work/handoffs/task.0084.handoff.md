---
id: task.0084.handoff
type: handoff
work_item_id: task.0084
status: active
created: 2026-02-18
updated: 2026-02-18
branch: docs/did
last_commit: 4a0684b5
---

# Handoff: Operator Wallet Generation + Wiring

## Context

- **Goal:** Close the financial loop — every user credit purchase automatically provisions OpenRouter credits and forwards the DAO's margin to treasury. No manual transfers.
- **Simplified design:** No custom smart contracts. The operator wallet is a plain EOA that receives user USDC payments (replaces DAO wallet as `receiving_address`). The app controls the wallet and handles outbound routing.
- **This task (0084)** is PR 1 of 3: generate the wallet, define the `WalletSignerPort`, wire into existing payment flow. PRs 2-3 (task.0085, task.0086) implement the outbound transfers.
- **Existing payment flow is unchanged** — users still send USDC via the same UI. Only the destination address changes from DAO wallet to operator wallet.
- **Project:** [proj.ai-operator-wallet](../projects/proj.ai-operator-wallet.md) — 3-PR roadmap (was 6 PRs with PaymentRouter contract, simplified to 3).

## Current State

- **Done:** Project roadmap rewritten, both specs updated (operator-wallet, web3-openrouter-payments), all 3 tasks created (task.0084/0085/0086)
- **Not done:** No code written yet. All 3 tasks are `Todo`.
- **Existing infrastructure to reuse:**
  - Payment flow works end-to-end (intent → sign → verify → credits)
  - `OnChainVerifier` port pattern is the template for `WalletSignerPort`
  - `packages/cogni-contracts/src/cogni-signal/` pattern for any ABI exports needed later
  - repo-spec already has `payments_in.credits_topup.receiving_address` — just change the value
  - Revenue share constants (`USER_PRICE_MARKUP_FACTOR`, `SYSTEM_TENANT_REVENUE_SHARE`) already in `server-env.ts`

## Decisions Made

- **No PaymentRouter contract** — app-side routing over on-chain split. See [proj.ai-operator-wallet Design Notes](../projects/proj.ai-operator-wallet.md#design-notes)
- **WalletSignerPort has typed methods only** — `getAddress()`, `sendUsdcToTreasury()`, `signTopUpTransaction()`. No generic `signTransaction(calldata)`. See [operator-wallet spec invariant NO_GENERIC_SIGNING](../../docs/spec/operator-wallet.md#invariants)
- **Keystore custody for P0** — Web3 Secret Storage v3 (ethers.js). Vault/KMS is P1. See [operator-wallet spec](../../docs/spec/operator-wallet.md#p0-adapter-encrypted-keystore)
- **receiving_address = operator_wallet.address** — enforced at startup (RECEIVING_ADDRESS_MATCH). See [operator-wallet spec](../../docs/spec/operator-wallet.md#repo-spec-configuration)
- **Top-up economics:** `openrouterTopUpUsd = paymentUsd × (1 + REVENUE_SHARE) / (MARKUP × (1 - PROVIDER_FEE))`. Defaults: $0.9211 per $1.00, 7.9% DAO margin. See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md#economics)

## Next Actions

- [ ] Implement task.0084: `WalletSignerPort` interface, `KeystoreSignerAdapter`, `generate-operator-wallet.ts` script, repo-spec schema update
- [ ] Implement task.0085: `sendUsdcToTreasury()`, `calculateDaoShare()`, `outbound_transfers` table, dispatch from `creditsConfirm.ts`
- [ ] Implement task.0086: `signTopUpTransaction()`, `calculateOpenRouterTopUp()`, OpenRouter charge creation, Coinbase Commerce encoding, `outbound_topups` table, margin startup check
- [ ] Resolve open questions: minimum OpenRouter top-up amount, sequential vs parallel outbound dispatch
- [ ] After all 3 PRs: generate real operator wallet, update repo-spec addresses, fund wallet on Base

## Risks / Gotchas

- **Non-atomic split:** If app crashes between credit mint and treasury forwarding, USDC sits in operator wallet temporarily. Acceptable — `outbound_transfers` table provides retry. Not a fund loss risk.
- **OpenRouter Coinbase Commerce protocol:** Returns `transfer_intent`, NOT raw calldata. Must encode `swapAndTransferUniswapV3Native(intent, poolFeesTier=500)`. Transfers contract on Base: `0xeADE6bE02d043b3550bE19E960504dbA14A14971`.
- **Env vars are optional for PR 1:** `OPERATOR_KEYSTORE_PATH` and `OPERATOR_WALLET_PASSPHRASE` should be optional so existing deployments don't break. Wallet features activate only when both are set.
- **5% OpenRouter crypto fee** is grossed up in the formula, not absorbed by DAO. Margin check at startup prevents misconfiguration.
- **Dependency-cruiser boundaries:** Port in `src/ports/`, adapter in `src/adapters/server/wallet/`, pure math in `src/core/billing/`. Follow existing `onchain-verifier.port.ts` pattern exactly.

## Pointers

| File / Resource                                                              | Why it matters                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [proj.ai-operator-wallet](../projects/proj.ai-operator-wallet.md)            | 3-PR roadmap, design rationale                                      |
| [operator-wallet spec](../../docs/spec/operator-wallet.md)                   | WalletSignerPort interface, invariants, keystore loading            |
| [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) | Top-up economics, state machines, Coinbase Commerce flow            |
| [task.0084](../items/task.0084.operator-wallet-generation-wiring.md)         | PR 1 detailed plan                                                  |
| [task.0085](../items/task.0085.dao-treasury-forwarding.md)                   | PR 2 detailed plan                                                  |
| [task.0086](../items/task.0086.openrouter-topup-integration.md)              | PR 3 detailed plan                                                  |
| `src/ports/onchain-verifier.port.ts`                                         | Port pattern to follow                                              |
| `src/shared/config/repoSpec.server.ts`                                       | Where to add `getOperatorWalletConfig()`                            |
| `src/core/billing/pricing.ts`                                                | Where to add `calculateOpenRouterTopUp()` and `calculateDaoShare()` |
| `src/features/payments/services/creditsConfirm.ts`                           | Dispatch point for outbound flows after credit settlement           |
| `src/shared/env/server-env.ts`                                               | Where to add new env vars                                           |
| `src/bootstrap/container.ts`                                                 | Where to wire the adapter                                           |
