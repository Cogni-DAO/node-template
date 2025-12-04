# Activity Metrics Design

> [!CRITICAL]
> LiteLLM is the canonical source for usage telemetry. Our DB stores only charge receipts for billing audit.

## Implementation Checklist

### P0: Kill Shadow Metering

- [ ] Delete any code parsing stream chunks for model/tokens/provider
- [ ] Remove cost recomputation logic (trust x-litellm-response-cost)
- [ ] Simplify llm_usage table to charge_receipt (drop telemetry columns)
- [ ] Update recordLlmUsage port to recordChargeReceipt (minimal fields)

### P1: Implement LiteLLM Adapter

- [ ] Create `src/adapters/server/ai/litellm.usage.adapter.ts`
- [ ] Chart: `GET /spend/logs?user_id=X&summarize=true` (LiteLLM pre-aggregates)
- [ ] Table: `GET /spend/logs?user_id=X&summarize=false` (paginated, max 100/request)
- [ ] Add bounded pagination (MAX_PAGES circuit breaker)
- [ ] Map LiteLLM log schema → UsageService port types

### P1: Refactor Activity Service

- [ ] Primary/fallback: try LiteLLM, catch → degraded receipts-only
- [ ] Add `telemetrySource: "litellm" | "fallback"` to contract output

### P2: Long-Term Hedge (Only If Needed)

- [ ] Monitor LiteLLM data retention (check if logs disappear after N days)
- [ ] If retention < 90 days: implement periodic export job
- [ ] **Do NOT build this preemptively**

---

## Design Decisions

### 1. System of Record

| Data Type                                           | Canonical Source     | Our DB Role           |
| --------------------------------------------------- | -------------------- | --------------------- |
| **Usage telemetry** (model, provider, tokens, cost) | LiteLLM spend logs   | None (query upstream) |
| **Credit entitlements**                             | credit_ledger table  | Authoritative         |
| **Charge receipts**                                 | charge_receipt table | Immutable audit trail |

**Rule:** Never store model/provider/tokens in our DB as if they're canonical. Query LiteLLM.

---

### 2. Correlation Strategy

**Identity correlation (ALREADY IMPLEMENTED ✅):**

- We send `user: billingAccountId` (OpenAI API spec field)
- LiteLLM indexes all spend by user_id
- Query: `GET /spend/logs?user_id=<billingAccountId>` returns all activity for that billing account
- Aggregates across all virtual keys automatically

**Upstream correlation (recommended, not identity-scoping):**

- We capture `x-litellm-call-id` response header
- Store in charge receipt for dispute/incident correlation
- High forensic value, negligible complexity (nullable field)
- Not used for identity scoping (that's the `user` field)

---

### 3. Read Modes

**Chart:** `GET /spend/logs?user_id=X&summarize=true` (LiteLLM pre-aggregates by date)
**Table:** `GET /spend/logs?user_id=X&summarize=false&limit=100` (paginated logs)

**Fallback:** Query charge_receipt for cost + timestamps only. Return `{ model: "unavailable", tokens: 0, telemetrySource: "fallback" }`

**Pagination:** Bounded fetch (MAX_PAGES=10). Never trust "one query returns everything."

---

### 4. Charge Receipt Schema (Minimal)

**Allowed columns:**

- `request_id` (text, PRIMARY KEY) - Server-generated UUID (globally unique)
- `billing_account_id` (text, NOT NULL) - Server-controlled identity
- `litellm_call_id` (text, nullable) - Recommended for dispute/incident correlation (x-litellm-call-id header)
- `charged_credits` (bigint, NOT NULL) - Debited from credit_ledger
- `response_cost_usd` (decimal) - Observational (x-litellm-response-cost header)
- `provenance` (text) - `stream` | `response` | `reconciled`
- `created_at` (timestamptz, NOT NULL)

**Forbidden columns:**

- ❌ model, provider, finish_reason
- ❌ prompt_tokens, completion_tokens, total_tokens
- ❌ usage (JSONB)

**Why:** These fields live in LiteLLM. Storing them creates drift and wastes storage.

**Idempotency:** request_id as PRIMARY KEY prevents duplicate inserts. Use `INSERT ... ON CONFLICT (request_id) DO NOTHING`.

### 5. Reconciliation

- `sum(charge_receipt.response_cost_usd) ≈ sum(litellm.cost)` (±$0.01 per 100 requests)
- `charged_credits = response_cost_usd × MARKUP × CREDITS_PER_USD`

---

## Migration Path

### Phase 1: Validate Current State

1. Query LiteLLM: `GET /spend/logs?user_id=<testBillingAccountId>` manually
2. Verify it returns logs for all requests made with that billingAccountId as `user`
3. Verify spend matches what we charged to credit_ledger
4. **If yes → proceed. If no → investigate.**

### Phase 2: Implement LiteLLM Adapter

1. Verify reconciliation: `sum(litellm.cost) ≈ sum(receipt.response_cost_usd)` for test account
2. Create adapter with chart (summarize=true) and table (summarize=false) modes
3. Add bounded pagination (MAX_PAGES=10)
4. Enable with feature flag, monitor 48 hours

### Phase 3: Cut Over & Cleanup

1. Remove feature flag, make LiteLLM primary
2. Drop forbidden columns (model, provider, tokens, usage)
3. Rename llm_usage → charge_receipt

---

## Non-Negotiables

1. **Pagination is mandatory** - Never assume one query returns all data
2. **Fallback is mandatory** - Activity UX must work when LiteLLM is down
3. **No shadow metering** - Delete stream parsing, cost recomputation
4. **Server controls identity** - billingAccountId is server-derived, never client-provided

---

**Last Updated**: 2025-12-05
**Status**: Design Approved
