---
id: task.0101.handoff
type: handoff
work_item_id: task.0101
status: active
created: 2026-02-22
updated: 2026-02-22
branch: staging
last_commit:
---

# Handoff: Identity Resolution + Curation Auto-Population (task.0101)

## Context

You are implementing the missing link between raw activity collection and allocation computation in the transparent credit payouts pipeline (`proj.transparent-credit-payouts`).

The collection pipeline (task.0095, merged) ingests GitHub activity into `activity_events`. The identity schema (task.0089, merged) provides `user_bindings` for mapping platform identities to users. But nothing connects them — no curation rows are created, no identities are resolved. Without this, task.0102 (allocation computation) has no input.

**Read the full design in the work item**: `work/items/task.0101.identity-resolution-curation.md`

## What Exists (All Merged to Staging)

### Collection Pipeline (task.0095)

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — `CollectEpochWorkflow` with 4 steps. **You add step 5: curateAndResolve.**
- `services/scheduler-worker/src/activities/ledger.ts` — `createLedgerActivities(deps)` factory with 5 activities. **You add `curateAndResolve` here.**
- `LedgerActivities` type alias = `ReturnType<typeof createLedgerActivities>` — adding a function auto-exports it
- `LedgerActivityDeps`: `{ ledgerStore, sourceAdapters, nodeId, scopeId, logger }`

### Identity Schema (task.0089)

- `packages/db-schema/src/identity.ts` — `userBindings` table: `(id, user_id, provider, external_id, created_at)` with `UNIQUE(provider, external_id)`
- Provider check constraint: `IN ('wallet', 'discord', 'github')`
- Wallet bindings backfilled; GitHub bindings need manual seeding for V0

### Store Port + Adapter

- `packages/ledger-core/src/store.ts` — `ActivityLedgerStore` interface. Has `upsertCuration(params[])`, `getCurationForEpoch(epochId)`, `getUnresolvedCuration(epochId)`, `getActivityForWindow(nodeId, since, until)`. **You add `resolveIdentities()` here.**
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — `DrizzleLedgerAdapter`. **You implement `resolveIdentities()` here.** Currently does NOT import identity tables — you add `import { userBindings } from "@cogni/db-schema/identity"`.

### Key Types

- `UpsertCurationParams`: `{ nodeId, epochId, eventId, userId?, included?, weightOverrideMilli?, note? }`
- `LedgerActivityEvent`: `{ id, nodeId, scopeId, source, eventType, platformUserId, platformLogin?, ... }`

## What You Build

### 1. `resolveIdentities()` on Store Port

Add to `ActivityLedgerStore` in `packages/ledger-core/src/store.ts`:

```typescript
resolveIdentities(
  provider: string,
  externalIds: string[]
): Promise<Map<string, string>>; // externalId → userId
```

Implement in `DrizzleLedgerAdapter`: `SELECT external_id, user_id FROM user_bindings WHERE provider = $1 AND external_id = ANY($2)`. Use `inArray()` from drizzle-orm. Deduplicate input with `new Set()`.

### 2. `curateAndResolve` Activity

Add to `createLedgerActivities` factory. Takes `{ epochId, periodStart, periodEnd }` (NOT event arrays — avoid Temporal payload bloat).

Logic:

1. `getActivityForWindow(nodeId, new Date(periodStart), new Date(periodEnd))` — query DB for events
2. Group unique `platformUserId` values by source
3. For each source: `resolveIdentities(source, externalIds)` — batch query
4. Build curation params: one per event, `userId = resolved ?? null`, `included = true`
5. `upsertCuration(params)` — batch upsert
6. Return `{ totalEvents, resolved, unresolved }`

### 3. Wire into CollectEpochWorkflow

After the collection loops (line ~149), add:

```typescript
// 5. Curate events and resolve identities
await curateAndResolve({
  epochId: epoch.epochId,
  periodStart: periodStartIso,
  periodEnd: periodEndIso,
});
```

Add `curateAndResolve` to the existing default `proxyActivities` call (2-minute timeout group).

## Design Decisions (Already Made)

- **DB query, not workflow state**: Activity queries `getActivityForWindow()` instead of receiving events through workflow. Avoids Temporal payload limits and is naturally idempotent.
- **resolveIdentities on ledger port**: Cross-domain convenience (queries `user_bindings` from identity schema). Marked with a comment. Extract to `IdentityStore` when a second consumer appears.
- **Single activity**: One `curateAndResolve` does both resolve + curate. Two separate activities would add unnecessary Temporal overhead.
- **Best-effort**: Unresolved events get `userId: null`, never dropped (IDENTITY_BEST_EFFORT).

## Gotchas

- `DrizzleLedgerAdapter` currently imports only from `@cogni/db-schema/ledger`. You need to add `import { userBindings } from "@cogni/db-schema/identity"` — verify this doesn't violate dep-cruiser rules (`pnpm check` will catch it)
- `epochId` is serialized as string in Temporal (bigint doesn't serialize). Parse back with `BigInt(input.epochId)` in the activity.
- `upsertCuration` does `onConflictDoUpdate` on `(epoch_id, event_id)` — re-running is safe
- `getActivityForWindow` queries by `(nodeId, eventTime)` not by scopeId — verify this doesn't include cross-scope events (V0: single scope, so not an issue)

## File Map

| File                                                                | Action | What                                                   |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `packages/ledger-core/src/store.ts`                                 | Modify | Add `resolveIdentities()` to `ActivityLedgerStore`     |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts`         | Modify | Import `userBindings`, implement `resolveIdentities()` |
| `services/scheduler-worker/src/activities/ledger.ts`                | Modify | Add `curateAndResolve` + input/output types            |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | Modify | Add step 5, add to proxyActivities                     |
| `services/scheduler-worker/tests/ledger-activities.test.ts`         | Modify | Add 4+ tests for curateAndResolve                      |

## Validation

```bash
pnpm check                   # types + lint + dep-cruiser
pnpm packages:build          # rebuild packages
pnpm test -- services/scheduler-worker/tests/ledger-activities
```

## Pointers

- **Work item (with full design)**: `work/items/task.0101.identity-resolution-curation.md`
- Project: `work/projects/proj.transparent-credit-payouts.md`
- Spec: `docs/spec/epoch-ledger.md` (CollectEpochWorkflow steps 4-5)
- Identity spec: `docs/spec/decentralized-identity.md`
- Next task: `task.0102` (allocation computation + epoch close + finalize)
- Existing tests: `services/scheduler-worker/tests/ledger-activities.test.ts`
