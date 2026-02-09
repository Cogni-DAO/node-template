---
id: bug.0005
type: bug
title: "Scheduled runs invisible in Activity — internal route bypasses RunEventRelay billing"
status: Todo
priority: 0
estimate: 2
summary: POST /api/internal/graphs/{graphId}/runs drains graph stream without processing usage_report events, so scheduled runs never write charge_receipts. Activity dashboard (now receipts-only) shows no data for recurring runs.
outcome: Scheduled graph runs produce charge_receipts identical to UI chat runs; Activity dashboard shows both trigger types.
spec_refs: graph-execution, unified-graph-launch, temporal-patterns
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [billing, scheduler, regression]
external_refs:
---

## Problem

`/activity` dashboard shows usage data from UI chats only. Recurring scheduled runs are completely invisible — zero rows, zero cost, zero tokens.

## Root Cause

Two distinct execution paths exist for graph runs, but only one has a billing subscriber:

| Path              | Entry                                                                                                         | Billing                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **UI chat**       | `completionStream()` → `createAiRuntime().runChatStream()` → `RunEventRelay` wraps `graphExecutor.runGraph()` | `usage_report` events → `commitUsageFact()` → `recordChargeReceipt()`                                |
| **Scheduled run** | `POST /api/internal/graphs/{graphId}/runs` → `executor.runGraph()` **directly**                               | Stream drained: `for await (const _event of result.stream) {}` — `usage_report` events **discarded** |

The internal route handler (`src/app/api/internal/graphs/[graphId]/runs/route.ts:336-352`) calls `executor.runGraph()` directly, bypassing `createAiRuntime()` and its `RunEventRelay`. The `usage_report` events from graph providers are consumed and thrown away — no billing subscriber processes them.

**Why this wasn't visible before commit 4fe662fd:** The old Activity dashboard queried LiteLLM `/spend/logs` API directly (by `end_user`). LiteLLM records all LLM calls regardless of our billing pipeline. Scheduled runs made LLM calls through LiteLLM, so they appeared in Activity. After 4fe662fd switched Activity to read only from `charge_receipts`, the gap became visible.

## Key Files

| File                                                          | Role                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts:336-352` | **Bug site**: drains stream without billing                           |
| `src/features/ai/services/ai_runtime.ts:184-355`              | `RunEventRelay` — billing subscriber that the internal route bypasses |
| `src/features/ai/services/billing.ts:203-321`                 | `commitUsageFact()` — never called for scheduled runs                 |
| `src/app/_facades/ai/activity.server.ts`                      | Activity facade — now reads charge_receipts only                      |

## Fix Options

1. **Quick fix**: Wrap `executor.runGraph()` in the internal route handler with a `RunEventRelay` (or inline billing loop) so `usage_report` events are processed.
2. **Proper fix** (proj.unified-graph-launch P0): Unify all graph execution through `GraphRunWorkflow` so there's a single execution path with billing enforcement. The internal route becomes an Activity caller, not a direct executor.

## Validation

- Trigger a scheduled graph run
- Verify `charge_receipts` row exists with correct `run_id`, `billing_account_id`, `receipt_kind='llm'`
- Verify `/activity` dashboard shows the scheduled run with cost/tokens/model
- Verify `AI_BILLING_COMMIT_COMPLETE` log event fires for scheduled runs
