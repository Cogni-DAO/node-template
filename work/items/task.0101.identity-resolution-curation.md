---
id: task.0101
type: task
title: "Identity resolution activity + curation auto-population (GitHub V0)"
status: needs_design
priority: 1
rank: 7
estimate: 2
summary: "Implement curateAndResolve activity (auto-create curation rows from events, resolve GitHub platform_user_id → user_id via user_bindings), add resolveIdentities to store port + DrizzleLedgerAdapter, wire into CollectEpochWorkflow."
outcome: "After each collection run, curation rows exist for every activity event. GitHub platformUserId resolved to user_id via user_bindings (best-effort — unresolved events flagged with user_id=NULL). Allocation computation can read curated events."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0089, task.0095
deploy_verified: false
created: 2026-02-22
updated: 2026-02-22
labels: [governance, ledger, identity]
external_refs:
---

# Identity Resolution + Curation Auto-Population

## Problem

The collection pipeline (task.0095) ingests raw `activity_events` but never creates `activity_curation` rows or resolves platform identities to `user_id`. Without this, allocation computation has no input — events are raw facts with `platformUserId` (e.g., GitHub numeric ID) but no `user_id` (UUID from `users` table).

This is the missing link between **ingestion** (task.0095) and **allocation computation** (task.0102).

## Requirements

### 1. `resolveIdentities()` Store Method

Add to `ActivityLedgerStore` port + implement in `DrizzleLedgerAdapter`:

```typescript
resolveIdentities(
  provider: string,       // "github", "discord"
  externalIds: string[]   // platform_user_id values
): Promise<Map<string, string>>  // externalId → userId
```

Implementation: query `user_bindings WHERE provider = $1 AND external_id = ANY($2)`.

Depends on task.0089 (`user_bindings` table).

### 2. `curateAndResolve` Activity

New activity in `createLedgerActivities`:

```typescript
curateAndResolve(input: {
  epochId: bigint;
  events: Array<{
    id: string;           // activity event deterministic ID
    source: string;       // "github"
    platformUserId: string;
  }>;
}): Promise<{ resolved: number; unresolved: number }>
```

Logic:

1. Batch resolve: `resolveIdentities("github", events.map(e => e.platformUserId))`
2. For each event: `upsertCuration({ epochId, eventId: e.id, userId: resolved ?? null, included: true })`
3. Return counts for observability

### 3. Wire into CollectEpochWorkflow

After all source collection loops complete, call `curateAndResolve` with the collected events. This is step 4 in the spec's CollectEpochWorkflow.

### 4. GitHub Binding Creation (V0 bootstrap)

For V0, GitHub bindings must be seeded manually or via a migration/script that maps known GitHub numeric IDs to existing `users.id`. Future: OAuth flow auto-creates bindings (out of scope).

## Allowed Changes

- `packages/ledger-core/src/store.ts` (add `resolveIdentities` to port)
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` (implement `resolveIdentities`)
- `services/scheduler-worker/src/activities/ledger.ts` (add `curateAndResolve` activity)
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` (wire step 4)
- Tests

## Plan

- [ ] Add `resolveIdentities()` to store port interface
- [ ] Implement in DrizzleLedgerAdapter (query user_bindings)
- [ ] Add `curateAndResolve` activity to `createLedgerActivities`
- [ ] Wire into CollectEpochWorkflow after collection loops
- [ ] Unit test: resolution with mixed found/not-found identities
- [ ] Unit test: curation rows created with correct userId/null

## Validation

```bash
pnpm check
pnpm test -- tests/unit/core/ledger/
```

## Review Checklist

- [ ] **Work Item:** `task.0101` linked in PR body
- [ ] **Spec:** IDENTITY_BEST_EFFORT upheld (unresolved → null userId, not dropped)
- [ ] **Tests:** Resolution + curation auto-population tested
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
