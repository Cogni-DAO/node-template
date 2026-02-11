---
id: task.0029
type: task
title: "Replace nginx audit log billing with LiteLLM callback webhook"
status: Todo
priority: 0
estimate: 3
summary: "Eliminate all log-scraping billing paths (nginx JSONL parsing, shared volume reads) and replace with LiteLLM success_callback webhook that pushes per-call cost data to an internal ingest endpoint."
outcome: "Billing works identically across all executor types and deployment topologies via a single push-based mechanism. ProxyBillingReader and openclaw_billing volume deleted."
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

# task.0029 — Replace nginx audit log billing with LiteLLM callback webhook

## Context

bug.0027 shipped a bridge fix: nginx writes JSONL audit log → shared volume → app tail-reads. This works but is fragile — file-based coupling between containers, no delivery guarantees, grow-forever log, and a completely separate billing codepath from the standard InProc executor.

The real fix: LiteLLM already computes `response_cost` on every call. Configure its `success_callback` webhook to POST billing data directly to the app. One billing data plane for all executor types.

## Requirements

- LiteLLM `success_callback: ["webhook"]` configured to POST to `POST /api/internal/billing/ingest`
- Ingest endpoint validates payload (Zod), calls `commitUsageFact()` → `recordChargeReceipt()`, returns 200/409
- Idempotent by `UNIQUE(source_system, source_reference)` where `source_reference = {runId}/{attempt}/{litellm_call_id}`
- Ingest endpoint authenticated via `BILLING_INGEST_TOKEN` shared secret
- Endpoint on internal network only (not exposed through Caddy)
- All executors (InProc, sandbox ephemeral, gateway, external) confirm receipt existence after LLM call before marking run successful
- `ProxyBillingReader` deleted after cutover
- `openclaw_billing` named volume removed from compose files
- Zero change to charge_receipts schema (reuse existing table)

## Allowed Changes

- `src/app/api/internal/billing/ingest/route.ts` — new POST handler
- `src/contracts/billing-ingest.contract.ts` — new Zod schema
- `platform/infra/services/runtime/configs/litellm.config.yaml` — add webhook callback
- `src/adapters/server/sandbox/proxy-billing-reader.ts` — delete
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — replace billing reader with receipt poll
- `src/adapters/server/ai/inproc-completion-unit.adapter.ts` — replace inline usage_report with receipt poll
- `src/features/ai/services/billing.ts` — add `pollForReceipt(litellmCallId, timeoutMs)`
- `platform/infra/services/runtime/docker-compose.yml` — remove `openclaw_billing` volume
- `platform/infra/services/runtime/docker-compose.dev.yml` — remove billing bind mount
- `src/shared/env/server.ts` — add `BILLING_INGEST_TOKEN`, remove `OPENCLAW_BILLING_DIR`

## Plan

Per billing-ingest-spec migration path — each step can ship independently:

- [ ] Add ingest endpoint + Zod contract + LiteLLM webhook config (callback writes are idempotent, safe to run alongside log scraping)
- [ ] Add `pollForReceipt()` to billing service
- [ ] Switch SandboxGraphProvider from billing reader to receipt poll
- [ ] Switch InProc executor from inline usage_report to receipt poll
- [ ] Delete `ProxyBillingReader`, remove billing volume mounts, remove `OPENCLAW_BILLING_DIR`
- [ ] Verify all executor types in stack tests

## Validation

**Command:**

```bash
pnpm test:stack:dev
```

**Expected:** All sandbox + billing tests pass with callback-driven billing. No shared volume reads.

## Review Checklist

- [ ] **Work Item:** `task.0029` linked in PR body
- [ ] **Spec:** billing-ingest-spec invariants upheld (BILLING_SOURCE_IS_CALLBACK_NOT_LOGS, CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID, etc.)
- [ ] **Tests:** ingest endpoint contract test + stack test proving callback → receipt → executor confirmation
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
