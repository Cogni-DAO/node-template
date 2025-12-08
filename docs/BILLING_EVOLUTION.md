# Billing Evolution: Dual-Cost Accounting Implementation

Extends the accounts system defined in [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md) with profit-enforcing billing and provider cost tracking.

**Stage 6.5 applies after the Auth.js + billing_accounts + virtual_keys MVP is in place; it does not change auth, only how we compute and store costs for each LLM call.**

**Context:**

- System architecture: [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md)
- API contracts: [ACCOUNTS_API_KEY_ENDPOINTS.md](ACCOUNTS_API_KEY_ENDPOINTS.md)
- Wallet integration: [INTEGRATION_WALLETS_CREDITS.md](INTEGRATION_WALLETS_CREDITS.md)
- Payments (MVP funding): [DEPAY_PAYMENTS.md](DEPAY_PAYMENTS.md)
- Usage Activity Metrics: [ACTIVITY_METRICS.md](ACTIVITY_METRICS.md)

---

## Stage 6.5 – Dual-Cost Accounting & Profit Margin

**Core Goal:** Per LLM call, use LiteLLM's response cost (USD) as provider cost oracle, convert to credits, apply markup, enforce `user_price_credits ≥ provider_cost_credits`, and atomically record both with a debit.

**Credit Unit Standard:**

- 1 credit = $0.001 USD
- 1 USDC = 1,000 credits
- All balances stored as BIGINT integers
- Default markup: 2.0× (100% markup = 50% margin)

**Provider Cost Source:**

- LiteLLM computes per-request cost and exposes it as a per-call "response cost" in USD
- Our code converts that USD cost → `provider_cost_credits` → `user_price_credits`
- We do not maintain hardcoded per-model USD pricing tables; LiteLLM's pricing map is the canonical source
- Token counts and model metadata are stored for audit/analysis only, not for cost calculation

Credits increase via positive entries in credit_ledger (e.g., from the widget confirm endpoint or future webhooks/admin tools).

---

### 6.5.1 Migrate Credits to Integer Units

- [x] **Goal:** Change billing_accounts.balance_credits and credit_ledger.amount to BIGINT, reset balances to 0 for pre-launch clean slate.

- **Files:**
  - [x] `src/shared/db/migrations/*_integer_credits.sql` - ALTER TABLE to BIGINT, reset to 0
  - [x] `src/shared/db/schema.ts` - Update type definitions to BIGINT

**Notes:**

- Pre-launch reset acceptable (no real user funds exist yet)
- Update test fixtures to use integer credit values

---

### 6.5.2 Charge Receipt Table

**Table name:** `charge_receipt` (physical table currently `llm_usage` in schema.billing.ts, will be renamed)

**Goal:** Minimal audit-focused charge receipt table. LiteLLM is canonical for telemetry.

**Schema:** request_id (text PRIMARY KEY), billing_account_id, virtual_key_id, litellm_call_id (nullable), charged_credits (bigint NOT NULL), response_cost_usd (decimal nullable), provenance (text NOT NULL), created_at

**Cost Derivation (single path):**

- If `x-litellm-response-cost` header present → use it (non-streaming only)
- Else if stream `usage.cost` present → use it (requires `litellm_settings.include_cost_in_streaming_usage: true`)
- Else → `response_cost_usd = null`, `charged_credits = 0`, log CRITICAL (degraded under-billing mode)

**MVP Tasks:**

- [ ] Rename table: `llm_usage` → `charge_receipt` (migration + schema update)
- [x] Verify table exists in all environments (dev, test, stack)
- [x] Enable LiteLLM cost tracking - Added `include_cost_in_streaming_usage: true` to litellm.config.yaml
- [x] Verify `recordChargeReceipt` writes exactly one row per non-free completion

---

### 6.5.3 Environment Configuration

- [x] **Goal:** Configure markup factor and credit unit conversion via environment variables.

- **Variables:**
  - [x] `USER_PRICE_MARKUP_FACTOR=2.0` - Profit markup (2.0 = 50% margin)
  - [x] `CREDITS_PER_USD=10_000_000` - Protocol constant in `src/core/billing/pricing.ts`

- **Files:**
  - [x] `.env.example` - Add both variables
  - [x] `src/shared/env/server.ts` - Add Zod validation (min/max ranges)

---

### 6.5.4 Pricing Helpers

- [x] **Goal:** Provide pure conversion functions for USD → credits and markup application.

**Responsibilities:**

- `usdToCredits(usd, creditsPerUsd)`: Convert USD cost to BIGINT credits using provided conversion rate (Math.ceil)
- `calculateUserPriceCredits(providerCostCredits, markupFactor)`: Apply markup to CREDITS and round up (Math.ceil)

- **Files:**
  - [x] `src/core/billing/pricing.ts` - Conversion helpers
  - [x] `tests/unit/core/billing/pricing.test.ts` - Test conversions and rounding

**Constraints:**

- These helpers do NOT contain model-specific pricing data
- All USD costs come from LiteLLM's response, not computed locally
- Conversion rate is passed as parameter to maintain core layer purity (no env dependencies)

---

### 6.5.5 Atomic Billing Operation (Non-Blocking Post-Call)

- [x] **Goal:** Single AccountService method that records charge receipt and debits credits atomically, but NEVER blocks post-call.

- [x] **New Port Method:** `recordChargeReceipt(ChargeReceiptParams)` with minimal fields: billingAccountId, virtualKeyId, requestId, chargedCredits, responseCostUsd, litellmCallId, provenance

**Parameters:** `chargedCredits` is pre-computed by completion service using LiteLLM response cost and pricing helpers. No pricing logic in adapter.

**Implementation:** Single DB transaction that:

1. Inserts llm_usage (charge receipt) row with idempotent ON CONFLICT DO NOTHING
2. Inserts credit_ledger debit row (amount = -chargedCredits)
3. Updates billing_accounts.balance_credits
4. Logs critical if balance goes negative but COMPLETES the write (no rollback)

**Key Invariant (per ACTIVITY_METRICS.md):** Post-call billing NEVER throws InsufficientCreditsPortError. Overage is handled in reconciliation, not by blocking user response.

- **Files:**
  - [x] `src/ports/accounts.port.ts` - recordChargeReceipt interface (ChargeReceiptParams)
  - [x] `src/adapters/server/accounts/drizzle.adapter.ts` - Implement non-blocking atomic operation
  - [x] `tests/unit/adapters/server/accounts/drizzle.adapter.spec.ts` - Test transaction behavior

**Notes:**

- Pre-flight gating uses `getBalance` + estimate before LLM call
- Post-call `recordChargeReceipt` is best-effort, never blocks response

---

### 6.5.6 Wire Charge Receipts into Completion Flow

- [x] **Goal:** Update completion service to calculate chargedCredits and call recordChargeReceipt after LLM call using LiteLLM-as-oracle cost derivation.

**Cost Derivation Algorithm (Single Path):**

Given `providerCostUsd` from LiteLLM (header or usage event, may be undefined):

- **If cost present**: Calculate `chargedCredits = usdToCredits(providerCostUsd) × markup`, set `responseCostUsd = providerCostUsd`
- **If cost missing**: Set `chargedCredits = 0n`, `responseCostUsd = null`, log CRITICAL alert
- **Always write receipt atomically** (even if cost is null, for audit trail)

**Hard Dependency:** LiteLLM must emit cost via `x-litellm-response-cost` header or final usage event. When cost is missing:

- Receipt written with `response_cost_usd = null` and `charged_credits = 0`
- CRITICAL alert logged for ops visibility
- Reconciliation process must flag underbilled requests
- NO fallback to token-based cost calculation (forbidden per ACTIVITY_METRICS.md §3)

**Flow:**

1. **Pre-flight** (blocking): estimate cost, check balance, DENY if insufficient (InsufficientCreditsPortError)
2. **Call LiteLLM** via LlmService
3. **Extract cost** (priority order per ACTIVITY_METRICS.md §3):
   - From `x-litellm-response-cost` header
   - OR from final `usage.cost` event (streams with `include_usage: true`)
   - OR null if neither present
4. **Calculate chargedCredits** per algorithm above (may be 0 if cost missing)
5. **Write atomically**: Call `AccountService.recordChargeReceipt` (non-blocking, never throws InsufficientCreditsPortError)
6. **Return response** to user (NEVER blocked by post-call billing)

- **Files:**
  - [x] `src/ports/llm.port.ts` - LlmService response includes providerCostUsd, litellmCallId
  - [x] `src/adapters/server/ai/litellm.adapter.ts` - Extract cost from headers (non-stream) + usage.cost (stream)
  - [x] `src/features/ai/services/completion.ts` - Preflight gating + non-blocking post-call billing
  - [x] completion.ts has CRITICAL alert when providerCostUsd is undefined (line 250-261)
  - [ ] **GAP**: No test coverage for cost=null path (header + usage event both missing)

**Design:** Pre-call uses conservative estimate. Post-call uses actual LiteLLM cost. If cost is missing, log CRITICAL and write $0 receipt for later reconciliation. See ACTIVITY_METRICS.md §3.

---

### 6.5.7 Documentation Updates

- [x] **Goal:** Document charge receipt model and point to ACTIVITY_METRICS.md as canonical design.

- **Updates:**
  - [x] `docs/ACTIVITY_METRICS.md` - Canonical design doc for minimal charge receipts, LiteLLM-as-canonical telemetry
  - [x] `docs/BILLING_EVOLUTION.md` - Updated Stage 6.5 to reflect charge_receipt model
  - [ ] `docs/ACCOUNTS_DESIGN.md` - Update Credits DOWN section to reference recordChargeReceipt
  - [ ] `docs/ACCOUNTS_API_KEY_ENDPOINTS.md` - Update completion flow to mention recordChargeReceipt

**Canonical Reference:** See `docs/ACTIVITY_METRICS.md` for full design rationale and invariants.

---

## Current Status (2025-12-08)

**Billing flow operational. Charges writing to DB. Activity metrics page shows zeros (not investigated).**

**Complete:**

- [x] LiteLLM streaming cost via `include_cost_in_streaming_usage: true` (litellm.config.yaml)
- [x] Protocol constant `CREDITS_PER_USD = 10_000_000` in src/core/billing/pricing.ts
- [x] Single source of truth: `calculateLlmUserCharge()` with markup-before-ceil
- [x] `response_cost_usd` stores user cost (with markup), not provider cost
- [x] Adapter hasCost logging fixed (litellm.adapter.ts:464)

**Test verification:** Provider $0.0006261 → User $0.0012522 → 12522 credits in DB

**Incomplete:**

- [ ] Rename `llm_usage` → `charge_receipt`
- [x] Remove deprecated `CREDITS_PER_USDC` env var
- [ ] Integration test: paid completion → assert DB values
- [ ] Activity metrics page investigation (shows zeros)

---

## MVP Implementation Plan

### Priority 1: Enable LiteLLM Cost Tracking ✅ COMPLETE

- [x] Investigate LiteLLM config (YAML + env vars) for cost tracking settings
- [x] Verify OpenRouter API returns cost data (via LiteLLM `/spend/logs`)
- [x] Enable cost passthrough in LiteLLM proxy - `include_cost_in_streaming_usage: true`
- [x] Test: trigger paid completion → cost appears in stream `usage.cost` field
- [x] Test: query LiteLLM `/spend/logs` → cost field populated

### Priority 2: Enforce Billing Invariants

- [x] Add CRITICAL log in completion.ts when `providerCostUsd === undefined` (line 250-261)
- [ ] Rename table: `llm_usage` → `charge_receipt` (migration + schema)
- [ ] Verify 1:1 linkage: each charge_receipt.request_id matches exactly one credit_ledger.reference
- [ ] Add integration test: paid completion → assert charge_receipt + ledger both have request_id, charged_credits > 0

### Priority 3: Activity Dashboard Integration

- [ ] Verify Activity endpoint reads from LiteLLM `/spend/logs` (telemetry)
- [ ] Verify Activity endpoint shows charged_credits from local charge_receipt (billing view)
- [ ] Test: UI displays non-zero spend after P1 fix completes

---

## Stage 7 – On-Chain Watcher & Reconciliation (Ponder, Post-MVP)

- [ ] **Goal:** Introduce a separate on-chain indexer (Ponder) that watches the DAO wallet on Base/Base Sepolia for USDC transfers and provides an independent view of funds received for reconciliation and fraud detection.

**MVP Status:** NOT used in the crediting critical path. MVP credits are granted via `POST /api/v1/payments/credits/confirm` (session-authenticated; see `docs/DEPAY_PAYMENTS.md`). Ponder is initially used for observability and reconciliation only.

**High-Level Behavior:**

1. **Indexing:** Ponder runs as a separate Docker service, connects to Base/Base Sepolia RPC, and indexes ERC20 Transfer events for USDC into the DAO wallet address.
2. **Storage:** For each confirmed transfer (after N block confirmations), Ponder writes `{ tx_hash, chain_id, from, to, token_contract, amount, block_number, timestamp }` to its own Postgres database in an `onchain_payments` table.
3. **Reconciliation (Phase 1, Post-MVP):** Our app periodically queries Ponder (via GraphQL/SQL/HTTP) to compare `onchain_payments` totals vs `credit_ledger` rows where `reason IN ('widget_payment', 'onchain_deposit')`. Discrepancies are logged and surfaced to ops; no automatic blocking.
4. **Stronger Guarantees (Phase 2, Future):** For large payments or high-risk accounts, require a matching `onchain_payments` row before marking credits as fully settled (will require capturing tx_hash on the frontend, provided by DePay widget).

**Implementation Details:** Runtime topology, Ponder indexing configuration, integration phases, and security model are defined in `docs/PAYMENTS_PONDER_VERIFICATION.md`.

**Reference:** See `docs/PAYMENTS_PONDER_VERIFICATION.md` for full Ponder spec.

---

## Future Work

**Deferred beyond MVP:**

- Pre-call max-cost estimation and 402 without calling LLM
- Reconciliation scripts and monitoring dashboards
- credit_holds table for soft reservations

---

## Success Criteria

**Invariants:**

- 1 credit = $0.0000001 (protocol constant `CREDITS_PER_USD = 10_000_000`)
- `response_cost_usd` stores user cost (with markup), not provider cost
- Single ceil at end: `chargedCredits = ceil(userCostUsd × CREDITS_PER_USD)`
- Post-call billing NEVER blocks user response
- `llm_usage.request_id` = `credit_ledger.reference` (1:1 linkage)

**Verification:**

- SQL shows user-facing values: `SELECT charged_credits, response_cost_usd FROM llm_usage`
- Cost source: LiteLLM `usage.cost` (stream) or `x-litellm-response-cost` header (non-stream)
- Forensic: `llm_usage.litellm_call_id` joins with LiteLLM `/spend/logs`

---

## Known Issues

- [ ] **Activity reporting of billing doesn't work.** Activity metrics page shows zeros despite real usage. Not investigated.
- [ ] **Cents sprawl across codebase.** 126+ references to "cents" in payment flows. Should standardize on USD only. Credits are canonical ledger unit; cents is unnecessary intermediate format causing conversion sprawl and dual-scale bugs. All money→credits conversions should use `usdToCredits()`. Need to quarantine cents at API boundary and use USD internally.
- [ ] **Pre-call estimate too conservative.** Uses `ESTIMATED_USD_PER_1K_TOKENS = $0.002` as upper-bound. User with $5 balance cannot make paid LLM call (estimate requires ~$0.93). Should reduce estimate or document that it's intentionally conservative to prevent underbilling.
