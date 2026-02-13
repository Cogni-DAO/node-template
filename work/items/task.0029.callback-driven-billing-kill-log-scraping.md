---
id: task.0029
type: task
title: "Callback-driven billing — LiteLLM generic_api webhook replaces log scraping"
status: Todo
priority: 0
estimate: 3
summary: "LiteLLM generic_api callback writes charge receipts via ingest endpoint. Adapters stripped to emit usage_unit_created{call_id} only. Async reconciliation replaces synchronous barrier. Eliminates all log-scraping billing paths."
outcome: "Adapters contain zero billing-specific code. All executor types produce receipts via callback→ingest→receipt. No nginx audit parsing. No ProxyBillingReader. No billing volumes."
spec_refs: billing-ingest-spec
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-13
labels: [billing, litellm, p0]
external_refs:
---

# task.0029 — Callback-driven billing via LiteLLM generic_api webhook

## Context

bug.0037 (P0): all `sandbox:openclaw` LLM calls bill $0. Root cause: nginx proxy captures `x-litellm-response-cost` from response headers, but streaming SSE responses don't include cost in headers. The proxy-based billing approach is architecturally broken for streaming.

bug.0027 shipped a bridge fix (nginx JSONL audit log → shared volume → filesystem reads). This works for non-streaming but is the wrong architecture — file-based coupling, adapters constructing full `UsageFact` with cost data, separate billing codepaths per executor type.

The real fix: LiteLLM's `generic_api` callback fires AFTER the stream completes with full cost data. A single ingest endpoint receives all billing data. No log scraping anywhere.

## Requirements

Per billing-ingest-spec invariants (verified via spike 2026-02-13):

- **ONE_BILLING_PATH**: all billing confirmation is receipt-existence by `litellm_call_id` (callback payload `id` field)
- **ADAPTERS_NEVER_BILL**: adapters only emit `usage_unit_created{call_id}`; no cost parsing, no log reads
- **COST_ORACLE_IS_LITELLM**: cost comes from callback `response_cost` field — verified present and accurate for streaming
- **CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID**: duplicate callbacks are no-ops
- **NO_SYNCHRONOUS_RECEIPT_BARRIER**: user response never blocked waiting for callback arrival

## Allowed Changes

- `src/app/api/internal/billing/ingest/route.ts` — new ingest endpoint
- `src/contracts/billing-ingest.contract.ts` — Zod schema matching verified `StandardLoggingPayload`
- `src/types/ai-events.ts` / `@cogni/ai-core` — add `usage_unit_created` event type
- `src/adapters/server/ai/billing-executor.decorator.ts` — collect call_ids for observability, stop writing receipts
- `src/adapters/server/ai/inproc-completion-unit.adapter.ts` — strip cost fields, emit `usage_unit_created`
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — strip billing reader, emit `usage_unit_created`
- `src/adapters/server/sandbox/proxy-billing-reader.ts` — **delete**
- `src/features/ai/services/billing.ts` — remove `pollForReceipt()` concept (no synchronous barrier)
- `platform/infra/services/runtime/configs/litellm.config.yaml` — add `generic_api` to `success_callback`
- `platform/infra/services/runtime/docker-compose.dev.yml` — add `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` env vars to litellm service, remove `openclaw_billing` volume
- `platform/infra/services/runtime/docker-compose.yml` — same for prod compose
- `src/shared/env/server.ts` — add `BILLING_INGEST_TOKEN`, remove `OPENCLAW_BILLING_DIR`

## Plan

Each step can ship independently (callback + log-scraping coexist during cutover):

- [ ] **1. Add ingest endpoint** — `POST /api/internal/billing/ingest` accepting `List[StandardLoggingPayload]` (Zod validated), shared-secret auth, calls `commitUsageFact()` per entry. Idempotent by call_id. Safe alongside existing billing path.
- [ ] **2. Configure LiteLLM `generic_api` callback** — `success_callback: ["langfuse", "generic_api"]`, `GENERIC_LOGGER_ENDPOINT=http://app:3000/api/internal/billing/ingest`, `GENERIC_LOGGER_HEADERS=Authorization=Bearer ${BILLING_INGEST_TOKEN}`. Both old and new paths write receipts; idempotency prevents doubles.
- [ ] **3. Fix gateway `run_id` gap** — Add `x-litellm-spend-logs-metadata` (with `run_id`, `graph_id`, `attempt`) to OpenClaw `outboundHeaders` when creating gateway session. Currently gateway calls have `spend_logs_metadata: null` in callback.
- [ ] **4. Add `usage_unit_created` event + decorator change** — New event type in `@cogni/ai-core`. Decorator collects call_ids for observability logging, stops writing receipts inline. Adapters emit `usage_unit_created` alongside existing `usage_report` during transition.
- [ ] **5. Strip billing from adapters** — Remove cost extraction from InProc, remove `ProxyBillingReader` from Sandbox/Gateway. Adapters emit only `usage_unit_created`.
- [ ] **6. Delete old paths** — `ProxyBillingReader`, billing volumes, `proxyBillingEntries`, `OPENCLAW_BILLING_DIR`, `usage_report` event type.

## Acceptance Criteria

- Any graph executor type produces receipts the same way (callback → ingest → receipt)
- Adapters contain zero billing-specific code (no cost parsing, no log reads, no receipt writes)
- No nginx audit parsing for billing anywhere in the codebase
- `charge_receipts` show accurate `response_cost_usd > 0` for paid model gateway calls (bug.0037 resolved)
- Gateway calls have `run_id` correlation in callback metadata

## Validation

**Command:**

```bash
pnpm test:stack:dev
```

**Expected:** All sandbox + billing tests pass with callback-driven billing. No shared volume reads. No `ProxyBillingReader` in codebase.

## Review Checklist

- [ ] **Work Item:** `task.0029` linked in PR body
- [ ] **Spec:** billing-ingest-spec invariants upheld (ONE_BILLING_PATH, ADAPTERS_NEVER_BILL, COST_ORACLE_IS_LITELLM, NO_SYNCHRONOUS_RECEIPT_BARRIER)
- [ ] **Tests:** ingest endpoint contract test + stack test proving callback → receipt for streaming calls
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0037 (gateway proxy zero-cost streaming)
- Supersedes: billing-sandbox-spec (proxy audit log pipeline)
- Companion: task.0039 (reconciliation worker — catches missing callbacks)
- Related: bug.0004 (activity dashboard cost column — separate fix)
- Handoff: [handoff](../handoffs/task.0029.handoff.md)

## Attribution

-
