---
id: bug.0197
type: bug
title: "Scheduled runs accumulate messages in a single shared thread per schedule"
status: needs_triage
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

### Consequences

1. **Unbounded JSONB growth**: `ai_threads.messages` grows by 2 rows per minute per schedule. After 1 day: ~2,880 messages per thread. After 1 week: ~20,160 messages.
2. **Context pollution**: Each run sees all previous runs' messages in its conversation history, causing the LLM to respond in context of prior runs rather than fresh.
3. **Performance degradation**: Loading a 20K-message thread for each 1-minute run will slow execution and inflate token costs.
4. **Dashboard shows "untitled" threads**: These schedule threads appear in the sidebar thread list as "untitled" conversations with massive message counts.

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

## Design: Proposed Fix

### Option A: Per-slot stateKey (minimal, recommended)

**File**: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts:352-353`

```typescript
// Before:
const scheduleId = extractScheduleId(idempotencyKey);
stateKey = createHash("sha256").update(scheduleId, "utf8").digest("hex");

// After — each slot gets its own thread:
stateKey = createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
// idempotencyKey = "{scheduleId}:{scheduledFor}" — unique per slot
```

This makes each scheduled run a fresh conversation. No migration needed — new runs get new stateKeys automatically. Old bloated threads remain but stop growing.

### Option B: No stateKey for scheduled runs (headless)

Scheduled runs don't need thread persistence at all — they're headless. Set `stateKey = undefined` for grant-backed runs. The run still executes and produces events/results, but doesn't persist a conversation thread.

This is simpler but loses the ability to view scheduled run conversations in the chat UI.

### Recommendation

**Option A** — per-slot stateKey. Each run is a fresh thread. Users can still click through to see what happened in each scheduled run via the dashboard → chat deep-link.

## Allowed Changes

- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — change stateKey derivation for grant-backed runs

## Plan

- [ ] Change stateKey for grant-backed runs from `sha256(scheduleId)` to `sha256(idempotencyKey)`
- [ ] Verify: new scheduled runs create fresh threads
- [ ] Verify: old bloated threads stop growing
- [ ] Consider: should old mega-threads be cleaned up? (separate task)

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
