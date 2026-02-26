---
id: proj.x402-e2e-migration
type: project
primary_charter:
  title: "x402 E2E Migration: Hyperbolic + Per-Request Settlement"
  state: Active
  priority: 1
  estimate: 13
  summary: Replace OpenRouter credit-purchase-then-consume billing with x402 per-request settlement end-to-end — users pay nodes via x402 upto, nodes pay Hyperbolic via x402, no credit system.
  outcome: Cogni node accepts x402 USDC payments per-request, routes to Hyperbolic via x402, settles dynamically — no credit_ledger, no Privy, no Splits, no Coinbase Commerce. A new node deploys with a wallet and a LiteLLM config, nothing else.
  assignees: derekg1729
  created: 2026-02-26
  updated: 2026-02-26
  labels: [billing, x402, web3, provider, migration]
---

# x402 E2E Migration: Hyperbolic + Per-Request Settlement

> Spec: [x402-e2e.md](../../docs/spec/x402-e2e.md)
> Research: [gateway-billing-analysis.md](../../docs/research/gateway-billing-analysis.md)
> Supersedes: [proj.ai-operator-wallet.md](proj.ai-operator-wallet.md) (Privy + Splits + Coinbase Commerce approach)

## Goal

Replace the entire credit-purchase-then-consume billing model with x402 per-request settlement. Users/agents pay Cogni nodes per-request via x402 `upto` scheme (USDC on Base). Nodes pay Hyperbolic per-request via x402. LiteLLM remains the cost oracle. charge_receipts remain the audit trail. Everything else (credit_ledger, payment_attempts, Privy, Splits, Coinbase Commerce, OpenRouter) is deleted.

**The end state:** A new AI project becomes a Cogni node by forking the template, deploying with a wallet address and a LiteLLM config. No Privy account, no Splits contract, no Coinbase Commerce, no OpenRouter account. Just a wallet with USDC and a config pointing at Hyperbolic.

## Roadmap

### Crawl (P0) — Hyperbolic Migration + Outbound x402

**Goal:** Replace OpenRouter with Hyperbolic. Validate x402 outbound payments from node to provider. Keep current inbound credit system temporarily.

| # | Deliverable | Status | Est | Work Item |
| - | - | - | - | - |
| 0 | Spike: Hyperbolic API validation — connect LiteLLM, run inference, verify cost reporting | Not Started | 1 | spike.0100 |
| 1 | Spike: Hyperbolic x402 payment — pay for inference via x402, verify settlement | Not Started | 1 | spike.0101 |
| 2 | LiteLLM config rewrite — replace all OpenRouter routes with Hyperbolic equivalents | Not Started | 1 | task.0100 |
| 3 | x402 outbound client — handle Hyperbolic 402 responses, sign from node wallet | Not Started | 2 | task.0101 |
| 4 | Embedding provider migration — replace OpenRouter text-embedding-3-small with alternative | Not Started | 1 | task.0102 |
| 5 | Node wallet setup — env vars, key management, balance monitoring | Not Started | 1 | task.0103 |

**Spike 0 — Hyperbolic API validation:**

Validate before building abstractions:
1. Configure LiteLLM with `hyperbolic/deepseek-ai/DeepSeek-V3` and `HYPERBOLIC_API_KEY`
2. Send a test completion request through LiteLLM proxy
3. Verify `x-litellm-response-cost` header populates correctly
4. Verify streaming works (`stream: true`)
5. Test 3-4 models: DeepSeek-V3, Llama-3.3-70B, Qwen3-235B, Kimi-K2
6. Record actual costs vs. documented pricing

**Spike 1 — Hyperbolic x402 payment:**

1. Send request to `https://hyperbolic-x402.vercel.app/v1/chat/completions`
2. Receive 402 response, examine payment payload (scheme, amount, chain)
3. Sign x402 payment authorization with test wallet
4. Verify settlement on Base (block explorer)
5. **Key question:** Does Hyperbolic x402 use `exact` or `upto` scheme?
6. Record latency overhead of x402 vs. API key auth

**Why spikes first:** Hyperbolic's x402 is deployed on a separate Vercel endpoint. We need to verify the actual protocol behavior before building the outbound client.

### Walk (P1) — Inbound x402 + Credit System Removal

**Goal:** Add x402 inbound middleware so users/agents pay per-request. Delete the credit system.

| # | Deliverable | Status | Est | Work Item |
| - | - | - | - | - |
| 6 | x402 inbound middleware — intercept requests, respond 402, verify payment | Not Started | 3 | (create at P1 start) |
| 7 | x402 facilitator adapter — verify + settle inbound payments (Thirdweb SDK) | Not Started | 2 | (create at P1 start) |
| 8 | billing_accounts wallet migration — add wallet_address, remove balance tracking | Not Started | 1 | (create at P1 start) |
| 9 | Delete credit system — credit_ledger, payment_attempts, payment_events tables + services | Not Started | 1 | (create at P1 start) |
| 10 | charge_receipts x402 columns — add x402_inbound_tx, x402_outbound_tx, provider_cost_usd | Not Started | 1 | (create at P1 start) |
| 11 | calculateMaxPayable() in pricing.ts | Not Started | 1 | (create at P1 start) |
| 12 | Delete Privy integration + Splits + Coinbase Commerce code | Not Started | 1 | (create at P1 start) |

### Run (P2+) — Hardening + Multi-Turn + Federation

**Goal:** Production hardening, session-based payments, cross-node routing.

| # | Deliverable | Status | Est | Work Item |
| - | - | - | - | - |
| 13 | "Sign once, settle many" for multi-turn chat sessions | Not Started | 2 | (create at P2 start) |
| 14 | Self-hosted x402 facilitator (remove Coinbase verification dependency) | Not Started | 2 | (create at P2 start) |
| 15 | Grafana dashboard — x402 settlements, margins, wallet balance | Not Started | 1 | (create at P2 start) |
| 16 | Circuit breaker — pause serving if node wallet below threshold | Not Started | 1 | (create at P2 start) |
| 17 | L402 (Lightning) as alternative inbound payment rail | Not Started | 3 | (create at P2 start) |

## Constraints

- Base mainnet (8453) for all x402 settlements
- USDC only (no other stablecoins in P0/P1)
- Open-source models only — no Claude, GPT, or Gemini (Hyperbolic limitation)
- Hyperbolic x402 endpoint (`hyperbolic-x402.vercel.app`) is Vercel-deployed — monitor uptime
- Hyperbolic rate limits: 60 RPM (Basic), 600 RPM (Pro). May need Enterprise for production.
- LiteLLM remains the cost oracle — all pricing math flows through `calculateLlmUserCharge()`
- charge_receipts idempotency via `UNIQUE(source_system, source_reference)` is unchanged
- Must not break epoch ledger (activity_events, epoch_allocations, payout_statements)

## Dependencies

- [x] Hyperbolic API supports OpenAI-compatible format (verified: native LiteLLM `hyperbolic/` prefix)
- [x] x402 `upto` scheme shipped (Thirdweb SDK v5.114.0+)
- [x] Hyperbolic accepts x402 payments (separate Vercel endpoint)
- [ ] Hyperbolic Enterprise tier (for 600+ RPM production workloads)
- [ ] Embedding provider decided (Hyperbolic has no embeddings endpoint)
- [ ] Node wallet provisioning (key management approach: env var vs. keystore vs. CDP wallet)
- [ ] Thirdweb x402 SDK integration tested with LiteLLM callback flow

## As-Built Specs

- [x402-e2e.md](../../docs/spec/x402-e2e.md) — Payment architecture + schema changes (draft)
- [node-operator-x402.md](../../docs/spec/node-operator-x402.md) — Node vs Operator boundary with x402 (draft)

## Design Notes

### Why Hyperbolic over keeping OpenRouter?

1. **x402 symmetry** — Hyperbolic is an x402 launch partner. Both legs use x402 USDC on Base. No fiat bridge.
2. **No operator wallet** — No pre-funded provider balance. Each request pays independently.
3. **No Privy** — Node wallet is direct (env var or keystore). No third-party custody dependency.
4. **No Coinbase Commerce** — No fiat on-ramp integration needed for provider payments.
5. **Node deployment is trivial** — Fork template, set wallet address + HYPERBOLIC_API_KEY, deploy. No Privy account, no Splits contract, no OpenRouter account.

Tradeoff: No Claude, GPT, or Gemini. If proprietary models are required, a hybrid spec is needed (x402 for Hyperbolic open-source + credit bridge for OpenRouter proprietary). That is a SEPARATE project.

### Outbound x402 scheme mismatch

Hyperbolic currently uses `exact` scheme (fixed per-request price), not `upto`. This means:
- **Inbound** (user→node): `upto` scheme — node sets max, settles actual after LiteLLM computes cost
- **Outbound** (node→Hyperbolic): `exact` scheme — Hyperbolic sets fixed price, node pays upfront

This is still symmetric at the USDC-on-Base level — both legs are x402 USDC settlements. The scheme difference means the node pays a fixed price to Hyperbolic (possibly slightly more than per-token cost), then settles actual markup with the user. The node absorbs any pricing discrepancy as margin.

If Hyperbolic upgrades to `upto`, the outbound client can switch without architecture changes.

### Embedding gap

Hyperbolic has no embedding endpoint. Options ranked by preference:
1. **OpenAI direct** — `text-embedding-3-small` via `api.openai.com` (requires OpenAI API key, fiat billing)
2. **Self-hosted** — BGE-large-en-v1.5 or similar, deployed alongside the node
3. **Cohere** — Embed v3, has some crypto payment options
4. **Keep one OpenRouter route** — Just for embeddings (minimal dependency)

This is a bounded problem — embeddings are low-volume, low-cost, and don't need x402 per-request settlement.

### Supersedes proj.ai-operator-wallet

The operator wallet project (Privy + Splits + Coinbase Commerce → OpenRouter top-ups) is superseded by this approach. The entire rationale for an operator wallet was "someone must pre-fund the OpenRouter balance." With Hyperbolic x402, there is no pre-funded balance — each request pays independently. The operator wallet, Splits contract, and Coinbase Commerce integration are all unnecessary.

### Migration path from current billing

| Current Component | Migration | When |
| - | - | - |
| OpenRouter model routes | Replace with Hyperbolic in litellm.config.yaml | P0 |
| OPENROUTER_API_KEY | Replace with HYPERBOLIC_API_KEY | P0 |
| Credit purchase flow (USDC → mint credits) | Delete — x402 pays per-request | P1 |
| credit_ledger table | Delete | P1 |
| payment_attempts/events tables | Delete | P1 |
| creditsConfirm/creditsSummary services | Delete | P1 |
| paymentService state machine | Replace with x402 middleware | P1 |
| billing_accounts.balance | Remove column | P1 |
| Privy integration | Delete | P1 |
| Splits contract | Delete | P1 |
| evm-rpc-onchain-verifier adapter | Replace with x402 facilitator | P1 |
| charge_receipts | Keep + add x402 columns | P1 |
| pricing.ts | Keep + add calculateMaxPayable() | P1 |
| LiteLLM proxy + callbacks | Keep unchanged | — |
| epoch ledger | Keep unchanged | — |
