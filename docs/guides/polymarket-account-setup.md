---
id: polymarket-account-setup-guide
type: guide
title: Polymarket Prototype Wallet Setup
status: draft
trust: draft
summary: One-time onboarding to enable a DEDICATED Cogni-controlled Privy wallet to trade on Polymarket's CLOB via the direct-EOA path. Verified 2026-04-18 against wallet 0x7A33...0aEB. Custody-isolated from the production operator wallet (which handles Base USDC billing — never let it sign Polymarket orders).
read_when: Provisioning a new Polymarket trading wallet for a Cogni node, or rotating the prototype wallet.
owner: derekg1729
created: 2026-04-17
verified: 2026-04-18
tags: [poly, polymarket, prototype-wallet, setup]
---

# Polymarket Prototype Wallet Setup

## TL;DR

```
1.  Create a key quorum (one-time per app)              — API
2.  Create wallet with owner_id = that quorum           — API
3.  Fund the wallet on Polygon (USDC.e + POL)           — manual
4.  Approve 3 CLOB contracts + CTF operators            — API
5.  Derive POLY_CLOB_* creds                            — API
6.  Save POLY_PROTO_* + POLY_CLOB_* into .env.local     — manual
```

Total time: ~10 min including funding confirmation.

## CRITICAL: Use a dedicated wallet, NOT the production operator wallet

The production operator wallet (`OPERATOR_WALLET_ADDRESS` — see [operator-wallet-setup.md](./operator-wallet-setup.md)) handles Base mainnet USDC billing flows: `distributeSplit()` (DAO/operator splits) and `fundOpenRouterTopUp()`. It must NEVER be the EIP-712 signer for speculative Polymarket orders on Polygon. One Privy private key compromise = drained billing wallet AND drained trading position.

This guide creates a **separate** Privy wallet whose only job is signing Polymarket CLOB orders. Env vars are `POLY_PROTO_*`, never `OPERATOR_*`.

## Prerequisites

- Existing Privy app with `PRIVY_APP_ID` + `PRIVY_APP_SECRET` in `.env.local` (the same app the production operator wallet uses; we share the app, isolate the wallet).
- A **per-prototype-wallet** Privy authorization key generated in the Privy dashboard (Settings → Authorization → New key). Save the private half as `POLY_PROTO_PRIVY_SIGNING_KEY` in `.env.local`. **Do not reuse `PRIVY_SIGNING_KEY`** — that one belongs to the production wallet's quorum.

## The Privy "owner" trap (read this first)

Wallets created **via the Privy dashboard** default to `owner_id = your-dashboard-user-account`. They look fine but are **unsignable from any API call**, because no programmatic key authorizes them — only your browser SSO session does. Result: every `signTransaction` returns `401 No valid authorization signatures were provided`.

The fix: create the wallet **via API** with `owner_id` set to a **key quorum** that contains your `POLY_PROTO_PRIVY_SIGNING_KEY`'s public counterpart. Privy has no documented way to flip a user-owned wallet to quorum-owned after the fact — if you already created one in the dashboard, abandon it and create a fresh one via API (transfer any funds out via the dashboard's Transfer button before abandoning).

## Steps

### 1. Create the key quorum (one-time per app)

Run `scripts/experiments/attach-poly-proto-signer.ts`. It derives the public key from `POLY_PROTO_PRIVY_SIGNING_KEY` locally (no Privy call) and creates a key quorum on Privy containing it. Logs the quorum id:

```
[attach]   quorum id: <e.g. mjhtiz88b6s1p9f4xd07el8o>
```

**This script will then attempt to attach the quorum to an existing wallet — that step will fail with 401 if the wallet is dashboard-owned. Ignore the failure; the quorum was created and that's what we need.** Save the quorum id.

### 2. Create the wallet with the quorum as owner

```bash
POLY_PROTO_OWNER_QUORUM_ID=<quorum-id-from-step-1> \
  pnpm dotenv -e .env.local -- pnpm tsx scripts/provision-poly-proto-wallet.ts
```

Output:

```
[poly-proto] PASS — wallet created.
  Address:   0x7A33...
  Wallet ID: ypjap2puh4hnzori2c3juypr
```

Save the address as `POLY_PROTO_WALLET_ADDRESS` in `.env.local`.

### 3. Fund the wallet on Polygon (manual, ~3 min)

Send to the new address on **Polygon (chainId 137)**, NOT Base:

| Asset      | Amount       | Why                                  | Token address                                |
| ---------- | ------------ | ------------------------------------ | -------------------------------------------- |
| **USDC.e** | $20 (~20.00) | Trade collateral                     | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| **POL**    | ~1 POL       | Gas for allowance + future order txs | (native; was MATIC, renamed POL in 2024)     |

Note: Polymarket settles in **USDC.e** (the bridged USDC, contract above), not native USDC. Sending native USDC means it's stuck on the wrong contract.

### 4. Approve the three CLOB contracts + CTF operators

This single script handles **both** approval types in one run. Idempotent (skips allowances already at MaxUint256 and CTF operators already approved).

```bash
OPERATOR_WALLET_ADDRESS=$POLY_PROTO_WALLET_ADDRESS \
  PRIVY_SIGNING_KEY=$POLY_PROTO_PRIVY_SIGNING_KEY \
  pnpm dotenv -e .env.local -- pnpm tsx scripts/experiments/approve-polymarket-allowances.ts
```

The script reads `OPERATOR_WALLET_ADDRESS` and `PRIVY_SIGNING_KEY` (legacy names — the inline overrides above point them at the prototype wallet's identity for this one invocation).

Expected output: 3 `tx confirmed` lines for USDC.e spenders, then 2 more for CTF operators.

#### USDC.e (`approve`) — required for BUY

Three spenders receive `approve(spender, MaxUint256)` on the USDC.e contract (`0x2791…4174`):

| Contract          | Address                                      |
| ----------------- | -------------------------------------------- |
| Exchange          | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg-Risk Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Neg-Risk Adapter  | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |

#### CTF ERC-1155 (`setApprovalForAll`) — required for SELL

Without this, SELL orders are silently rejected by the CLOB (`success=undefined, errorMsg=""`).

The CTF contract (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`) must grant `setApprovalForAll(operator, true)` to three operators:

| Operator          | Address                                      |
| ----------------- | -------------------------------------------- |
| Exchange          | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg-Risk Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Neg-Risk Adapter  | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |

Live validation on 2026-04-23 proved this third operator is required for successful neg-risk SELL close. Without it, Polymarket will reject exit with `spender: 0xd91E80... allowance: 0` even when BUY-side approvals are otherwise healthy.

Verify all three are set: `isApprovedForAll(owner, operator)` returns `true` for each.

### 5. Derive Polymarket L2 CLOB API credentials

```bash
OPERATOR_WALLET_ADDRESS=$POLY_PROTO_WALLET_ADDRESS \
  PRIVY_SIGNING_KEY=$POLY_PROTO_PRIVY_SIGNING_KEY \
  pnpm dotenv -e .env.local -- pnpm tsx scripts/experiments/derive-polymarket-api-keys.ts
```

Output ends with:

```
POLY_CLOB_API_KEY=<uuid>
POLY_CLOB_API_SECRET=<base64>
POLY_CLOB_PASSPHRASE=<hex>
```

Append to `.env.local`. Idempotent: re-running returns the same creds for the same wallet.

### 6. Verify with the probe

```bash
OPERATOR_WALLET_ADDRESS=$POLY_PROTO_WALLET_ADDRESS \
  PRIVY_SIGNING_KEY=$POLY_PROTO_PRIVY_SIGNING_KEY \
  pnpm dotenv -e .env.local -- pnpm tsx scripts/experiments/probe-polymarket-account.ts
```

Expect non-zero USDC.e balance, three `MaxUint256` USDC.e allowances, and three CTF `isApprovedForAll=true` results.

## Final `.env.local` block

```bash
# Polymarket Prototype Wallet (custody-isolated from OPERATOR_WALLET_ADDRESS)
POLY_PROTO_WALLET_ADDRESS=0x...                  # from step 2
POLY_PROTO_PRIVY_SIGNING_KEY=wallet-auth:MIGHAgEA...              # generated in dashboard
POLY_CLOB_API_KEY=<uuid>                          # from step 5
POLY_CLOB_API_SECRET=<base64>
POLY_CLOB_PASSPHRASE=<hex>
```

These same five values must land on the candidate-a / canary / production GH environment secrets via `gh secret set <name> --env <env>` for the poly node to use them in flight.

## Troubleshooting

| Symptom                                                         | Cause                                                                          | Fix                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `401 No valid authorization signatures were provided` on any tx | Wallet's owner_id is a dashboard user, not a key quorum                        | Abandon the wallet, redo step 2 with the quorum id                                                     |
| `derive-polymarket-api-keys` fails with `403 Geo-blocked`       | Your IP is in a Polymarket-blocked region                                      | Run from a permitted region or via a VPN/tunnel to a permitted VM                                      |
| You accidentally created the wallet in the Privy dashboard      | Default ownership trap (see top of this guide)                                 | Use dashboard "Transfer" to move funds to a fresh API-created wallet, then ignore the dashboard wallet |
| Want to confirm wallet is API-controllable BEFORE funding       | Privy's `signMessage` is free and proves Privy accepts your key for the wallet | Use `client.wallets()` + `createViemAccount` + `account.signMessage("test")` — no on-chain cost        |
| Sent native USDC instead of USDC.e                              | Wrong token contract — Polymarket only settles in USDC.e on Polygon            | The funds are stuck at the wrong contract; you'll need to swap to USDC.e (e.g., via 1inch on Polygon)  |

## Wallet rotation

Re-running steps 1–6 against a fresh signing key + new wallet creates a fully independent prototype wallet. Then update GH env secrets and redeploy. The old wallet keeps any unspent USDC.e until you Transfer it out.

## Reconciler tuning

The order reconciler (task.0328) runs every 60 s and syncs `pending`/`open` rows
against CLOB. When CLOB returns `not_found` for a row, the reconciler waits for a
configurable grace window before promoting the row to `canceled`.

| Env var                        | Default           | Meaning                                                                                                          |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POLY_CLOB_NOT_FOUND_GRACE_MS` | `900000` (15 min) | How long to wait after `created_at` before treating a not_found response as authoritative and canceling the row. |

If the Grafana counter `poly_reconciler_not_found_upgrades_total` spikes, it means
CLOB returned not_found for many orders that were previously visible — likely a CLOB
pruning-window change. Lower the grace value to react faster, or raise it to suppress
false positives while investigating.

## Related

- Spec: `work/items/task.0315.poly-copy-trade-prototype.md` — design + checkpoint plan
- Guide: `docs/guides/operator-wallet-setup.md` — production billing wallet (separate, do not collapse)
- Script: `scripts/provision-poly-proto-wallet.ts` — step 2
- Script: `scripts/experiments/attach-poly-proto-signer.ts` — step 1
- Script: `scripts/experiments/approve-polymarket-allowances.ts` — step 4
- Script: `scripts/experiments/derive-polymarket-api-keys.ts` — step 5
- Script: `scripts/experiments/probe-polymarket-account.ts` — step 6
- Package: `@cogni/operator-wallet` — Privy HSM signer (shared by both wallets)
