---
id: bug.0088
type: bug
title: Subagent LLM calls invisible in /activity — child session missing outboundHeaders
status: Backlog
priority: 0
estimate: 2
summary: Spawned subagent LLM calls go through LiteLLM but billing ingest skips them because the child session has no outboundHeaders — billingAccountId cannot be resolved.
outcome: Subagent LLM calls appear in /activity with correct model, tokens, and cost.
spec_refs: billing-ingest
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [billing, openclaw, observability]
external_refs:
---

# Subagent LLM calls invisible in /activity

## Requirements

### Observed

**Main agent billing works.** Cogni's gateway client calls `sessions.patch` to set 3 outbound headers on the parent session (log: `Configuring session outbound headers headerCount=3`). All main-agent deepseek-v3.2 calls are billed correctly: `processed:1, skipped:0` in every billing ingest callback.

**Subagent billing fails.** When the main agent spawns a subagent via `sessions_spawn`, the child session's LLM calls (gpt-4o-mini) all fail billing with `cannot resolve billingAccountId — skipping`. The child session has no outbound headers — `sessions_spawn` in OpenClaw does not propagate `outboundHeaders` from parent to child.

**Evidence from 2026-02-17 test run (runId: `425f495c`):**

```
# Main agent calls — all billed (15:05:07 → 15:07:09)
15:05:07 billing.ingest processed:1, skipped:0  runId=425f495c  ← deepseek
15:05:12 billing.ingest processed:1, skipped:0  runId=425f495c
...11 total, all processed

# Subagent spawns at 15:07:09
15:07:09 [gateway] device pairing auto-approved
15:07:09 [ws] sessions.patch ✓ 70ms
15:07:09 [ws] agent ✓ 325ms runId=62c04e8e  ← subagent on gpt-4o-mini

# Subagent calls — all skipped (15:07:19 → 15:10:50+)
15:07:19 billing.ingest skipped:1  callId=gen-1771340831  "cannot resolve billingAccountId"
15:07:24 billing.ingest skipped:1  callId=gen-1771340837
15:07:29 billing.ingest skipped:1  callId=gen-1771340843
...15+ callbacks, ALL skipped — subagent ran for 3+ minutes unbilled
```

### Expected

Subagent LLM calls should carry the same billing headers as the parent session. Every LLM call through LiteLLM should produce a charge receipt visible on `/activity`.

### Root Cause

OpenClaw's `sessions-spawn-tool.ts` does not propagate `outboundHeaders` from the parent session to the child session. The parent session has headers set by Cogni via `sessions.patch`:

- `x-litellm-end-user-id` (billingAccountId)
- `x-litellm-spend-logs-metadata` (runId, graphId, attempt)
- (third header — likely content-type or correlation)

The child session starts with no outbound headers → its LLM requests have no `x-litellm-end-user-id` → LiteLLM callback's `end_user` field is empty → `resolveBillingAccountId()` returns null → entry skipped.

### Code Pointers

| File                                                            | Role                                            |
| --------------------------------------------------------------- | ----------------------------------------------- |
| `src/app/api/internal/billing/ingest/route.ts:272-279`          | Skip path when billingAccountId is null         |
| `src/app/api/internal/billing/ingest/route.ts:81-97`            | `resolveBillingAccountId()` — two-source lookup |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:12`      | Documents: "gateway relies on LiteLLM callback" |
| Cogni: `src/adapters/server/sandbox/openclaw-gateway-client.ts` | Sets 3 outbound headers on parent session       |
| OpenClaw: `src/agents/tools/sessions-spawn-tool.ts`             | Spawn tool — does NOT inherit outboundHeaders   |

### Impact

- **Subagent LLM spend is invisible** — not on `/activity`, not in `charge_receipts`
- **Subagent runs unchecked** — the subagent kept making LLM calls for 3+ minutes after the main agent errored, all unbilled
- **Cost control blind spot** — subagents use `cogni/gpt-4o-mini` but no model attribution exists for these calls

## Allowed Changes

- OpenClaw `src/agents/tools/sessions-spawn-tool.ts` — inherit outboundHeaders from parent session to child
- OpenClaw `src/agents/tools/sessions-helpers.ts` — if helper needed to read parent session headers
- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — if Cogni-side changes needed

## Plan

- [ ] In OpenClaw: read parent session's outboundHeaders in sessions-spawn-tool.ts
- [ ] Propagate outboundHeaders to child session via sessions.patch before agent call
- [ ] Verify billing ingest logs show `processed:1` (not `skipped`) for subagent calls
- [ ] Verify /activity shows subagent model name (e.g., `cogni/gpt-4o-mini`)

## Validation

**Command:**

```bash
# 1. Send a message that triggers sessions_spawn
# 2. Check billing ingest logs — subagent calls should be processed, not skipped
docker logs app 2>&1 | grep "billing.ingest" | grep -E "processed|skipped" | tail -10
```

**Expected:** Billing ingest logs show `processed:1, skipped:0` for subagent LLM callbacks (no `cannot resolve billingAccountId` warnings after spawn).

## Review Checklist

- [ ] **Work Item:** `bug.0088` linked in PR body
- [ ] **Spec:** COST_AUTHORITY_IS_LITELLM invariant upheld (callback remains sole receipt writer)
- [ ] **Tests:** billing ingest test covers subagent callback with inherited outboundHeaders
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: `bug.0009` (gateway agent returns empty payloads — main agent errored in same test run)
- Related: `bug.0051` (gateway model routing E2E verification)
- Related: `bug.0066` (LiteLLM $0 cost for gpt-4o-mini — compounds this even after fix)

## Attribution

-
