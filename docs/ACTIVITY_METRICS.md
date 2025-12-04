# Activity Metrics Design

> [!CRITICAL]
> LiteLLM is the canonical source for usage telemetry. Our DB stores only charge receipts for billing audit.

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

### 3. Activity API Architecture

**Primary data source:**

```
Activity API → LiteLLMUsageAdapter → GET /spend/logs?user_id=X&start_date=Y&end_date=Z&summarize=false
```

**Fallback (when LiteLLM unavailable):**

```
Activity API → DrizzleUsageAdapter → SELECT FROM charge_receipt WHERE billing_account_id = X
```

**Fallback output (degraded):**

- `chartSeries`: Buckets with `spend` (from charged_credits) and `timestamps` only
- `rows`: Array of `{ id, timestamp, cost, model: "unavailable", provider: "unavailable", tokensIn: 0, tokensOut: 0, finish: "unavailable" }`
- `telemetrySource: "fallback"`
- `dataLimited: true` - UI shows "Limited details (telemetry service unavailable)" banner

**Critical guardrail:** Implement bounded pagination in LiteLLMUsageAdapter. Large accounts can span multiple pages. LiteLLM has documented pagination/underreporting bugs. Never assume "one query returns everything."

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

---

## MVP Definition

**Write path:**

- `credit_ledger` (authoritative entitlements)
- `charge_receipt` table with minimal columns:
  - Identity: `request_id` (PK), `billing_account_id`
  - Correlation: `litellm_call_id` (recommended for disputes, nullable)
  - Billing: `charged_credits`, `response_cost_usd`, `provenance`, `created_at`
- No telemetry fields stored (no model/provider/tokens)

**Read path:**

- Activity API queries LiteLLM `/spend/logs?user_id=<billingAccountId>` with bounded pagination
- Fallback to charge receipts (degraded output) when LiteLLM unavailable
- Returns `telemetrySource` indicator

**Deletions:**

- Remove stream chunk parsing for model/tokens/provider
- Remove cost recomputation logic
- Remove any code treating llm_usage.usage JSONB as canonical telemetry

**Ships when:**

- Manual validation proves LiteLLM spend matches our credit_ledger charges
- Fallback mode tested (returns degraded data, not 500)
- No shadow metering codepaths remain

---

## Implementation Checklist

### P0: Kill Shadow Metering

- [ ] Delete any code parsing stream chunks for model/tokens/provider
- [ ] Remove cost recomputation logic (trust x-litellm-response-cost)
- [ ] Simplify llm_usage table to charge_receipt (drop telemetry columns)
- [ ] Update recordLlmUsage port to recordChargeReceipt (minimal fields)

### P1: Implement LiteLLM Adapter

- [ ] Create `src/adapters/server/ai/litellm.usage.adapter.ts`
- [ ] Implement: `GET /spend/logs?user_id=X&start_date=Y&end_date=Z&summarize=false`
- [ ] Add **bounded pagination** (fetch max N pages, abort if exceeded, warn user)
- [ ] Add response caching (5min TTL)
- [ ] Map LiteLLM log schema → UsageService port types

### P1: Refactor Activity Service

- [ ] Primary/fallback orchestration:
  ```
  try {
    return await litellmUsageAdapter.getUsageStats(params);
  } catch (error) {
    log.warn({ error }, "LiteLLM unavailable");
    return await chargeReceiptAdapter.getUsageStats(params);  // Degraded
  }
  ```
- [ ] Add `telemetrySource: "litellm" | "fallback"` to contract output

### P2: Long-Term Hedge (Only If Needed)

- [ ] Monitor LiteLLM data retention (check if logs disappear after N days)
- [ ] If retention < 90 days: implement periodic export job
- [ ] If export needed: add warehouse schema + reconciliation tests
- [ ] **Do NOT build this preemptively**

---

## Pagination Guardrails

**Problem:** LiteLLM has real-world pagination bugs and underreporting issues in usage views.

**Solution:** Bounded pagination with circuit breaker.

**Requirements:**

1. Fetch up to MAX_PAGES (e.g., 10) before aborting
2. Implement pagination based on actual LiteLLM response structure (verify API spec first)
3. If pagination limit exceeded, log error and return partial data with `dataIncomplete: true` flag
4. Never assume "one query returns everything" for large accounts

**Implementation:** Adapter must inspect `/spend/logs` response schema and implement cursor/offset/next-token pagination as appropriate. Do not hardcode limit/offset without verifying against running LiteLLM instance.

**Never trust "one query" for production billing data.**

---

## Testing Strategy

### Invariant Tests

1. **No shadow metering**: Code does not parse streams or recompute tokens/cost
2. **Identity correlation**: billingAccountId sent as `user` field, litellmCallId captured from headers
3. **Pagination handled**: Adapter fetches multiple pages if needed, aborts at MAX_PAGES
4. **Fallback works**: DrizzleUsageAdapter returns degraded data (receipts only) when LiteLLM fails
5. **Fallback is degraded**: Fallback output has `model: "unavailable"`, `tokens: 0`, `telemetrySource: "fallback"`
6. **Idempotency**: ON CONFLICT (request_id) DO NOTHING prevents double charge receipts

### Critical Stack Tests

- `activity-litellm-primary.stack.test.ts`: Verify Activity API queries LiteLLM first
- `activity-pagination.stack.test.ts`: Verify multi-page handling for large accounts
- `activity-fallback.stack.test.ts`: Verify degraded mode when LiteLLM unavailable
- `charge-receipt-idempotency.stack.test.ts`: Verify duplicate requests don't double-bill

---

## Migration Path

### Phase 1: Validate Current State

1. Query LiteLLM: `GET /spend/logs?user_id=<testBillingAccountId>` manually
2. Verify it returns logs for all requests made with that billingAccountId as `user`
3. Verify spend matches what we charged to credit_ledger
4. **If yes → proceed. If no → investigate.**

### Phase 2: Implement LiteLLM Adapter

1. Create adapter with pagination guardrails (based on actual API spec)
2. Manual validation: Query test billing account, verify spend matches credit_ledger
3. Add feature flag: `USE_LITELLM_FOR_ACTIVITY=true`
4. Enable in production, monitor for 48 hours

### Phase 3: Cut Over

1. If no errors in 48 hours, make LiteLLM primary (remove feature flag)
2. DB becomes fallback only
3. Monitor fallback frequency (should be <1%)

### Phase 4: Schema Cleanup

1. Drop forbidden columns from llm_usage table
2. Rename to charge_receipt
3. Remove shadow metering code

---

## Non-Negotiables

1. **Pagination is mandatory** - Never assume one query returns all data
2. **Fallback is mandatory** - Activity UX must work when LiteLLM is down
3. **No shadow metering** - Delete stream parsing, cost recomputation
4. **Server controls identity** - billingAccountId is server-derived, never client-provided

---

**Last Updated**: 2025-12-05
**Status**: Design Approved
