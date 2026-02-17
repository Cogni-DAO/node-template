---
id: proj.ai-operator-wallet
type: project
primary_charter:
title: AI Operator Wallet + PaymentRouter
state: Active
priority: 1
estimate: 5
summary: On-chain PaymentRouter splits every user purchase into DAO treasury + operator wallet funding. Operator wallet tops up OpenRouter credits autonomously. No DAO votes per purchase.
outcome: Users pay USDC → PaymentRouter atomically funds operator wallet + DAO treasury → app tops up OpenRouter immediately → credits backed by real LLM spend.
assignees: derekg1729
created: 2026-02-11
updated: 2026-02-17
labels: [wallet, billing, web3, smart-contracts]
---

# AI Operator Wallet + PaymentRouter

> Research: [ai-operator-wallet-budgeted-spending](../../docs/research/ai-operator-wallet-budgeted-spending.md)

## Goal

Close the financial loop so every credit purchase automatically provisions OpenRouter — no manual transfers, no DAO votes per purchase. A PaymentRouter contract atomically splits inbound payments between DAO treasury and operator wallet. The operator wallet tops up OpenRouter via the Coinbase Commerce protocol. The app mints credits only after on-chain confirmation.

## Roadmap

### Crawl (P0) — Contracts Toolchain + PaymentRouter + Operator Wallet

**Goal:** Foundry in the monorepo, PaymentRouter deployed on Base, operator wallet generated and signing OpenRouter top-ups.

6 atomic PRs, each shippable:

| #   | Deliverable                                  | Status      | Est | Work Item |
| --- | -------------------------------------------- | ----------- | --- | --------- |
| 1   | Contracts toolchain (`packages/contracts`)   | Not Started | 2   | —         |
| 2   | PaymentRouter v1 (ETH-in, split, no swap)    | Not Started | 3   | —         |
| 3   | PaymentRouter v1.1 (USDC-in + UniV3 swap)    | Not Started | 3   | —         |
| 4   | Deploy script + formation wiring             | Not Started | 2   | —         |
| 5   | App purchase flow switch + credit settlement | Not Started | 3   | —         |
| 6   | OpenRouter top-up integration                | Not Started | 3   | —         |

**PR 1 — Contracts toolchain:**

- Add `packages/contracts/` with Foundry (foundry.toml, forge-std, OZ)
- Mirror structure from [cogni-signal-evm-contracts](https://github.com/Cogni-DAO/cogni-signal-evm-contracts): `src/`, `test/unit/`, `test/e2e/`, `script/`
- Add `forge build`, `forge test` to CI (`pnpm check`)
- Reuse foundry.toml settings from sister repo (cancun EVM, optimizer 200, via_ir)

**PR 2 — PaymentRouter v1 (ETH-in):**

- Accept ETH, split to `dao_treasury` + `operator_wallet` (fixed addresses, set at deploy)
- Split ratio derived from on-chain constants matching app billing math
- No fund retention (not a vault — forward everything in-tx)
- Emit `PurchaseRouted(purchaseId, payer, ethIn, daoOut, operatorOut)` event
- Replay protection: `purchaseId` must be unique (mapping, revert on replay)
- Pausable (DAO-controlled), no EOA admin
- Full test suite: replay, pause, cap, event receipts, invariant fuzzing

**PR 3 — PaymentRouter v1.1 (USDC-in + swap):**

- Add USDC-in path: accept USDC, swap operator portion via UniswapV3 (USDC→ETH)
- Bounded slippage (caller-set `minOut` + `deadline`, revert on excess)
- DAO portion stays as USDC (no swap)
- Invariant/fuzz tests: can't route to arbitrary recipients, can't retain funds

**PR 4 — Deploy + formation wiring:**

- `forge script` for deterministic deploy on Base
- `scripts/generate-operator-wallet.ts` — generate keystore, output address
- Store router + wallet addresses in `.cogni/repo-spec.yaml`
- Formation docs: what an operator runs to set up a new deployment

**PR 5 — App purchase flow switch:**

- UI pays the PaymentRouter (not "send USDC to DAO wallet")
- Index `PurchaseRouted` event for confirmation
- Credits mint only after on-chain confirmation (no mint-before-funding)
- `outbound_topups` table + state machine for tracking

**PR 6 — OpenRouter top-up integration:**

- `WalletSignerPort` with typed `signTopUpTransaction(intent)` method
- Keystore adapter loads encrypted keystore at startup, verifies address against repo-spec
- OpenRouter charge creation → Coinbase Commerce `swapAndTransferUniswapV3Native` → sign → broadcast
- Circuit breaker: pause purchases if top-up failures exceed threshold
- Charge receipt logging with `openrouter_topup` reason

### Walk (P1) — Monitoring + Hardening

**Goal:** Observability, automated balance checks, Vault/KMS key management.

| Deliverable                                               | Status      | Est | Work Item            |
| --------------------------------------------------------- | ----------- | --- | -------------------- |
| Grafana alerts: operator balance, top-up failures, margin | Not Started | 2   | (create at P1 start) |
| OpenRouter balance probe (GET /api/v1/credits polling)    | Not Started | 1   | (create at P1 start) |
| Vault or KMS signer adapter (replaces keystore)           | Not Started | 3   | (create at P1 start) |
| UI admin panel: trigger manual top-up, view status        | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Spending

**Goal:** AI monitors its own balance and tops up within DAO-approved limits.

| Deliverable                                                 | Status      | Est | Work Item            |
| ----------------------------------------------------------- | ----------- | --- | -------------------- |
| Auto top-up: agent monitors credit balance, triggers top-up | Not Started | 2   | (create at P2 start) |
| On-chain spending limits (Zodiac Roles or session keys)     | Not Started | 3   | (create at P2 start) |
| x402 integration for AI-to-service micropayments            | Not Started | 2   | (create at P2 start) |

## Constraints

- All contracts on Base mainnet (8453) only for P0
- No DAO votes per purchase — PaymentRouter makes funding atomic
- No fund retention in router — all value forwarded in-tx
- Key material never in source control
- 100% OSS — no vendor custody (Privy, Coinbase CDP, etc.)
- Credits only mint after on-chain confirmation — no mint-before-funding
- Contracts are immutable v1 or upgradeable behind DAO-controlled timelock — no EOA admin
- Sister repo [cogni-signal-evm-contracts](https://github.com/Cogni-DAO/cogni-signal-evm-contracts) is the Foundry reference — reuse its toolchain setup, test patterns, and deployment conventions

## Dependencies

- [x] OpenRouter Crypto Payments API supports Base (chain_id 8453)
- [x] `cogni_system` billing account exists (task.0046, merged)
- [x] Revenue share constants exist (`SYSTEM_TENANT_REVENUE_SHARE`, `USER_PRICE_MARKUP_FACTOR`)
- [ ] `EVM_RPC_URL` configured for Base mainnet
- [ ] Foundry installed in CI environment
- [ ] UniswapV3 USDC/ETH pool has sufficient liquidity on Base (check before PR 3)

## As-Built Specs

- [web3-openrouter-payments](../../docs/spec/web3-openrouter-payments.md) — payment math, top-up state machine, circuit breaker (draft)
- [operator-wallet](../../docs/spec/operator-wallet.md) — wallet lifecycle, signing port, access control (draft)

## Design Notes

### Why a PaymentRouter contract (not off-chain split)?

Without it, user USDC goes to the DAO treasury, then someone must manually (or via DAO vote) transfer funds to the operator wallet. That's slow and breaks the "immediate top-up" goal. The router makes the split atomic — one user tx funds both DAO and operator.

### Why USDC-in with swap (not ETH-in only)?

Users already pay USDC (existing payment flow). OpenRouter's crypto API takes ETH on Base. The router accepts USDC and swaps the operator portion to ETH via Uniswap V3. DAO portion stays as USDC. This avoids changing the user-facing payment UX.

PR 2 ships ETH-in first as a simpler milestone. PR 3 adds the USDC path with swap.

### Why Foundry (not Hardhat)?

Foundry gives us invariant testing + fuzzing (`forge test --fuzz`), fast iteration, and reproducible deploy scripts (`forge script`). For money-moving contracts, invariant tests are essential. The sister repo already uses Foundry — we reuse the same toolchain.

### OpenRouter top-up is the Coinbase Commerce protocol

OpenRouter returns a `transfer_intent` (not raw calldata). We encode `swapAndTransferUniswapV3Native(intent, poolFeesTier=500)` on the Coinbase Transfers contract (`0xeADE6bE02d043b3550bE19E960504dbA14A14971` on Base). Must `simulateContract()` before broadcast. See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full flow.

### Top-up economics (derived from constants)

```
openrouterTopUpUsd = paymentUsd × (1 + REVENUE_SHARE) / (MARKUP × (1 - PROVIDER_FEE))

Defaults: 1.75 / (2.0 × 0.95) = $0.9211 per $1.00 purchase
Net DAO margin: 7.9%
```

See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full derivation.
