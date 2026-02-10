# Handoff: OpenClaw Sandbox Billing Fix

**Branch:** `feat/concurrent-openclaw`
**Date:** 2026-02-09
**Status:** Investigation complete, implementation not started
**Last commit:** `817b1776` — skip flaky sandbox proxy tests + gateway client typecheck fix

---

## Goal

Fix the sandbox OpenClaw billing pipeline so charge receipts record the **correct model, tokens, and cost** from LiteLLM (the billing source of truth), not from the graph executor's request-side data which may differ from what was actually called.

## What's Wrong

Two interrelated problems were identified:

### 1. Model mismatch (confirmed)

`SandboxGraphProvider.createGatewayExecution()` records `UsageFact.model = req.model` (what the caller requested), but OpenClaw gateway ignores the requested model and always uses its config default (`cogni/nemotron-nano-30b`). LiteLLM spend logs prove every recent call went to `nemotron-nano-30b` regardless of what model was requested. Charge receipts could record the wrong model.

### 2. Activity dashboard broken (bug.0004)

The `/activity` page shows "—" for cost because `charge_receipts.litellm_call_id` doesn't reliably join against LiteLLM `spend_logs.request_id` (provider-dependent mismatch). The fix is to store telemetry (`model`, `tokens_in`, `tokens_out`, `cost`) directly in our DB at write time via a new `llm_charge_details` table, rather than joining LiteLLM at read time.

## Work Items (priority order)

| ID            | Type | What                                                               | Status                      |
| ------------- | ---- | ------------------------------------------------------------------ | --------------------------- |
| **bug.0004**  | Bug  | Charge receipts need linked telemetry — `llm_charge_details` table | Backlog, ready to implement |
| **task.0010** | Task | Dynamic model selection for OpenClaw gateway                       | Backlog, needs design spike |
| **bug.0013**  | Bug  | Flaky sandbox proxy stack tests (3 tests skipped)                  | Backlog, lower priority     |

**Start with bug.0004** — it's the billing correctness fix. task.0010 (making model selection work) is a separate feature that can follow.

## Critical Constraint

When writing `llm_charge_details`, **all fields must come from LiteLLM spend logs**, not from `GraphRunRequest` or `UsageFact`:

- `model` → LiteLLM `model_group` (actual model used)
- `tokens_in`/`tokens_out` → LiteLLM `prompt_tokens`/`completion_tokens`
- `response_cost_usd` → LiteLLM `spend`
- `provider_call_id` → LiteLLM `request_id` (forensic only, NOT a join key)

This is because the graph executor's `req.model` may not match what OpenClaw actually called (see model mismatch above). **LITELLM_IS_USAGE_TRUTH** is the governing invariant.

## Key Files

### Billing write path

- `src/features/ai/services/billing/` — `commitUsageFact()` — entry point for writing charge receipts
- `src/shared/db/schema/` — `chargeReceipts`, `llmChargeDetails` table definitions
- `src/adapters/server/sandbox/sandbox-graph.provider.ts:452-465` — where `UsageFact` is constructed (gateway mode)
- `src/adapters/server/sandbox/sandbox-graph.provider.ts:296-311` — where `UsageFact` is constructed (ephemeral mode)
- `src/adapters/server/sandbox/proxy-billing-reader.ts` — reads billing entries from nginx audit log

### Billing read path (Activity dashboard)

- `src/features/ai/services/billing/` — `listChargeReceipts` or similar
- `src/adapters/server/` — look for `LiteLlmActivityUsageAdapter`, `ActivityUsagePort` — the LiteLLM dependency to remove

### Gateway client + provider

- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — WS client, `runAgent()` async generator
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — `createGatewayExecution()` and `createContainerExecution()`
- `services/sandbox-openclaw/openclaw-gateway.json` — OpenClaw gateway config (model defaults here)

### Specs

- `docs/spec/openclaw-sandbox-spec.md` — sandbox integration spec, invariants 13-23
- `docs/spec/external-executor-billing.md` — billing reconciliation pattern

### Tests (3 currently skipped — bug.0013)

- `tests/stack/sandbox/sandbox-llm-completion.stack.test.ts` — lines 88, 101
- `tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts` — line 95

## LiteLLM Spend Logs API

Query recent spend logs to verify billing data:

```bash
curl -s -X GET "http://localhost:4000/spend/logs?limit=3" \
  -H "Authorization: Bearer your-litellm-master-key-here" | python3 -m json.tool
```

Key fields in each entry: `model_group`, `model`, `spend`, `prompt_tokens`, `completion_tokens`, `metadata.spend_logs_metadata.run_id`.

## OpenClaw Model Selection (task.0010, for later)

OpenClaw's WS `agent` method does NOT accept a `model` param. Model selection is config-driven:

1. Per-agent config (`agents.list[n].model.primary`)
2. Session state (`sessionEntry.modelOverride` via `sessions.patch`)
3. Global defaults (`agents.defaults.model.primary`)

Preferred MVP approach: use `sessions.patch` with `modelOverride` before each `agent` call. Full investigation results are in `work/items/task.0010.openclaw-model-selection.md`. OpenClaw source is at `/Users/derek/dev/openclaw/`.
