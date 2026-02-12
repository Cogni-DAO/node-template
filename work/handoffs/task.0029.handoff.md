---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-12
branch: ""
last_commit: ""
---

# Handoff: Canonicalize billing at GraphExecutorPort — callback + receipt barrier

## Context

- **All sandbox:openclaw LLM calls bill $0** (bug.0037, P0). `gemini-2.5-flash` is NOT free (`is_free: false`). Revenue leakage is active.
- Root cause: nginx proxy captures `$upstream_http_x_litellm_response_cost` from LiteLLM response headers, but **streaming SSE responses don't include cost in headers** — cost depends on total tokens, unknown until stream completes.
- The only test that would catch this (`sandbox-llm-roundtrip-billing.stack.test.ts:96`) is `it.skip`'d due to bug.0013.
- task.0029 is the architectural fix: replace log-scraping billing with LiteLLM webhook callbacks. Spec: [billing-ingest.md](../docs/spec/billing-ingest.md).
- A design review was completed this session — 3 blocking issues identified, owner provided resolution direction (see Decisions Made).

## Current State

- **bug.0037** filed and triaged → `proj.unified-graph-launch`, status: Todo
- **task.0029** status: Todo — no branch, no code written yet
- **Spec** (`billing-ingest.md`) is draft with 3 open questions — owner resolved the approach (below) but spec not yet updated
- **Design review verdict**: NEEDS DISCUSSION → owner responded with partial agreement and revised approach
- Current billing paths still operational: inproc (works), ephemeral sandbox (works), gateway (broken — $0 cost)

## Decisions Made

Owner resolved the 3 blocking design issues from the review:

1. **Gateway call_id delivery** — Do NOT require `x-litellm-call-id` from the gateway WS stream. Use `metadata.run_id` correlation from the LiteLLM callback instead. New invariant: `BILLING_CORRELATION_BY_RUN_ID` for gateway mode. Inproc/ephemeral can still use per-call barriers if call_id is available. Gateway WS enrichment (tool events + call_id) is a separate future task for accuracy, not correctness.

2. **Barrier race / UX** — Do NOT synchronously block the user response on receipt existence. Instead: implement a `ReconciliationService` that records expected `run_id` at run start; a periodic job marks runs "unreconciled" if no receipts arrive after N minutes; alert/log but never fail the user response post-stream.

3. **Payload shape** — Accept LiteLLM's native `StandardLoggingPayload[]` directly at the ingest endpoint. Do NOT build a custom callback class. Write the Zod schema against the actual LiteLLM payload. Verified: LiteLLM generic logger sends `List[StandardLoggingPayload]` including `call_id`, `response_cost`, `model`, `user`, `metadata` ([LiteLLM docs](https://docs.litellm.ai/docs/proxy/logging)).

4. **No ReceiptBarrierPort** — Fold receipt queries into existing `AccountService` or billing service. The "barrier" is a decorator policy decision, not a new hex port. Keeps it simple.

## Next Actions

- [ ] Update `billing-ingest.md` spec with the 3 resolved decisions above (especially `BILLING_CORRELATION_BY_RUN_ID` and reconciliation model)
- [ ] Verify LiteLLM `StandardLoggingPayload` shape against a real callback (run LiteLLM with `GENERIC_LOGGER_ENDPOINT` pointing at a request-bin or local echo server)
- [ ] Implement ingest endpoint: `POST /api/internal/billing/ingest` accepting native `StandardLoggingPayload[]`, Zod validation, `commitUsageFact()`, shared-secret auth
- [ ] Configure LiteLLM webhook: `success_callback: ["langfuse", "webhook"]` with `BILLING_INGEST_TOKEN`
- [ ] Add reconciliation tracking: record expected `run_id` at run start, periodic check for unreconciled runs
- [ ] Strip billing from adapters: remove `ProxyBillingReader`, billing volumes, `proxyBillingEntries`, cost extraction from sandbox/gateway providers
- [ ] Unskip `sandbox-llm-roundtrip-billing.stack.test.ts` and adapt to callback-driven billing

## Risks / Gotchas

- **LiteLLM webhook batching**: generic logger sends `List[StandardLoggingPayload]` (batch), not individual calls. Ingest endpoint must handle array payloads.
- **`metadata.run_id` availability**: the proxy sets `x-litellm-spend-logs-metadata` with `run_id` — verify this survives into the callback's `metadata` field. If not, fall back to LiteLLM DB query by `call_id`.
- **Free model cost=0 vs missing cost**: `isModelFree()` checks LiteLLM catalog; `gemini-2.5-flash` is `is_free: false` in `litellm.config.yaml:135`. Don't confuse "model is free" with "cost data is missing."
- **Existing billing test is `it.skip`**: `tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts:96` — skipped due to bug.0013 (proxy container vanishes). The test DOES assert `costUsd > 0` (line 118). Unskipping requires fixing or working around the proxy container race.

## Pointers

| File / Resource                                                     | Why it matters                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/spec/billing-ingest.md`                                       | Design spec — needs updates per decisions above                         |
| `docs/spec/billing-sandbox.md`                                      | Current proxy-driven billing spec (to be superseded)                    |
| `work/items/bug.0037.gateway-proxy-zero-cost-streaming.md`          | Motivating bug — $0 cost for all gateway calls                          |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Work item with requirements and migration plan                          |
| `src/adapters/server/sandbox/proxy-billing-reader.ts`               | Gateway billing reader (to be deleted)                                  |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:529-567`     | Gateway billing emission (to be simplified)                             |
| `src/adapters/server/ai/billing-executor.decorator.ts`              | Current billing decorator (to be modified for reconciliation)           |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` — the receipt writer                                |
| `platform/infra/services/sandbox-proxy/nginx-gateway.conf.template` | Gateway nginx config capturing `$upstream_http_x_litellm_response_cost` |
| `platform/infra/services/runtime/configs/litellm.config.yaml`       | LiteLLM config — add webhook callback here                              |
| `tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts`   | Skipped billing E2E test — unskip when ready                            |
