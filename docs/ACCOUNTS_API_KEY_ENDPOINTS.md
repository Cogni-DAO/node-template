# Accounts & LiteLLM Virtual Key Endpoints

**Purpose:** Document how Cogni-template provisions and uses LiteLLM virtual keys for billing accounts, and which LiteLLM HTTP endpoints we depend on now vs later.

**MVP uses master key mode:** All LiteLLM calls authenticate with `LITELLM_MASTER_KEY` from server environment. The `virtual_keys` table stores a sentinel value `[master-key-mode]` for referential integrity (FK constraints on `charge_receipts`), not real keys. User attribution for cost tracking is passed via `metadata.cogni_billing_account_id` in LiteLLM requests.

**Future:** User-facing API keys will use a `VirtualKeyManagementPort` to create real per-key LiteLLM virtual keys via `/key/generate`, with show-once semantics.

**Core loop:** Auth.js session → `users` → `billing_accounts` → `virtual_keys` (ID only) → LiteLLM `/chat/completions` (with master key + user attribution).

**Related:**

- Auth design: [SECURITY_AUTH_SPEC.md](SECURITY_AUTH_SPEC.md)
- Billing model: [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md)
- Billing evolution: [BILLING_EVOLUTION.md](BILLING_EVOLUTION.md)

---

## Core Concepts

- **Auth.js user** – Identity row in the Auth.js `users` table, created via SIWE (wallet login). Represents identity and session ownership.
- **Billing account** – Row in `billing_accounts` (our table). Represents a billing tenant and owns LiteLLM virtual keys. We differentiate tenants via separate virtual keys and our own `billing_accounts` + `credit_ledger` records.
- **LiteLLM Team** – (Future/Optional) LiteLLM's grouping concept for spend analytics. Not used in MVP; virtual keys are sufficient for authentication and per-account tracking.
- **Virtual key** – Row in `virtual_keys`. In MVP, stores sentinel `[master-key-mode]` (not a real key) plus flags (`is_default`, `active`, label, etc.). Exists for referential integrity with `charge_receipts`. Future: will store encrypted key references for user API keys.
- **LiteLLM master key** – The Proxy admin key (`LITELLM_MASTER_KEY`) used for all LiteLLM calls in MVP. Accessed only at the adapter boundary (`src/adapters/server/ai/litellm.adapter.ts`).
- **LlmCaller** – Internal type `{ billingAccountId; virtualKeyId }` constructed server-side for each call to LiteLLM. Contains only IDs, no secrets. The adapter reads `LITELLM_MASTER_KEY` from env.

**Invariant:** No per-user secrets flow through application layers. `LITELLM_MASTER_KEY` is accessed only at the adapter boundary. `virtual_keys` stores sentinels in MVP.

**See also:** [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md) "Three-Layer Identity System" for complete architecture.

---

## LiteLLM Endpoints Used in MVP

We run the LiteLLM Proxy with a Postgres DB and `LITELLM_MASTER_KEY` as described in the **LiteLLM Getting Started guide** (Docker + `config.yaml`).

**Official Docs:** https://docs.litellm.ai/docs/

### 1. Chat Completions (Data Plane)

- [x] **Endpoint:** `POST /chat/completions`
- [x] **Auth:** `Authorization: Bearer <LITELLM_MASTER_KEY>` (master key mode in MVP)
- [x] **User Attribution:** `metadata.cogni_billing_account_id` in request body
- [x] **Docs:** [LiteLLM Getting Started](https://docs.litellm.ai/docs/), section "Make a successful /chat/completion call"

Cogni-template calls this endpoint from our `LlmService` adapter using `LITELLM_MASTER_KEY` from environment. User attribution for cost tracking is passed via `metadata.cogni_billing_account_id`. We extract `x-litellm-response-cost` and `x-litellm-call-id` headers for billing. LiteLLM is canonical for usage telemetry; we store only minimal charge receipts locally.

### 2. Virtual Key Generation (Control Plane) - **NOT USED IN MVP**

- [ ] **Endpoint:** `POST /key/generate`
- [ ] **Auth:** `Authorization: Bearer <LITELLM_MASTER_KEY>`
- [ ] **Docs:** [LiteLLM Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys)

**MVP does NOT call `/key/generate`.** All LLM calls use `LITELLM_MASTER_KEY` directly. The `virtual_keys` table stores a sentinel value for referential integrity.

**Future (User API Keys):** When we ship user-facing API keys, a `VirtualKeyManagementPort` will call `/key/generate` to create real per-key LiteLLM virtual keys with show-once semantics.

---

## MVP Internal Provisioning Flow (Master Key Mode)

In the Auth.js + SIWE design, **MVP does not expose any account/key management HTTP endpoints**. All provisioning happens inside a single helper:

- **Module:** `src/lib/auth/mapping.ts`
- **Function:** `getOrCreateBillingAccountForUser(user)`

**MVP behavior:**

1. **Input:** Auth.js `user` object (from `auth()`), which includes the wallet address from SIWE.
2. **Look up** existing `billing_accounts` row where `owner_user_id = user.id`.
3. **If none exists:**
   - Create a new `billing_accounts` row:
     - `owner_user_id = user.id`
     - `balance_credits = 0`
   - Insert a `virtual_keys` row with sentinel value:
     - `billing_account_id = billing_accounts.id`
     - `litellm_virtual_key = '[master-key-mode]'` (sentinel, not a real key)
     - `is_default = true`, `active = true`, `label = 'Default'`
   - **No LiteLLM `/key/generate` call** - all calls use master key
4. **Return:** `{ billingAccountId, defaultVirtualKeyId }` (no key string - master key mode)

From this point on, all LLM calls for this user use `LITELLM_MASTER_KEY` with `billingAccountId` in metadata for cost attribution.

**Credit top-ups (MVP):** Real user funding currently enters the system via `POST /api/v1/payments/credits/confirm` (session-based), which writes positive `credit_ledger` rows with `reason='widget_payment'` and updates `billing_accounts.balance_credits`. The endpoint resolves `billing_account_id` from the SIWE session (not from request body). The payment widget (DePay) is a frontend-only SDK; it does not send a webhook or signed callback. The client calls the confirm endpoint after the widget's success callback fires in the browser. Dev/test environments can seed credits directly via database fixtures or scripts. Post-MVP, a Ponder-based on-chain watcher will provide reconciliation and observability for payments; see `docs/PAYMENTS_PONDER_VERIFICATION.md`.

---

## Our HTTP Endpoints That Use Billing Accounts & Keys (MVP)

### 1. `/api/v1/ai/completion` (Data Plane)

- [x] **Auth:** Auth.js session only (HttpOnly cookie). No API key in the request.
- [x] **Flow:**
  1. Call `auth()` and require `session.user` (wallet login)
  2. Call `getOrCreateBillingAccountForUser(session.user)` → returns `{ billingAccountId, defaultVirtualKeyId }`
  3. Pre-flight: estimate cost, check balance via `getBalance`, DENY if insufficient
  4. Call LiteLLM `POST /chat/completions` with `Authorization: Bearer <LITELLM_MASTER_KEY>` and `metadata.cogni_billing_account_id`
  5. Extract `x-litellm-response-cost` and `x-litellm-call-id` headers
  6. Call `recordChargeReceipt` (non-blocking, per [ACTIVITY_METRICS.md](ACTIVITY_METRICS.md))
  7. Return response to user (NEVER blocked by post-call billing)

Session-based credit top-ups flow through the widget confirm endpoint below. Post-call billing failures are logged but do not block user responses.

### 2. `/api/v1/payments/credits/confirm` (Payments)

- [x] **Auth:** Auth.js session only (HttpOnly cookie). No billing account identifier in the payload.
- [x] **Flow:**
  1. Client calls after payment widget reports success (e.g., DePay `succeeded` event) with `{ amountUsdCents, clientPaymentId, metadata }`.
  2. Server resolves billing account from session via `getOrCreateBillingAccountForUser`.
  3. Idempotent ledger write: insert `credit_ledger` row with `reason = 'widget_payment'` and `reference = clientPaymentId`; credits computed as `amountUsdCents * 10`.
  4. Returns `{ billingAccountId, balanceCredits }` from cached balance.

### 3. `/api/v1/payments/credits/summary` (Payments)

- [x] **Auth:** Auth.js session only.
- [x] **Flow:** Returns `{ billingAccountId, balanceCredits, ledger[] }` for the authenticated billing account, ordered newest-first, used by the Credits page to refresh balance/history after confirm.

---

## Future: Operator HTTP API for Accounts & Keys (Post-MVP)

Once the core wallet → session → billing loop is stable, we will add an operator-facing HTTP API (likely with Auth.js-based admin roles) to manage accounts and keys. These routes are **not implemented in MVP**, but we keep them here as design intent:

**Potential routes:**

- [ ] `GET /api/admin/billing-accounts` – List billing accounts and key summaries
- [ ] `GET /api/admin/billing-accounts/:billingAccountId` – Inspect one billing account, balance, and ledger summary
- [ ] `GET /api/admin/billing-accounts/:billingAccountId/virtual-keys` – List virtual keys for that account
- [ ] `POST /api/admin/billing-accounts/:billingAccountId/virtual-keys` – Create a new LiteLLM virtual key for that account (wraps LiteLLM `POST /key/generate`)
- [ ] `POST /api/admin/billing-accounts/:billingAccountId/credits/topup` – Manually credit the account (writes to `credit_ledger`, adjusts balance)

Later, we can also expose self-serve data-plane endpoints (e.g., `/api/v1/accounts/me/balance`, `/api/v1/accounts/me/usage`) that infer `billing_account_id` from either the session or an `Authorization: Bearer <virtual_key>` header once we implement dual-auth mode.

**For the full set of LiteLLM key and spend management endpoints, see:**

- [LiteLLM Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys) – Virtual Keys section
- [Key Management API Endpoints Swagger](https://litellm-api.up.railway.app/) – Full API reference
- [LiteLLM Spend Tracking](https://docs.litellm.ai/docs/proxy/logging) – For mapping LiteLLM's usage records into our `credit_ledger` over time
