---
id: task.0029
type: task
title: "Canonicalize billing at GraphExecutorPort — callback + receipt barrier"
status: Todo
priority: 0
estimate: 3
summary: "Canonicalize billing at GraphExecutorPort: LiteLLM callback writes receipts, adapters only emit usage_unit_created{call_id}, decorator enforces receipt barrier. Eliminates all log-scraping billing paths."
outcome: "Adapters contain zero billing-specific code. All executor types produce receipts via callback→ingest→receipt. No nginx audit parsing. No ProxyBillingReader. No billing volumes."
spec_refs: billing-ingest-spec
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [billing, litellm, p0]
external_refs:
---

# task.0029 — Canonicalize billing at GraphExecutorPort

## Context

bug.0027 shipped a bridge fix: nginx writes JSONL audit log → shared volume → app tail-reads. This works but is the wrong architecture — file-based coupling between containers, adapters constructing full `UsageFact` with cost data, completely separate billing codepaths per executor type.

The real fix: billing is canonicalized at the port level. Adapters only emit `usage_unit_created{call_id}`. Cost arrives via LiteLLM callback. The decorator enforces a receipt barrier.

## Requirements

Per billing-ingest-spec invariants:

- **ONE_BILLING_PATH**: all billing confirmation is receipt-existence by `litellm_call_id`
- **ADAPTERS_NEVER_BILL**: adapters only emit `usage_unit_created{call_id}`; no cost parsing, no log reads
- **COST_ORACLE_IS_LITELLM**: cost comes from LiteLLM callback payload, not nginx logs or response headers
- **CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID**
- **BILLING_FAILURE_STILL_BLOCKS**: decorator enforces receipt barrier at end-of-run

## Allowed Changes

- `src/types/ai-events.ts` / `@cogni/ai-core` — add `usage_unit_created` event type
- `src/app/api/internal/billing/ingest/route.ts` — new ingest endpoint
- `src/contracts/billing-ingest.contract.ts` — Zod schema for callback payload
- `src/ports/receipt-barrier.port.ts` — new ReceiptBarrierPort interface
- `src/adapters/server/ai/billing-executor.decorator.ts` — collect call_ids, poll receipt barrier
- `src/adapters/server/ai/inproc-completion-unit.adapter.ts` — strip cost fields, emit `usage_unit_created`
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — strip billing reader, emit `usage_unit_created`
- `src/adapters/server/sandbox/proxy-billing-reader.ts` — **delete**
- `src/features/ai/services/billing.ts` — add `pollForReceipt(callId, timeoutMs)`
- `platform/infra/services/runtime/configs/litellm.config.yaml` — add webhook callback
- `platform/infra/services/runtime/docker-compose.yml` — remove `openclaw_billing` volume
- `platform/infra/services/runtime/docker-compose.dev.yml` — remove billing bind mount
- `src/shared/env/server.ts` — add `BILLING_INGEST_TOKEN`, remove `OPENCLAW_BILLING_DIR`

## Plan

Each step can ship independently (callback + log-scraping coexist during cutover):

- [ ] **1. Add `usage_unit_created` event** — define in `@cogni/ai-core`, adapters emit alongside existing `usage_report`
- [ ] **2. Add ingest endpoint** — `POST /api/internal/billing/ingest` with Zod validation, `commitUsageFact()`, shared-secret auth. Safe alongside existing path (idempotent by call_id)
- [ ] **3. Configure LiteLLM callback** — `success_callback: ["langfuse", "webhook"]` with `BILLING_INGEST_TOKEN` header
- [ ] **4. Add ReceiptBarrierPort + decorator change** — decorator collects call_ids from `usage_unit_created`, polls receipt barrier at end-of-run (≤3s), fails on missing
- [ ] **5. Strip billing from adapters** — remove cost extraction from InProc, remove `ProxyBillingReader` from Sandbox/Gateway, adapters emit only `usage_unit_created`
- [ ] **6. Delete old paths** — `ProxyBillingReader`, billing volumes, `proxyBillingEntries`, `OPENCLAW_BILLING_DIR`, `usage_report` event type

## Acceptance Criteria

- Any graph executor type produces receipts the same way (callback → ingest → receipt)
- Adapters contain zero billing-specific code (no cost parsing, no log reads, no receipt writes)
- No nginx audit parsing for billing anywhere in the codebase
- Run fails if receipt absent after bounded poll

## Validation

**Command:**

```bash
pnpm test:stack:dev
```

**Expected:** All sandbox + billing tests pass with callback-driven billing. No shared volume reads. No `ProxyBillingReader` in codebase.

## Review Checklist

- [ ] **Work Item:** `task.0029` linked in PR body
- [ ] **Spec:** billing-ingest-spec invariants upheld (ONE_BILLING_PATH, ADAPTERS_NEVER_BILL, COST_ORACLE_IS_LITELLM)
- [ ] **Tests:** ingest endpoint contract test + stack test proving callback → receipt → decorator barrier
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
