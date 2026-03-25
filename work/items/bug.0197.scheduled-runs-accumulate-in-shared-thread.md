---
id: bug.0197
type: bug
title: "Scheduled runs accumulate messages in a single shared thread per schedule"
status: needs_implement
priority: 1
rank: 4
estimate: 2
summary: Each scheduled run appends its messages to one persistent ai_threads row keyed by sha256(scheduleId). After N runs, the thread has 2*N messages, growing unbounded. Scheduled runs should be ephemeral — each run is a fresh conversation, not a continuation.
outcome: Each scheduled run executes with a fresh conversation context. No unbounded thread accumulation. Historical runs remain accessible individually.
spec_refs:
  - spec.scheduler
  - spec.unified-graph-launch
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels:
  - scheduler
  - threads
  - data-growth
external_refs:
---

# Scheduled runs accumulate messages in a single shared thread per schedule

## Observed

Every run from a user-created schedule appends its messages (user prompt + assistant response) to the **same** `ai_threads` row. The thread `state_key` is `sha256(scheduleId)` — deterministic and stable across runs. After N runs, the thread has 2\*N messages, growing without bound.

**Evidence from dev DB** (3 schedules running every minute for ~17 minutes):

| `state_key` (truncated) | `owner_user_id` | `msg_count` | schedule graph     |
| ----------------------- | --------------- | ----------- | ------------------ |
| `a7683f...`             | `e55dc7c1-...`  | 35          | langgraph:ponderer |
| `5b110a...`             | `e55dc7c1-...`  | 35          | langgraph:brain    |
| `056f07...`             | `e55dc7c1-...`  | 35          | langgraph:poet     |

Confirmed: `sha256("cddba5f8-6a90-4593-ab23-8a38b7053462")` = `a7683f4b...` (ponderer schedule UUID).

### Root Cause

**File**: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts:352-353`

```typescript
const scheduleId = extractScheduleId(idempotencyKey);
stateKey = createHash("sha256").update(scheduleId, "utf8").digest("hex");
```

For grant-backed (scheduled) runs, `stateKey` is derived from the **schedule ID** — constant across all runs. The graph execution path then loads this thread, appends the new run's messages, and persists.

This was likely designed for governance scheduled runs where continuous context accumulation is intentional (e.g., daily system health checks building on prior state). But it's wrong for user-created schedules where each run should be a fresh, independent conversation.

### How thread persistence works (traced)

The internal API execution path (`route.ts:560-619`) does this after each graph run:

1. `loadThread(actorUserId, stateKey)` — loads existing messages from `ai_threads`
2. `assembleAssistantMessage(runId, events)` — builds the assistant response
3. `saveThread(actorUserId, stateKey, [...existing, assistantMsg])` — appends and saves

The LLM does NOT see previous thread messages — `runGraph()` (line 478) only receives the schedule's input payload. Thread persistence is **append-only for the UI sidebar**, not for execution context. But the append is still wrong because:

### Consequences

1. **Unbounded JSONB growth**: `ai_threads.messages` grows by ~1 assistant message per run per schedule. After 1 day at 1-minute cron: ~1,440 messages per thread.
2. **Wasted I/O**: Every run loads the entire bloated thread just to append one message.
3. **Dashboard shows "untitled" threads**: These schedule threads appear in the sidebar thread list as "untitled" conversations with massive message counts.
4. **`graph_runs.state_key` is NULL**: The stateKey is derived in the internal API (line 353) but never propagated back to `graph_runs` — dashboard can't link scheduled runs to their threads.

## Expected

Scheduled runs should be **ephemeral by default** — each run gets a fresh conversation context. The `stateKey` for each run should include the run-specific slot (e.g., `sha256(scheduleId + ":" + scheduledFor)`) so each execution is isolated.

If continuous context IS desired for a schedule (future feature), it should be an explicit opt-in on the schedule definition, not the default.

## Reproduction

1. Create a schedule with `cron: "* * * * *"` (every minute)
2. Wait 5 minutes
3. Check: `SELECT state_key, jsonb_array_length(messages) FROM ai_threads ORDER BY jsonb_array_length(messages) DESC LIMIT 5;`
4. Observe: one thread per schedule with 10+ messages (2 per run)

## Impact

- **All users with recurring schedules**: Thread bloat, context pollution, increasing token costs per run
- **Data growth**: Unbounded JSONB column growth in `ai_threads`
- **UX**: "Untitled" mega-threads in sidebar thread list

## Design

### Outcome

Each scheduled run is a fresh, independent conversation. No thread accumulation. Run results still accessible individually via dashboard click-through.

### Approach

**Solution**: Set `stateKey = undefined` for grant-backed scheduled runs. Skip thread persistence entirely — scheduled runs are headless.

**Why not per-slot stateKey?** Changing to `sha256(idempotencyKey)` creates a unique stateKey per slot, which means `loadThread()` returns `[]` and a fresh 1-message thread is persisted. This works but creates thousands of orphan `ai_threads` rows (one per cron tick per schedule) that nobody will ever view. It's data bloat with no user value.

**Why headless is better**: Scheduled runs produce results visible via:

- `graph_runs` table (status, timing, errors) — already works
- Redis stream events (live/replay via SSE) — already works
- `charge_receipts` (billing) — already works

Thread persistence exists for **interactive chat continuity** — the user sends a message, sees the response, sends another. Scheduled runs have no interactive user. The sidebar thread list should not show them.

**Reuses**: Existing `STATEKEY_NULLABLE` invariant — the codebase already handles `stateKey = undefined` for headless runs (webhooks, PR reviews).

**Rejected**:

- **Per-slot stateKey** (`sha256(idempotencyKey)`) — creates thousands of orphan ai_threads rows per schedule. Data bloat for no user value.
- **Per-schedule stateKey with append** (current behavior) — unbounded growth, the bug being fixed.

### Invariants

- [ ] STATEKEY_NULLABLE: Headless runs (stateKey=undefined) skip thread persistence (spec: unified-graph-launch)
- [ ] PUMP_TO_COMPLETION_VIA_REDIS: Run events still reach Redis regardless of thread persistence (spec: unified-graph-launch)
- [ ] SIMPLE_SOLUTION: 2-line change — set stateKey=undefined, remove sessionId derivation for grants
- [ ] ARCHITECTURE_ALIGNMENT: Follows existing headless run pattern (webhooks)

### Files

- Modify: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts:352-354` — set `stateKey = undefined` and `sessionId = run:{runId}` for grant-backed runs
- Test: existing execution tests should still pass (stateKey was already optional)

## Allowed Changes

- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — remove stateKey/sessionId derivation for grant-backed runs

## Plan

- [ ] Set `stateKey = undefined` for grant-backed runs (line 353)
- [ ] Set `sessionId = run:${runId}` for grant-backed runs (line 354, already the fallback pattern from line 387)
- [ ] Verify: new scheduled runs do NOT create ai_threads rows
- [ ] Verify: old bloated threads stop growing (no new appends)
- [ ] Consider: clean up old mega-threads (separate task)

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** All checks pass.

**Manual verification:**

```sql
-- After fix: each scheduled run slot has its own stateKey
SELECT state_key, jsonb_array_length(messages) as msg_count
FROM ai_threads
WHERE state_key LIKE '%'  -- all threads
ORDER BY updated_at DESC LIMIT 10;
-- Expected: new threads have 2 messages each (1 user + 1 assistant), not accumulating
```

## Review Checklist

- [ ] **Work Item:** bug.0197 linked in PR body
- [ ] **Spec:** unified-graph-launch thread invariants upheld
- [ ] **Tests:** stateKey derivation test for scheduled runs
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
