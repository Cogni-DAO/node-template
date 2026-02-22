---
id: task.0101
type: task
title: "Identity resolution activity + curation auto-population (GitHub V0)"
status: needs_implement
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
revision: 1
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

## Design

### Outcome

After each daily collection run, every ingested activity event has a corresponding `activity_curation` row with a best-effort `user_id` resolved from `user_bindings`. Unresolved events are flagged (null userId), never dropped. task.0102 can then read curated events to compute allocations.

### Approach

**Solution**: One new activity (`curateAndResolve`) added to the existing `createLedgerActivities` factory. The activity queries the DB for events in the epoch's time window (avoiding Temporal payload size concerns), batch-resolves identities via a new `resolveIdentities()` method on the store port, and upserts curation rows. The workflow calls this as step 5, after all collection loops complete.

**Key design decision — DB query instead of workflow state**: The original requirements passed events through the workflow as an `allEvents` array. This is wrong for two reasons:

1. **Temporal payload limits**: A week of GitHub activity could produce hundreds of events. Serializing full `ActivityEvent` objects through workflow history grows unboundedly.
2. **Idempotency**: If the workflow retries after a partial curateAndResolve, events from a previous run's workflow state would be stale. Querying the DB always gets the current truth.

Instead, the `curateAndResolve` activity takes only `{ epochId, periodStart, periodEnd }` and queries `getActivityForWindow()` internally. This is simpler, bounded, and idempotent.

**Key design decision — resolveIdentities on the ledger port**: The `user_bindings` table lives in the identity domain (`@cogni/db-schema/identity`). The cleanest architecture would be a separate `IdentityStore` port. However:

- The scheduler-worker already has a single `LedgerContainer` with one `ledgerStore`
- Adding a second store port + adapter + DI wiring for a single SELECT query is over-engineering
- The `DrizzleLedgerAdapter` already uses `serviceDb` which has access to all tables
- V0 has one consumer; extract to separate port when a second consumer appears

So: add `resolveIdentities()` to `ActivityLedgerStore` with a comment marking it as a cross-domain convenience method. Import `userBindings` from `@cogni/db-schema/identity` in the adapter.

**Reuses**:

- Existing `createLedgerActivities(deps)` DI factory — just add one function
- Existing `upsertCuration()` on store port — already implemented, batch-capable, idempotent
- Existing `getActivityForWindow()` on store port — already queries by (nodeId, since, until)
- Existing `userBindings` table from `@cogni/db-schema/identity` — just a SELECT
- Existing `LedgerContainer` DI — no changes to container.ts
- Existing workflow proxy pattern — add to existing `proxyActivities` call

**Rejected**:

- **Separate IdentityStore port**: Over-engineered for V0. One SELECT query doesn't justify a new port + adapter + container wiring. Extract when needed.
- **Pass events through workflow state**: Unbounded Temporal payload growth. Query DB instead.
- **Separate activities for resolve + curate**: Two round-trips (workflow → resolve activity → curate activity) where one suffices. The activity does both in a single call — resolve batch, then upsert batch. This avoids extra Temporal overhead and keeps the workflow simpler.
- **Per-source resolution in collection loop**: Resolution per-source during collection would curate incrementally but complicates the workflow (N curateAndResolve calls per run). A single post-collection pass is simpler, equally correct, and handles cross-source dedup naturally.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] IDENTITY_BEST_EFFORT: Unresolved events get `userId: null` in curation rows — never dropped or excluded (spec: epoch-ledger-spec)
- [ ] ACTIVITY_IDEMPOTENT: `curateAndResolve` is idempotent — `upsertCuration` uses `onConflictDoUpdate` on `(epoch_id, event_id)` (spec: epoch-ledger-spec)
- [ ] NODE_SCOPED: All operations pass `nodeId` from deps, never from input (spec: epoch-ledger-spec)
- [ ] TEMPORAL_DETERMINISM: Workflow contains no I/O — curateAndResolve is an activity (spec: temporal-patterns)
- [ ] SIMPLE_SOLUTION: One activity, one store method, minimal workflow change
- [ ] ARCHITECTURE_ALIGNMENT: services/ imports only from packages/, never from src/ (spec: architecture)

### Files

**Modify:**

- `packages/ledger-core/src/store.ts` — Add `resolveIdentities(provider, externalIds)` to `ActivityLedgerStore` interface
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — Implement `resolveIdentities()`: import `userBindings` from `@cogni/db-schema/identity`, SELECT with `WHERE provider = $1 AND external_id = ANY($2)`
- `services/scheduler-worker/src/activities/ledger.ts` — Add `curateAndResolve` activity + `CurateAndResolveInput`/`CurateAndResolveOutput` types to factory
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Add step 5: proxy + call `curateAndResolve` with `{ epochId, periodStart, periodEnd }`

**Test:**

- `services/scheduler-worker/tests/ledger-activities.test.ts` — Add tests for `curateAndResolve` (mock store, verify curation upserts with resolved/null userIds)

### Implementation Details

#### `resolveIdentities()` Store Method

```typescript
// packages/ledger-core/src/store.ts — add to ActivityLedgerStore
/**
 * Cross-domain convenience: resolves platform IDs to user UUIDs via user_bindings.
 * Lives on ledger port (not a separate identity port) because V0 has a single consumer.
 * Extract to IdentityStore port if a second consumer appears.
 */
resolveIdentities(
  provider: string,
  externalIds: string[]
): Promise<Map<string, string>>; // externalId → userId
```

Adapter implementation:

```typescript
// packages/db-client/src/adapters/drizzle-ledger.adapter.ts
import { userBindings } from "@cogni/db-schema/identity";

async resolveIdentities(
  provider: string,
  externalIds: string[]
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const rows = await this.db
    .select({ externalId: userBindings.externalId, userId: userBindings.userId })
    .from(userBindings)
    .where(and(
      eq(userBindings.provider, provider),
      inArray(userBindings.externalId, [...new Set(externalIds)])
    ));
  return new Map(rows.map(r => [r.externalId, r.userId]));
}
```

#### `curateAndResolve` Activity

```typescript
// Input — minimal, no event serialization through Temporal
export interface CurateAndResolveInput {
  readonly epochId: string; // bigint serialized as string
  readonly periodStart: string; // ISO date — for getActivityForWindow query
  readonly periodEnd: string; // ISO date
}

export interface CurateAndResolveOutput {
  readonly totalEvents: number;
  readonly resolved: number;
  readonly unresolved: number;
}
```

Logic:

1. `getActivityForWindow(nodeId, periodStart, periodEnd)` — get all events for the epoch window
2. Group unique `platformUserId` values by source (e.g., all GitHub IDs)
3. For each source: `resolveIdentities(source, externalIds)` — batch query
4. Build curation params: one per event, `userId = resolved.get(platformUserId) ?? null`, `included = true`
5. `upsertCuration(params)` — batch upsert (idempotent on `(epoch_id, event_id)`)
6. Return counts

#### Workflow Wiring

```typescript
// After line 149 in collect-epoch.workflow.ts (after all collection loops):

// 5. Curate events and resolve identities
await curateAndResolve({
  epochId: epoch.epochId,
  periodStart: periodStartIso,
  periodEnd: periodEndIso,
});
```

Add `curateAndResolve` to the existing `proxyActivities` call (default 2-minute timeout group — resolution is a single DB query + batch upsert, well under 2 minutes).

## Plan

- [ ] Add `resolveIdentities()` to `ActivityLedgerStore` interface in store.ts
- [ ] Import `userBindings` and implement `resolveIdentities()` in DrizzleLedgerAdapter
- [ ] Add `CurateAndResolveInput`, `CurateAndResolveOutput` types to ledger.ts
- [ ] Implement `curateAndResolve` activity in `createLedgerActivities` factory
- [ ] Add `curateAndResolve` to proxyActivities in workflow, call after collection loops
- [ ] Unit test: `resolveIdentities` with mixed found/not-found identities
- [ ] Unit test: `curateAndResolve` creates curation rows with correct userId/null
- [ ] Unit test: `curateAndResolve` with zero events (no-op)
- [ ] Unit test: `curateAndResolve` idempotent on re-run (same epoch)
- [ ] Rebuild packages (`pnpm packages:build`)

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test -- services/scheduler-worker/tests/ledger-activities
```

## Review Checklist

- [ ] **Work Item:** `task.0101` linked in PR body
- [ ] **Spec:** IDENTITY_BEST_EFFORT upheld (unresolved → null userId, not dropped)
- [ ] **Tests:** Resolution + curation auto-population tested (4+ test cases)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0101.handoff.md)

## Attribution

-
