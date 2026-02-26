# Gateway Billing Analysis: The Crypto→AI Bridge Problem

> **Status:** Research spike — critical architecture decision
> **Date:** 2026-02-26
> **Core Question:** Cogni IS the crypto→AI payment bridge. How do we provide that service without becoming a bottleneck, and how does a new AI project become a Cogni node?

---

## Corrected Framing: Cogni is Not "Trying to Be" OpenRouter

The first pass of this analysis compared Cogni to passthrough gateways (LiteLLM, Helicone, Portkey) and suggested Cogni should just route requests without touching money. **That analysis was wrong** because it missed the fundamental constraint:

**OpenRouter was the only major AI aggregator accepting crypto** (via Coinbase Commerce on Base). That's changing — Hyperbolic now accepts per-call USDC via x402, Venice AI offers staked token access, AI/ML API accepts Bitcoin — but Anthropic, OpenAI, and Google still don't accept crypto directly. For a fully crypto-native DAO consuming mainstream AI models, someone must bridge USDC→provider credits.

Cogni's value proposition is being this bridge: a closed-loop crypto-native revenue/expense cycle for AI services. The question isn't *whether* to sit in the payment path — the question is *where* this bridge lives, who runs it, and how fast x402 makes it obsolete.

---

## The Landscape Is Moving Fast

### Providers Accepting Crypto (Feb 2026)

| Provider | Method | Model |
|----------|--------|-------|
| **OpenRouter** | Coinbase Commerce (USDC on Base) | Credit top-up, 5% fee |
| **Hyperbolic** | x402 (USDC on Base) | Per-call micropayment, x402 launch partner |
| **Venice AI** | VVV staking → DIEM | Stake capital = perpetual API access ($1/day/DIEM) |
| **AI/ML API** | Bitcoin + 300 cryptos | Subscription plans from $100/mo |
| **Akash** | AKT + USDC on-chain escrow | Compute leasing, block-priced settlement |
| **Render** | RENDER burn (Solana) | Burn-on-submit for GPU jobs |
| **Bittensor** | TAO emissions | Subnet queries, inflation-subsidized |
| **Anthropic, OpenAI, Google** | **None** | Fiat/credit card only |

The bottom four rows are the constraint: mainstream frontier models (Claude, GPT, Gemini) have no crypto payment rails. Until they adopt x402 or equivalent, the bridge is necessary.

### The x402 Protocol — Closer Than Expected

x402 revives HTTP 402 for machine-to-machine payments. USDC on Base, ~200ms settlement, ~$0.0001 per tx. **This is already in production:**
- 156,000 weekly transactions (492% growth)
- Adopted by Hyperbolic (GPU inference), Neynar (Farcaster data), Token Metrics
- Stripe integration shipped. Visa support announced. Cloudflare backing.
- Google AP2 natively supports x402's crypto extension

**When Anthropic/OpenAI adopt x402, the bridge problem disappears.** Nodes pay providers directly per-request in USDC. No credit top-ups, no operator wallets, no intermediaries.

### The Sovereignty Warning (BlueMatt, Feb 25 2026)

Worth noting: x402 is effectively Coinbase-controlled infrastructure. USDC is Coinbase's stablecoin. Base is Coinbase's L2. The facilitator is Coinbase's service. Lightning L402 (Lightning Labs, open-source tools released Feb 2026) is the truly permissionless alternative. For a DAO that values sovereignty, this matters — the "open" payment rail may not actually be open.

### Deployed Burn-on-Use Token Precedents

| Protocol | Token Model | Settlement | Status |
|----------|-------------|-----------|--------|
| **Render** | RENDER burned on job submit, providers paid from separate emission pool | 24-hour epochs | Live — 530K+ tokens burned Jan-Sep 2025 |
| **Akash (BME proposal)** | Burn AKT → mint ACT (USD-pegged compute credit), ACT burned at settlement, AKT re-minted to providers | Block-priced, batched withdrawal | Proposed (AEP-76), not yet deployed |
| **Venice** | Stake VVV → mint DIEM, 1 DIEM = $1/day API credit, DIEM tradeable on Aerodrome | Off-chain metering against staked allocation | Live — 33M+ VVV burned (42.8% of supply) |

The Akash BME model is closest to what a COGNI token protocol would look like: burn a utility token to consume AI, re-mint to providers at settlement. The key difference is Cogni routes to external providers (OpenRouter/Anthropic) rather than operating its own compute.

---

## The Real Architectural Trilemma

Any AI project becoming a Cogni node faces three options:

### Option A: Depend on Cogni Operator for the bridge

```
AI Project (Node)
  └→ Users pay USDC → Node's DAO wallet
  └→ Node calls Cogni Operator API: "top up my OpenRouter"
  └→ Cogni Operator wallet → OpenRouter (via Coinbase Commerce)
  └→ Node uses OpenRouter API keys provisioned by Operator
```

**Pros:** Node is lightweight. No wallet custody, no Coinbase Commerce integration. Ship in days.
**Cons:** Cogni is in the monetary critical path. If Operator is down, nodes can't get AI. Violates WALLET_CUSTODY and DEPLOY_INDEPENDENCE invariants.

### Option B: Every node runs the full bridge (current spec)

```
AI Project (Node)
  └→ Users pay USDC → Split Contract
  └→ Split → Node's own Operator Wallet (Privy)
  └→ Node's wallet → OpenRouter (via Coinbase Commerce)
  └→ Node uses its own OpenRouter API key
```

**Pros:** Full sovereignty. Each node owns its entire financial loop.
**Cons:** Every node needs: Privy account + secrets, Split contract deployment, Coinbase Commerce transfer intent handling, outbound topups state machine, tx simulation + broadcast, OpenRouter charge creation API. That is a **massive** per-node deployment burden. Most AI projects won't do it.

### Option C: Protocol-level bridge via utility token

```
AI Project (Node)
  └→ Users deposit USDC → Protocol mints COGNI tokens
  └→ Node checks token balance, serves AI requests
  └→ Node reports usage (signed off-chain receipts)
  └→ Protocol treasury settles with OpenRouter in bulk
```

**Pros:** Nodes are lightweight. Bridge is shared infrastructure built once. Credits are portable across nodes. DAO margin enforced at protocol level.
**Cons:** Requires building and deploying the token protocol. Off-chain usage reporting needs a trust/dispute model.

---

## Industry Context

See "The Landscape Is Moving Fast" section above for the detailed market survey, x402 analysis, deployed token precedents, and the sovereignty warning about Coinbase-controlled payment rails.

---

## Analysis: Does a Utility Token Materially Simplify This?

### What DB Credits Currently Require (Per Node)

Every Cogni node today must run:

| Component | Purpose | Can it be shared? |
|-----------|---------|-------------------|
| `billing_accounts` table | Track who has credits | No — per-node DB |
| `credit_ledger` table | Mint/burn credits | No — per-node DB |
| `charge_receipts` table | Audit trail | No — per-node DB |
| `payment_attempts` table | Inbound USDC state machine | No — per-node DB |
| LiteLLM proxy | Cost oracle + routing | Could be shared, but per-node for sovereignty |
| Pricing logic (`pricing.ts`) | Markup calculation | Shared code, per-node execution |
| On-chain verifier | Verify USDC transfers | Shared code, per-node execution |

Plus, if the node owns the OpenRouter bridge (Option B), add:
| `outbound_topups` table | OpenRouter top-up state machine | No — per-node DB |
| Operator wallet (Privy) | Sign outbound txs | No — per-node secrets |
| Coinbase Commerce integration | Transfer intent handling | Shared code, per-node execution |
| Split contract | DAO share distribution | Per-node on-chain deployment |

**That's 11 financial subsystems per node.** Most AI projects will look at this and walk away.

### What a Utility Token Protocol Would Replace

If COGNI is an ERC-20 on Base:

**On-chain (built once, shared by all nodes):**

| Component | What It Does |
|-----------|-------------|
| COGNI token contract | ERC-20 on Base. Mint on USDC deposit, burn on usage settlement. |
| Deposit contract | User sends USDC → mints COGNI at rate that bakes in DAO margin. E.g., 1 USDC → 0.875 COGNI-worth of AI credits (DAO keeps 12.5%). |
| Settlement contract | Accepts signed usage reports from nodes → burns COGNI → releases USDC to provider treasury. |
| Provider treasury | Multi-sig or automated: aggregates USDC, tops up OpenRouter periodically (one Coinbase Commerce integration for the whole network). |

**Per-node (much lighter):**

| Component | What It Does |
|-----------|-------------|
| Token balance check | Read COGNI balance before serving request (one RPC call) |
| Off-chain usage tracking | Same as current `charge_receipts` — but against token balance, not DB balance |
| Signed usage reports | Node signs usage attestations, submits to settlement contract periodically |

**What disappears per-node:**
- `billing_accounts` table → replaced by token balance
- `credit_ledger` table → replaced by on-chain mint/burn events
- `payment_attempts` table → replaced by deposit contract events
- Operator wallet → moved to protocol level
- Coinbase Commerce integration → moved to protocol level
- Split contract → DAO margin baked into mint ratio
- Outbound topups state machine → replaced by bulk settlement

**Net: 11 subsystems → 3 per node.** The other 8 move to the protocol level where they're built once.

### The Hybrid Reality: On-Chain Deposits, Off-Chain Metering

You can't burn a token per AI request — gas costs would exceed the request cost. The practical model:

```
DEPOSIT (infrequent, on-chain):
  User sends USDC → Deposit contract mints COGNI tokens
  DAO margin taken at mint time (e.g., 1 USDC = 8,750,000 COGNI at 10M/USD with 12.5% margin)

USAGE (frequent, off-chain):
  Node reads user's COGNI balance (RPC or cached)
  Node serves AI request via LiteLLM
  Node records usage locally (same charge_receipts pattern)
  Node decrements local balance shadow (optimistic)

SETTLEMENT (periodic, on-chain):
  Node submits signed usage report: "user X consumed Y COGNI worth of AI"
  Settlement contract verifies signature, burns user's COGNI
  Released USDC accumulates in provider treasury
  Treasury tops up OpenRouter when threshold met

  Settlement frequency: daily, or when accumulated usage > $X
```

This is essentially **the same off-chain metering Cogni already does**, but with the credit balance living on-chain instead of in a per-node database. The critical difference: it's **portable and verifiable** across nodes.

---

## How an AI Project Becomes a Cogni Node

### With DB Credits (Current)

1. Fork the node-template repo
2. Deploy the full Next.js app + PostgreSQL + LiteLLM stack
3. Deploy DAO smart contracts (Aragon)
4. Set up Privy account for operator wallet
5. Deploy Split contract on Base
6. Configure OpenRouter account + Coinbase Commerce
7. Set up all env vars (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY, OPENROUTER_API_KEY, LITELLM_MASTER_KEY, etc.)
8. Run migrations for 6+ billing tables
9. Configure repo-spec.yaml with all addresses

**Time to first AI request paid with crypto: weeks.**

### With Token Protocol

1. Fork the node-template repo (lighter — no billing tables needed)
2. Deploy the Next.js app + LiteLLM stack (no PostgreSQL billing schema)
3. Deploy DAO smart contracts (Aragon) — or join existing COGNI protocol
4. Point node at the COGNI token contract address in repo-spec
5. Set up LiteLLM with provider API keys
6. Register node with settlement contract (node signs usage reports)

No Privy. No Split contract. No Coinbase Commerce. No outbound topups. No operator wallet.

**Time to first AI request paid with crypto: days.** The protocol handles the USDC→OpenRouter bridge.

---

## The Node vs Operator Contract: Revised

### Current Spec Says (node-operator-contract.md)

> "AI Inference Billing: Node-run inference: Node owns provider keys and pays directly."

This is aspirational but impractical today — "pays directly" implies the node has its own crypto→provider bridge, which is the heavyweight Option B.

### Proposed Revision

| Layer | Responsibility | Owner |
|-------|---------------|-------|
| **Token protocol** | USDC deposits, COGNI minting, DAO margin, provider settlement | Protocol (shared infrastructure) |
| **Node** | AI request routing (LiteLLM), usage metering, signed usage reports | Node (sovereign) |
| **Operator** | Node registry, git-review, git-admin, cred scoring | Operator (optional services) |

**Key insight:** The token protocol is *neither* node nor operator. It's **shared protocol infrastructure** — like Aragon is shared DAO infrastructure. No single node or operator controls it. This preserves sovereignty while solving the bridge problem.

The Operator's role becomes exactly what the current spec already describes — governance services, not financial intermediation:
- git-review-daemon (PR reviews)
- git-admin-daemon (repo actions)
- cognicred (contributor scoring)
- Node registry (federation)

The Operator never touches money. The protocol handles money. Nodes handle AI.

---

## What's the Minimum Viable Token Protocol?

Fighting over-engineering — here's the absolute minimum:

### Smart Contracts (Base mainnet)

1. **CogniCredit.sol** — ERC-20 token. Mint/burn authority restricted to Deposit and Settlement contracts.
2. **CogniDeposit.sol** — Accepts USDC, mints COGNI at configured rate (with DAO margin). Emits `Deposit(user, usdcAmount, cogniAmount)`.
3. **CogniSettlement.sol** — Accepts signed usage reports from registered nodes. Verifies signatures, burns user COGNI, transfers USDC from treasury to provider wallet. Emits `Settlement(node, user, cogniAmount, usdcAmount)`.

That's 3 contracts. No governance token, no staking, no slashing, no validator set. Just mint, meter, settle.

### Off-Chain (Per Node)

Same LiteLLM + charge_receipts pattern, but:
- Balance check reads from chain (with local cache + optimistic decrement)
- Usage reports are signed and submitted to settlement contract
- No inbound payment state machine needed (deposit contract handles it)
- No outbound payment state machine needed (settlement contract handles it)

### Provider Treasury

One multi-sig wallet that:
- Receives USDC from settlement contract
- Tops up OpenRouter when balance exceeds threshold
- This is the ONE place Coinbase Commerce integration lives (built once, not per-node)

### What Stays From Current Spec

| Keep | Why |
|------|-----|
| `charge_receipts` pattern | Off-chain usage metering per node (same schema, lighter) |
| LiteLLM as cost oracle | Core routing + pricing value |
| `CREDIT_UNIT_STANDARD` (1 credit = $0.0000001) | Token denomination matches existing standard |
| `calculateLlmUserCharge()` | Same billing math, used for usage reports |
| `LITELLM_COST_ORACLE` invariant | LiteLLM computes cost, node reports it |
| Preflight balance check | Now reads token balance instead of DB balance |

### What Gets Deleted

| Delete | Why |
|--------|-----|
| `billing_accounts` table (balance tracking) | Token balance IS the balance |
| `credit_ledger` table | On-chain mint/burn events ARE the ledger |
| `payment_attempts` table | Deposit contract handles inbound |
| `outbound_topups` table | Settlement contract handles outbound |
| `operator-wallet.md` spec | No per-node operator wallet |
| `web3-openrouter-payments.md` spec | Bridge moves to protocol level |
| Split contract per node | DAO margin in mint ratio |
| Privy integration per node | No per-node signing needed |
| Coinbase Commerce per node | One integration at protocol treasury level |

---

## Evolution Path: Phased Approach

### Phase 0 (Now): Ship with the current spec, but scoped correctly

The current billing DB approach works for the first node (Cogni itself). Don't block shipping on a token protocol. But:
- **Acknowledge** that the current outbound payment spec is for Cogni-the-first-node, not the node template
- **Don't pretend** every new node will replicate the full Privy + Coinbase Commerce + Splits stack
- **Isolate** the bridge code so it can be extracted later

### Phase 1: Token protocol design + first contract

- Design the 3-contract system (CogniCredit, CogniDeposit, CogniSettlement)
- Study Akash BME (AEP-76) and Render BME as reference architectures — they're closest to what COGNI needs
- Deploy on Base testnet
- Cogni's own node becomes the first settlement reporter
- Provider treasury tops up OpenRouter (same Coinbase Commerce flow, but centralized in one place)

### Phase 2: Second node onboards via token protocol

- New AI project forks node-template (lighter version — no billing DB)
- Registers as a settlement reporter
- Users deposit USDC → get COGNI → use AI on the new node
- Settlement flows through the shared protocol treasury

### Phase 3: x402 native payment rail

x402 is closer than expected — 156K weekly txs, Stripe/Visa/Cloudflare backing, ~$0.0001/tx on Base. When frontier AI providers (Anthropic, OpenAI) adopt x402:
- Nodes pay providers directly per-request in USDC (HTTP 402 → payment → response)
- Protocol treasury becomes optional for x402-enabled providers
- COGNI token becomes a governance/metering token rather than a payment bridge
- Full sovereignty achieved: no intermediary at all

**Decision point:** Should Cogni implement x402 for its OWN gateway (letting agents pay per-request to Cogni nodes in USDC)? This would make Cogni nodes x402-compatible servers, which is a much cleaner protocol fit than the current credit-purchase-then-consume model.

### Sovereignty consideration for Phase 3

BlueMatt's warning (Feb 25 2026): x402 is Coinbase infrastructure (USDC + Base + facilitator). Lightning L402 is the truly permissionless alternative. A DAO protocol should consider supporting both rails:
- **x402** for ecosystem compatibility (Stripe, Visa, mainstream adoption)
- **L402** for sovereignty (permissionless, Bitcoin-native, no Coinbase dependency)

---

## Risk Assessment: Token Protocol

| Risk | Severity | Mitigation |
|------|----------|------------|
| Smart contract bugs | High | Audit before mainnet. Start with capped deposits. |
| Off-chain usage report fraud | Medium | Economic: nodes stake COGNI to report. Slash on dispute. (Add later, not MVP.) |
| Gas costs for settlement | Low | Batch settlements. Base L2 is cheap (~$0.001/tx). |
| Token regulatory classification | Medium | Utility token (metering, not investment). No secondary market needed — COGNI is burned, not traded. |
| x402 makes token protocol obsolete | Low-Medium | If x402 adoption is fast enough, COGNI token becomes governance-only (not payment-bridging). Design for this: token protocol should be modular enough that the settlement layer can be swapped for x402 direct payment. |
| Coinbase dependency via x402/Base/USDC | Medium | BlueMatt's point: x402 is Coinbase-controlled. Support L402 (Lightning) as permissionless fallback. Design settlement contract to accept multiple payment proofs. |
| Complexity of building contracts | Medium | 3 simple contracts. No governance, staking, or AMM. Simpler than the current Privy + Splits + Coinbase Commerce stack. |
| OpenRouter changes crypto API | Medium | Same risk exists today. Protocol treasury is a single point to update, vs updating every node. |

---

## Recommendation

1. **Ship Phase 0** with current billing DB for Cogni's own node. Don't block on token protocol.
2. **Isolate the bridge** — the operator wallet + OpenRouter top-up code should live in a clearly separated module, not spread across the node template.
3. **Design the token protocol** as the answer to "how does a second node onboard?" — not as a theoretical future, but as the concrete next architecture milestone. Study Akash BME (AEP-76) and Render BME as the closest reference architectures.
4. **The token replaces the DB credit system**, not supplements it. 1 COGNI = 1 credit = $0.0000001. Same unit standard, on-chain instead of in-DB.
5. **Provider settlement is protocol-level**, not per-node. One Coinbase Commerce integration in the protocol treasury, not one per node.
6. **Build for x402 compatibility.** x402 is further along than expected (156K weekly txs, Stripe/Visa backing). Design the settlement layer so it can be swapped for x402 direct payment when providers adopt it. Cogni nodes should themselves be x402-compatible servers — let agents pay per-request in USDC rather than pre-purchasing credits.
7. **Support dual payment rails** for sovereignty: x402 (USDC/Base) for mainstream compatibility, L402 (Lightning) for permissionless fallback. Don't lock into Coinbase-controlled infrastructure as the only option.

The cleanest definition:
- **Protocol** = the crypto→AI payment bridge (token contracts + provider settlement)
- **Node** = sovereign AI service (LiteLLM routing + usage metering + DAO governance)
- **Operator** = optional platform services (git-review, cred scoring, node registry)

Each layer does one thing. No layer does another layer's job.

---

## Sources

- [x402 Protocol — Coinbase Developer Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf)
- [Stripe x402 on Base (2026)](https://crypto.news/stripe-taps-base-ai-agent-x402-payment-protocol-2026/)
- [Hyperbolic x402 Crypto Payments](https://www.hyperbolic.ai/blog/pay-for-gpu-and-ai-inference-models-with-crypto)
- [BlueMatt — Open Source AI Needs Serious Payments (Feb 25, 2026)](https://bluematt.bitcoin.ninja/2026/02/25/open-source-ai-needs-to-get-serious/)
- [Lightning Labs AI Agent Tools (Feb 2026)](https://lightning.engineering/posts/2026-02-11-ln-agent-tools/)
- [Akash BME Proposal (AEP-76)](https://akash.network/roadmap/aep-76/)
- [Render BME Documentation](https://know.rendernetwork.com/basics/burn-mint-equilibrium)
- [Venice AI — DIEM Token](https://venice.ai/blog/introducing-diem-as-tokenized-intelligence-the-next-evolution-of-vvv)
- [Bittensor Dynamic TAO](https://docs.learnbittensor.org/subnets/understanding-subnets)
- [CoinGecko — AI Agent Payment Infrastructure](https://www.coingecko.com/learn/ai-agent-payment-infrastructure-crypto-and-big-tech)
- [OpenRouter Crypto API](https://openrouter.ai/docs/guides/guides/crypto-api)
- [Chainalysis — AI and Crypto Convergence](https://www.chainalysis.com/blog/ai-and-crypto-agentic-payments/)
