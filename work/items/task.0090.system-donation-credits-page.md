---
id: task.0090
type: task
title: Keep Cogni Alive - direct system account funding on credits page
status: needs_implement
priority: 0
estimate: 2
summary: Split credits page into "Buy Credits" (self) and "Keep Cogni Alive" (system donation). Add `purpose` field to payment_attempts as the stable context envelope; settlement branches on purpose to route credits.
outcome: Users can directly fund the system account from the credits page, with clear UX distinguishing personal credits from system donations.
spec_refs: accounts-design-spec, system-tenant
assignees: derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/discord-agents
pr:
reviewer:
created: 2026-02-19
updated: 2026-02-19
labels: [billing, system-tenant, ui]
external_refs: []
revision: 0
blocked_by:
deploy_verified: false
rank: 25
---

# "Keep Cogni Alive" — Direct System Account Funding

## Design

### Outcome

Users can directly fund the Cogni system account (the billing account that powers governance agents, Discord bots, and infrastructure AI) from the same credits page where they buy personal credits.

### Approach

**Solution**: Add `purpose` column to `payment_attempts` as the stable context envelope. The on-chain USDC flow is identical for both paths — same wallet signing, same ERC20 transfer, same verification. The only difference is where credits land at settlement time.

**Key insight**: `payment_attempts` IS the context envelope. Once `purpose` is stored on the row at creation, all downstream code reads it from the attempt object that's already being passed around. No explicit threading needed — intermediate layers (route handler, API client) pass the contract input through generically and need zero changes.

**Reuses**:

- `UsdcPaymentFlow` component — fully generic, zero changes
- `PaymentFlowDialog`, `PaymentButton`, `PaymentStatusChip` — zero changes
- `paymentsClient.submitTxHash`, `paymentsClient.getStatus` — zero changes
- Submit/status API routes — zero changes
- On-chain verification pipeline — zero changes
- `usePaymentFlow` hook — 2-line addition (accept + forward purpose)
- `credit_ledger.reason` for receipt discrimination — existing pattern, new value `system_donation`

**Rejected**:

- Separate API endpoint for donations — duplicates the entire intent/submit/status pipeline for a 1-field difference
- `context: JSONB` bag on payment_attempts — over-engineering; a typed column is simpler and queryable
- Threading `purpose` explicitly through every function — unnecessary; the attempt row carries it

### How `purpose` flows (the envelope pattern)

```
Contract input: { amountUsdCents, purpose }
  → API client: JSON.stringify(input)          — 0 changes (generic passthrough)
  → Route handler: parses contract, calls facade — 0 changes (passes parsed input)
  → Facade: adds billingAccountId, forwards     — 1 line (add purpose to object)
  → Service createIntent: stores on attempt row  — 1 line (forward to repo create)
  ─── async gap (wallet sign → on-chain confirm → verify) ───
  → verifyAndSettle: reads attempt.purpose       — 5 lines (branch to settlement fn)
  → Settlement: credits user OR system tenant    — new fn ~15 lines
```

### Why `purpose` does NOT go on receipts

The `credit_ledger.reason` field already discriminates entry types:

- `widget_payment` → user purchased credits for themselves
- `system_donation` → user donated to system account (NEW)
- `platform_revenue_share` → auto-minted bonus from user purchase
- `charge_receipt` → LLM usage debit

The reason IS the receipt. `charge_receipts` is for LLM debits only — separate path entirely.

### Settlement logic

```
purpose === "self":
  → confirmCreditsPayment() (existing, unchanged)
  → Credits user account + mints revenue share bonus to system tenant

purpose === "system":
  → confirmSystemDonation() (new, ~15 lines)
  → Credits system tenant directly, reason "system_donation"
  → No revenue share (already 100% to system)
```

### UI layout

```
CreditsPage
├── Balance Card (unchanged — shows user's balance)
├── SectionCard: "Buy Credits"
│   ├── subtext: "Add credits to your account"
│   ├── SplitInput + UsdcPaymentFlow (purpose="self")
│   └── HintText: "Transactions may take many minutes to confirm"
└── SectionCard: "Keep Cogni Alive"
    ├── subtext: "Directly fund Cogni's AI infrastructure"
    ├── SplitInput + UsdcPaymentFlow (purpose="system")
    └── HintText: "100% goes to the system account that powers Cogni's agents"
```

Each section gets its own `useState` for amount and its own `usePaymentFlow` instance. The `UsdcPaymentFlow` component is already fully generic.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CREDITS_PER_BILLING_ACCOUNT: System donations credit `COGNI_SYSTEM_BILLING_ACCOUNT_ID` (spec: accounts-design)
- [ ] CUSTOMER_DATA_UNDER_CUSTOMER_ACCOUNT: Payment attempt `billingAccountId` remains the USER's account (RLS owner). `purpose` determines settlement target (spec: accounts-design)
- [ ] IDEMPOTENT_SETTLEMENT: `confirmSystemDonation` uses `findCreditLedgerEntryByReference` guard with reason `system_donation` (spec: system-tenant)
- [ ] NO_REVENUE_SHARE_ON_DONATION: System donations skip revenue share — it would be circular (system → system)
- [ ] PURPOSE_DEFAULT_SELF: `purpose` defaults to `"self"` — existing flows unchanged
- [ ] SIMPLE_SOLUTION: Zero changes to UsdcPaymentFlow, PaymentFlowDialog, submit/status routes, on-chain verification
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layering; new field on core model, branching in feature service (spec: architecture)

### Files

**Data model** (the envelope):

- Modify: `src/contracts/payments.intent.v1.contract.ts` — add `purpose: z.enum(["self","system"]).default("self")`
- Modify: `packages/db-schema/src/billing.ts` — add `purpose` column to `paymentAttempts`
- Create: migration `00XX_add_payment_purpose.sql` — `ALTER TABLE payment_attempts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'self'`
- Modify: `src/core/payments/model.ts` — add `purpose` to `PaymentAttempt` interface
- Modify: `src/ports/payment-attempt.port.ts` — add `purpose` to `CreatePaymentAttemptParams`

**Settlement** (the branch point):

- Modify: `src/features/payments/services/paymentService.ts` — `verifyAndSettle` branches on `attempt.purpose`
- Modify: `src/features/payments/services/creditsConfirm.ts` — add `confirmSystemDonation()` function (~15 lines)
- Modify: `src/shared/constants/system-tenant.ts` — add `SYSTEM_DONATION_REASON = "system_donation"`

**Passthrough** (1-line additions):

- Modify: `src/app/_facades/payments/attempts.server.ts` — forward `purpose` in `createPaymentIntentFacade`
- Modify: `src/features/payments/services/paymentService.ts` — forward `purpose` in `createIntent`

**Client** (hook + UI):

- Modify: `src/features/payments/hooks/usePaymentFlow.ts` — accept `purpose` option, pass to `paymentsClient.createIntent`
- Modify: `src/app/(app)/credits/CreditsPage.client.tsx` — add "Keep Cogni Alive" SectionCard with independent state

**Zero changes**:

- `src/components/kit/payments/UsdcPaymentFlow.tsx`
- `src/components/kit/payments/PaymentFlowDialog.tsx`
- `src/components/kit/payments/PaymentButton.tsx`
- `src/features/payments/api/paymentsClient.ts` (sends contract input generically)
- `src/app/api/v1/payments/intents/route.ts` (passes parsed contract input)
- `src/app/api/v1/payments/attempts/[id]/submit/route.ts`
- `src/app/api/v1/payments/attempts/[id]/route.ts`
- On-chain verification pipeline

**Tests**:

- Unit: `confirmSystemDonation` — credits system tenant, idempotent, no revenue share
- Unit: `verifyAndSettle` with `purpose="system"` — calls donation path
- Stack: E2E system donation → verify single ledger entry with reason `system_donation` on system account

## Validation

- `pnpm check` passes
- Unit: donation intent creates `purpose: system_donation` in payment_attempts
- Stack: E2E system donation → verify single ledger entry with reason `system_donation` on system account

## Scope Guardrails

- Do NOT show system account balance on credits page (that's governance page territory)
- Do NOT add new API routes — the existing intent/submit/status pipeline handles both purposes
- Do NOT modify UsdcPaymentFlow or any payment UI components
- Do NOT add `purpose` to `credit_ledger` — `reason` already serves this role
