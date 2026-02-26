# Gateway Billing Analysis: Cogni in the Payments Path

> **Status:** Research spike — critical architecture decision
> **Date:** 2026-02-26
> **Question:** Should Cogni sit in the API payments pathway (USDC → DAO → credits → usage tracking), or adopt a passthrough model?

## The Problem Statement

The current spec (`web3-openrouter-payments.md`, `billing-evolution.md`, `payments-design.md`) designs Cogni as a **financial middleman**:

```
User → USDC → Split Contract → Operator Wallet → OpenRouter top-up
                ↓
         DAO Treasury (7.9%)
```

This means Cogni:
1. Accepts USDC payments
2. Mints internal credits (at 2x markup)
3. Tracks per-request usage via LiteLLM callbacks
4. Tops up OpenRouter with the operator wallet
5. Manages a credit ledger, charge receipts, outbound topups state machine

**That is five separate financial subsystems.** The question: how much of this is necessary, and how much is over-engineering?

---

## How Top Gateways Actually Work

### Pattern 1: Passthrough Gateway (LiteLLM, Helicone, Portkey)

These platforms sit in the **request path** but **NOT the payment path**.

| Platform | Payment Path? | API Key Model | Business Model | Self-Hostable? |
|----------|--------------|---------------|----------------|----------------|
| **LiteLLM** | No | BYOK (user's own keys stored as "virtual keys") | Open-source + enterprise hosting | Yes (MIT) |
| **Helicone** | No | BYOK (passthrough, user's keys forwarded) | Freemium observability SaaS | Yes (open-source) |
| **Portkey** | No | BYOK (virtual keys = encrypted user keys) | $49/mo+ SaaS, enterprise | Yes (open-source gateway) |

**What they provide without touching money:**
- Unified API across 100+ providers
- Load balancing, fallbacks, retries
- Observability (cost tracking, latency, errors)
- Rate limiting, caching, guardrails
- Budget alerts and spending caps

**What they explicitly do NOT do:**
- Accept payments from end users
- Maintain credit balances
- Top up provider accounts
- Run payment state machines

### Pattern 2: Centralized Marketplace (OpenRouter)

OpenRouter is the **only** major gateway that sits in the payment path.

| Aspect | OpenRouter |
|--------|-----------|
| Payment path? | **Yes** — collects money, pays providers |
| API key model | Platform keys (OpenRouter issues its own) |
| Fee | 5% on crypto top-ups, markup on some models |
| Self-hostable? | No |
| Business model | Financial intermediation margin |

OpenRouter's value proposition is convenience: one API key, one bill, access to models you might not get direct access to. The trade-off is financial dependency on the intermediary.

### The Industry Consensus

**3 out of 4 major gateways use passthrough.** The passthrough pattern dominates because:

1. **No financial compliance overhead** — no payment processing, refunds, credit systems, billing disputes
2. **No provider agreements needed** — users bring their own keys
3. **Self-hostable** — aligns with sovereignty principles
4. **Decoupled scaling** — gateway scales independently from billing
5. **Minimum viable value is immediate** — routing + observability from day one

---

## Cogni's Current Spec: Honest Assessment

### What's Well-Designed

The **inbound payment flow** (`payments-design.md`) is solid engineering:
- Clean state machine (5 states, clear transitions)
- On-chain verification via viem (no trust in client)
- Exactly-once credit settlement (3-layer idempotency)
- DAO receiving address in git-committed repo-spec (no env override)

The **billing accounting** (`billing-evolution.md`) is also clean:
- LiteLLM as cost oracle (no hardcoded pricing)
- Single billing path with transparent markup
- Immutable charge receipts

### What's Over-Engineered

The **outbound payment flow** (`web3-openrouter-payments.md`) is where complexity explodes:

| Component | Complexity | Actually Needed? |
|-----------|-----------|-----------------|
| Split contract (Splits.org) | Medium | Maybe — only if DAO margin is enforced on-chain |
| Operator wallet (Privy custody) | High | Only if Cogni pays providers |
| OpenRouter charge creation API | High | Only if Cogni pays providers |
| Coinbase Commerce transfer intent | Very High | Only if Cogni pays providers |
| Outbound topups state machine (5 states) | High | Only if Cogni pays providers |
| Per-tx simulation + broadcast | High | Only if Cogni pays providers |
| Retry/expiry logic for charges | Medium | Only if Cogni pays providers |

**Every single item in that table exists because Cogni chose to sit in the payment path.** If nodes pay providers directly, all of it vanishes.

### The Contradiction

The Node vs Operator Contract (`node-operator-contract.md`) already says:

> **AI Inference Billing:** Node-run inference: Node owns provider keys and pays directly.

The Boot Seams Matrix explicitly lists:
| Capability | Node Owns | Call Direction |
|-----------|-----------|---------------|
| AI inference (Node) | **Provider keys, billing** | **Node → Provider** |

**The spec already says nodes pay providers directly.** The entire `web3-openrouter-payments.md` flow contradicts this by inserting Cogni (via operator wallet) into the payment path between the node and OpenRouter.

---

## Proposed Simplification: Passthrough Model

### What Cogni Should Be

```
┌─────────────────────────────────────────────────┐
│                    NODE                          │
│                                                  │
│  User ──USDC──→ DAO Wallet                       │
│                    │                             │
│              mint credits                        │
│                    │                             │
│  Agent ──request──→ LiteLLM Proxy ──→ Provider   │
│                    │         ↑                    │
│              track usage     │                    │
│                    │    Node's own API keys       │
│              debit credits                        │
│                                                  │
│  Provider billing: Node pays directly            │
│  (OpenRouter account, Anthropic account, etc.)   │
└─────────────────────────────────────────────────┘
```

### What Changes

| Current Spec | Proposed | Why |
|-------------|----------|-----|
| USDC → Split → Operator → OpenRouter | USDC → DAO Wallet (direct) | Node pays provider with its own keys. No split contract needed. |
| Operator wallet (Privy custody) | **Delete** | Node doesn't need Cogni to pay OpenRouter on its behalf. |
| Outbound topups state machine | **Delete** | No outbound payments from Cogni to providers. |
| Coinbase Commerce integration | **Delete** | No on-chain payment to OpenRouter needed. |
| Credit system (inbound) | **Keep** | Internal accounting is valuable for usage tracking + budget enforcement. |
| LiteLLM as cost oracle | **Keep** | Core value — unified routing + cost tracking. |
| Charge receipts | **Keep** | Audit trail for credit consumption. |
| DAO treasury share | Simplify — flat % on inbound only | DAO takes its cut when credits are purchased, period. No outbound routing needed. |

### What Cogni's Gateway Actually Provides (Without Middleman Billing)

1. **Unified LLM routing** via LiteLLM (already deployed)
2. **Usage tracking + observability** (already built — charge receipts, activity metrics)
3. **Budget enforcement** (preflight credit checks — already built)
4. **DAO governance** over which models/providers are available
5. **Credit-based metering** for DAO members (already built)
6. **Epoch-based payout** for contributors (already built)

That is a real, substantial product. None of it requires Cogni to pay OpenRouter.

### How Provider Funding Works in Passthrough

**Option A: Node admin tops up OpenRouter manually**
- Simplest. Node receives USDC from users, admin periodically tops up the OpenRouter account.
- This is what every LiteLLM self-host deployment does today.

**Option B: Automated sweep (future, if needed)**
- A simple cron job checks OpenRouter balance, triggers top-up from DAO wallet when low.
- Much simpler than the current per-payment state machine — no Coinbase Commerce, no Splits, no per-tx simulation.
- This is a P2 enhancement, not MVP.

**Option C: Users bring their own OpenRouter keys**
- Full passthrough. Cogni just routes and observes.
- Most aligned with node sovereignty.
- Credits become optional (for DAO-subsidized usage only).

---

## Minimum Required Package Set for Node Autonomy

Given the passthrough model, here's what a sovereign node actually needs:

### Must-Have (Current — Keep)

| Package/Feature | Purpose | Status |
|----------------|---------|--------|
| `src/core/billing/pricing.ts` | Credit unit standard, markup calculation | Built |
| `src/core/payments/` | Inbound USDC payment state machine | Built |
| `src/features/payments/` | Payment service + settlement | Built |
| `src/shared/db/schema.billing.ts` | charge_receipts, credit_ledger, billing_accounts | Built |
| `packages/ai-core/` | AiEvent, UsageFact, executor primitives | Built |
| `packages/ledger-core/` | Epoch payout computation | Built |
| `packages/aragon-osx/` | DAO formation encoding | Built |
| LiteLLM proxy (Docker) | Unified LLM routing + cost oracle | Deployed |

### Must-Have (Current — Simplify)

| Package/Feature | Current | Proposed |
|----------------|---------|----------|
| DAO treasury share | Split contract + on-chain distribution | Flat % withheld at credit-mint time (DB-only) |
| Provider payment | Operator wallet → OpenRouter Coinbase Commerce | Node admin manages provider account directly |

### Should Delete

| Package/Feature | Reason |
|----------------|--------|
| `web3-openrouter-payments.md` (spec) | Unnecessary middleman flow |
| `operator-wallet.md` (spec) | No operator wallet needed for passthrough |
| Outbound topups table/state machine | No outbound payments |
| Coinbase Commerce transfer intent handling | No on-chain payment to OpenRouter |
| Split contract integration | DAO share computed at credit-mint, not on-chain |
| `OPERATOR_MAX_TOPUP_USD` / signing gates | No operator signing needed |

### Operator Role (Simplified)

With passthrough billing, the Operator becomes purely a **governance + services** platform:

| Operator Provides | How |
|------------------|-----|
| Git review (PR reviews) | git-review-daemon (already planned) |
| Git admin (repo actions) | git-admin-daemon (already planned) |
| Cred scoring | cognicred (already planned) |
| Node registry | Control plane (already planned) |
| **Billing/payments** | **Nothing. Nodes handle their own.** |

This is cleaner and more aligned with the Node vs Operator Contract's own stated invariants.

---

## Risk Assessment

### Risks of Current Approach (Middleman)
- **Regulatory exposure**: Cogni processes payments on behalf of users → potential money transmitter classification
- **Operational complexity**: 5 financial subsystems, each with failure modes
- **Single point of failure**: If operator wallet fails, all nodes lose AI access
- **Contradicts sovereignty**: Node depends on Cogni to fund its provider
- **Engineering cost**: Privy custody, Coinbase Commerce, Splits.org — each is a significant integration

### Risks of Proposed Approach (Passthrough)
- **Less automated**: Node admin must manage provider accounts manually (mitigated by P2 auto-sweep)
- **No margin on provider spend**: DAO only earns on credit purchase markup, not on provider intermediation (but the 7.9% was already thin)
- **Users need provider accounts**: Not an issue for DAOs (they have one shared account), but matters for future multi-tenant hosting

### Net Assessment

The passthrough model eliminates ~60% of the financial system complexity while preserving all the user-facing value (credits, billing, observability, governance). The middleman model's only advantage is slightly more automation on provider funding — at the cost of massive infrastructure, regulatory risk, and sovereignty violation.

---

## Recommendation

1. **Keep** the inbound payment system (USDC → credits). It's well-built and provides real value.
2. **Delete** the outbound payment system (operator wallet → OpenRouter). It's over-engineered middleman infrastructure that contradicts node sovereignty.
3. **Simplify** DAO treasury share to a flat percentage withheld at credit-mint time (no Split contract).
4. **Let nodes manage their own provider accounts.** This is what the Node vs Operator Contract already specifies.
5. **Defer** automated provider top-ups to P2, and when you build it, make it a simple balance-threshold sweep — not a per-payment state machine with Coinbase Commerce.

The result: Cogni is a **governance + observability + metering gateway**, not a financial intermediary. That's the right product.
