---
id: task.0221
type: task
title: "x402 inbound middleware + public graph execution endpoint"
status: needs_design
priority: 1
rank: 10
estimate: 3
summary: "Add x402 payment gate to graph execution so agents on the internet can pay USDC per-request to run Cogni graphs. No API key, no account — just a wallet."
outcome: "An agent with a USDC wallet can POST to /api/v1/graphs/{graphId}/run with an x402 payment, receive a graph-executed AI response, and have the settlement recorded in charge_receipts."
spec_refs: [x402-e2e-spec]
assignees: []
credit:
project: proj.x402-e2e-migration
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [x402, web3, billing, api]
external_refs: ["docs/research/x402-provider-passthrough.md"]
revision: 0
blocked_by: []
deploy_verified: false
---

## Context

spike.0220 proved x402 E2E works — both inbound (user→node) and outbound (node→Hyperbolic). The demo ran graph prompts through x402-paid LLM calls. Now we need to wire this into the real system.

Today, graph execution lives at `/api/internal/graphs/[graphId]/runs` — gated by `SCHEDULER_API_TOKEN` bearer auth, called by the scheduler worker. This is internal-only.

The task: create a **public** graph endpoint gated by x402 payment instead of bearer tokens. Any agent with a USDC wallet can run graphs.

## Design Notes

### What exists (from spike.0220 demo)

- `@x402/fetch`, `@x402/evm` packages handle client-side 402→sign→retry
- `ExactEvmScheme` + `ExactEvmSchemeV1` for Base mainnet payment signing
- Hyperbolic x402 endpoint confirmed working (20+ OSS models, $0.10 max/request)
- Express middleware pattern: check `X-PAYMENT` header → return 402 or proceed

### What needs building

1. **x402 inbound middleware** (Next.js middleware or route-level)
   - On missing/invalid `X-PAYMENT` header: return 402 with payment challenge
   - Payment challenge includes: node receiving address, estimated max cost (from model pricing), USDC on Base
   - On valid payment: verify via facilitator, proceed to graph execution
   - After completion: settle actual cost via facilitator

2. **Public graph execution route** (`/api/v1/graphs/[graphId]/run`)
   - Similar to internal route but: x402 auth instead of bearer token
   - No execution grant needed — payment IS the authorization
   - Billing identity = payer wallet address (from x402 payment)
   - Returns graph result + x402 settlement metadata

3. **x402 outbound adapter** (LlmService implementation)
   - `HyperbolicX402LlmAdapter implements LlmService`
   - Uses `@x402/fetch` wrapper instead of API key
   - Replaces LiteLlmAdapter for x402-mode requests
   - Cost = x402 settlement amount (not LiteLLM header)

4. **Node wallet** (simple for P0)
   - `NODE_WALLET_PRIVATE_KEY` env var → viem account
   - Signs outbound x402 payments to Hyperbolic
   - Receives inbound x402 settlements from users
   - P1: upgrade to keystore/HSM

5. **charge_receipts integration**
   - Record x402_settlement_tx (inbound tx hash)
   - Record provider_cost_usd (from outbound x402 amount)
   - Payer = wallet address (not billing_account_id)

### Key decisions from spike

- **Hyperbolic uses x402 v1** — must register both v1 and v2 scheme handlers
- **X-Request-ID required** by Hyperbolic — generate per outbound call
- **No cost in response body** — cost oracle is the x402 settlement, not LiteLLM
- **Node needs signing wallet** — this is simpler, not harder, than API key model

### Open questions

- Should x402 and bearer-token endpoints coexist? (yes — internal scheduler keeps bearer)
- How to estimate max cost for the inbound 402 challenge? (use Hyperbolic's maxAmountRequired + margin)
- Should the payer wallet address create an implicit billing_account? (probably yes — wallet-as-identity)

## Validation

- [ ] Agent with USDC wallet can call public endpoint and get graph response
- [ ] 402 challenge returned for requests without payment
- [ ] Payment verified via facilitator before graph execution
- [ ] Settlement recorded in charge_receipts with tx hash
- [ ] Existing internal bearer-token endpoint unaffected
- [ ] Works with at least 2 graphs (poet, ponderer)
