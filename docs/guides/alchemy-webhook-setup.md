---
id: alchemy-webhook-setup-guide
type: guide
title: Alchemy Webhook Setup
status: draft
trust: draft
summary: Configure Alchemy webhooks for on-chain governance signal execution.
read_when: Setting up on-chain DAO signal execution for local dev or production.
owner: derekg1729
created: 2026-03-11
verified: 2026-03-11
tags: [dev, governance, alchemy, webhooks]
---

# Alchemy Webhook Setup

How to configure Alchemy webhooks for on-chain governance signal execution.

## What This Does

Alchemy monitors a CogniSignal contract for `CogniAction` events. When a DAO proposal executes a signal, Alchemy sends a webhook to this app. The app re-verifies the transaction on-chain and executes the GitHub action (merge PR, grant/revoke collaborator).

## Prerequisites

- [Alchemy account](https://dashboard.alchemy.com)
- CogniSignal contract deployed (address in `.cogni/repo-spec.yaml` → `cogni_dao.signal_contract`)
- GitHub App with `contents:write` + `administration:write` permissions

## Alchemy Dashboard

1. Go to **Notify** → **Create Webhook**
2. Select **Address Activity**
3. Configure:
   - **Chain**: Match `cogni_dao.chain_id` in repo-spec (Sepolia = 11155111, Base = 8453)
   - **Address**: Your `signal_contract` address
   - **Webhook URL**: `https://<your-domain>/api/internal/webhooks/alchemy`
4. Copy the **Signing Key** — this is your `ALCHEMY_WEBHOOK_SECRET`

## Environment Variables

| Variable                 | Source                             | Purpose                                       |
| ------------------------ | ---------------------------------- | --------------------------------------------- |
| `ALCHEMY_WEBHOOK_SECRET` | Alchemy dashboard signing key      | HMAC-SHA256 verification of incoming webhooks |
| `EVM_RPC_URL`            | Alchemy dashboard → Apps → API Key | On-chain re-verification of tx receipts       |

Both go in `.env.local`. The remaining config (signal_contract, dao_contract, chain_id) comes from `.cogni/repo-spec.yaml`.

## Local Development

Alchemy can't reach localhost. Use [smee.io](https://smee.io) as a proxy:

1. Go to https://smee.io/new — copy the URL
2. In Alchemy dashboard, set webhook URL to your smee URL
3. Run the smee client:
   ```bash
   npx smee -u https://smee.io/<your-channel> --path /api/internal/webhooks/alchemy --port 3000
   ```
4. Start the app: `pnpm dev:stack`

Webhooks now flow: Alchemy → smee.io → localhost:3000.

## Sepolia Test DAO

For local testing, override `.cogni/repo-spec.yaml` with Sepolia test contracts (do not commit):

```yaml
cogni_dao:
  dao_contract: "0xB0FcB5Ae33DFB4829f663458798E5e3843B21839"
  plugin_contract: "0x77BA7C0663b2f48F295E12e6a149F4882404B4ea"
  signal_contract: "0x8f26cf7b9ca6790385e255e8ab63acc35e7b9fb1"
  chain_id: "11155111"
  base_url: "https://proposal.cognidao.org"
```

Test wallet (has Sepolia ETH): `0x7e1cc7be1c6074585bab220cfec9cc2eec4484341be20a524eca5bc8a90bf58d`

RPC: `https://eth-sepolia.g.alchemy.com/v2/<your-alchemy-api-key>`

## Verification

After setup, trigger a CogniAction event on the monitored contract. You should see in app logs:

```
signal dispatch: processing tx <hash>
signal execution complete: { action: "merge", target: "change", success: true }
```

If the webhook arrives but the signal is rejected, check:

- `chain_id mismatch` — repo-spec chain_id doesn't match the tx chain
- `dao_contract mismatch` — repo-spec dao_contract doesn't match the event's dao address
- `tx already executed` — duplicate webhook (idempotency working correctly)
