---
id: task.0100
type: task
title: "Epoch 3-phase state machine + approvers + canonical signing message"
status: needs_implement
priority: 1
rank: 6
estimate: 2
summary: "DB migration for open→review→finalized lifecycle, updated curation freeze trigger, close-ingestion store method + API route, approvers config in repo-spec, and buildCanonicalMessage() pure function for EIP-191 signing."
outcome: "Epochs transition open→review→finalized with DB constraint enforcement. Curation stays mutable until finalize. Approvers declared in repo-spec. Canonical signing message format shared between frontend and backend."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0093, task.0103
deploy_verified: false
created: 2026-02-22
updated: 2026-02-22
labels: [governance, ledger, signing, security]
external_refs:
---

# Epoch 3-Phase State Machine + Approvers + Canonical Signing

## Design

### Outcome

Epochs gain the `open → review → finalized` lifecycle required by EPOCH_THREE_PHASE. Curation remains mutable during review (CURATION_FREEZE_ON_FINALIZE). Approvers are declared in repo-spec (APPROVERS_PER_SCOPE). The canonical signing message format is defined for EIP-191 (SIGNATURE_SCOPE_BOUND). This unblocks task.0102 (allocation computation + FinalizeEpochWorkflow) and task.0096 (API routes).

### Approach

**Solution**: Edit existing migrations in place (ledger tables have never been deployed to production) to use 3-phase (`open`/`review`/`finalized`) from the start. One new store method (`closeIngestion`). One new API route (`close-ingestion`). Approvers added to repo-spec. Pure `buildCanonicalMessage()` in ledger-core. No sign route in V0 — signature passed inline to finalize (task.0102).

**Reuses**:

- Existing `closeEpoch()` store method (rename to `finalizeEpoch()`, update transition from `open→closed` to `review→finalized`)
- Existing repo-spec config pattern (`getNodeId()`, `getPaymentConfig()`, `getGovernanceConfig()`)
- Existing `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })` for SIWE route
- Existing `insertStatementSignature()` / `getSignaturesForStatement()` store methods (already implemented)
- CollectEpochWorkflow already enforces INGESTION_CLOSED_ON_REVIEW at app layer (line 126: `if (epoch.status !== "open") return;`)

**Rejected**:

1. **Separate sign route (V0)**: `statement_signatures` has FK to `payout_statements` — can't store signatures before the statement exists. Workarounds (nullable FK, staging table) add complexity for a V0 single-approver model. Simpler: finalize route (task.0102) takes signature inline, creates statement + signature atomically. Sign route is a V1 concern (multi-sig).
2. **DB trigger for INGESTION_CLOSED_ON_REVIEW**: `activity_events` has no `epoch_id` column (epoch membership is at curation layer). A trigger would require joining on `event_time` against epoch windows — fragile and slow. The workflow already skips collection when status != 'open' (app-level enforcement). Good enough for V0.
3. **viem in ledger-core**: Considered adding `verifyMessage` to ledger-core for a `verifyStatementSignature()` function. Rejected — ledger-core has zero runtime deps and should stay pure. Verification happens in the finalize route (task.0102) using viem at the app layer. `buildCanonicalMessage()` is all that needs sharing.
4. **Full state machine abstraction**: `EpochStateMachine` class with event-sourced transitions. Over-engineered — the state machine is a column with 3 values and 2 forward-only transitions, enforced by WHERE clauses on UPDATE.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] EPOCH_THREE_PHASE: Status enum is `open | review | finalized`. No backward transitions. DB CHECK constraint + UPDATE WHERE clause enforce. (spec: epoch-ledger)
- [ ] ONE_ACTIVE_EPOCH: Partial unique index changed to `WHERE status != 'finalized'`. Both `open` and `review` count as "active". (spec: epoch-ledger)
- [ ] CURATION_FREEZE_ON_FINALIZE: DB trigger rejects curation writes only when `status = 'finalized'`. Curation stays mutable during `open` and `review`. (spec: epoch-ledger)
- [ ] INGESTION_CLOSED_ON_REVIEW: App-level enforcement — CollectEpochWorkflow exits when `status != 'open'`. No DB trigger on `activity_events`. (spec: epoch-ledger)
- [ ] APPROVERS_PER_SCOPE: `ledger.approvers` in repo-spec as array of EVM addresses. `getLedgerApprovers()` accessor cached same as `getNodeId()`. (spec: epoch-ledger)
- [ ] SIGNATURE_SCOPE_BOUND: `buildCanonicalMessage()` includes `node_id + scope_id + epoch_id + allocation_set_hash + pool_total_credits`. (spec: epoch-ledger)
- [ ] SCOPE_GATED_QUERIES: New adapter methods (`closeIngestion`, `finalizeEpoch`) enforce `AND scope_id = this.scopeId` in WHERE clause. No cross-scope epoch transitions possible. (dep: task.0103)
- [ ] SIMPLE_SOLUTION: Reuses existing store methods, DB trigger function, and repo-spec patterns.
- [ ] ARCHITECTURE_ALIGNMENT: Pure function in ledger-core. Route uses existing auth wrappers. Config follows repo-spec pattern. (spec: architecture)

### Detailed Changes

#### 1. Edit existing migrations in place (no new migration file)

Ledger tables have never been deployed to production. Edit the source-of-truth files directly:

**`packages/db-schema/src/ledger.ts`** — update Drizzle schema:

```typescript
// epochs table: 3-phase CHECK + partial unique index
check("epochs_status_check", sql`${table.status} IN ('open', 'review', 'finalized')`),
uniqueIndex("epochs_one_active_per_node")
  .on(table.nodeId, table.scopeId)
  .where(sql`${table.status} != 'finalized'`),
```

**`0010_shallow_paibok.sql`** — edit in place:

- Change CHECK from `('open', 'closed')` to `('open', 'review', 'finalized')`
- Change index name from `epochs_one_open_per_node` to `epochs_one_active_per_node`
- Change index WHERE from `status = 'open'` to `status != 'finalized'`

**`0011_triggers_and_backfill.sql`** — edit in place:

- Rename `curation_freeze_on_close()` → `curation_freeze_on_finalize()`
- Change check from `epoch_status = 'closed'` to `epoch_status = 'finalized'`
- Update error message from "is closed" to "is finalized"
- Update trigger name reference

Dev databases that ran old migrations: `pnpm db:reset` (drop + re-migrate).

#### 2. Model type update (`packages/ledger-core/src/model.ts`)

```typescript
export const EPOCH_STATUSES = ["open", "review", "finalized"] as const;
export type EpochStatus = (typeof EPOCH_STATUSES)[number];
```

#### 3. Store port: add `closeIngestion`, rename `closeEpoch` → `finalizeEpoch` (`packages/ledger-core/src/store.ts`)

```typescript
/** Transition epoch open → review (INGESTION_CLOSED_ON_REVIEW). */
closeIngestion(epochId: bigint): Promise<LedgerEpoch>;

/** Transition epoch review → finalized (was closeEpoch). */
finalizeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch>;
```

Note: `closeIngestion` matches existing `closeEpoch` pattern — epochId only, no nodeId (epoch PK is sufficient). Rename `closeEpoch` → `finalizeEpoch` since it now transitions review→finalized, not open→closed.

No new methods needed for signatures — `insertStatementSignature()` and `getSignaturesForStatement()` already exist on the port and adapter.

#### 4. Store adapter: implement `closeIngestion`, rename + update `closeEpoch` → `finalizeEpoch` (`packages/db-client/src/adapters/drizzle-ledger.adapter.ts`)

**`closeIngestion(epochId)`**: UPDATE epochs SET status='review' WHERE id=epochId AND status='open'. Idempotent: if already review, return as-is. If finalized, throw. If not found, throw.

**`finalizeEpoch(epochId, poolTotal)`** (renamed from `closeEpoch`): Change WHERE from `status='open'` to `status='review'`. Same idempotent pattern — already-finalized returns existing. This method is the review→finalized transition used by FinalizeEpochWorkflow (task.0102).

#### 5. Signing module (`packages/ledger-core/src/signing.ts`)

```typescript
export interface CanonicalMessageParams {
  readonly nodeId: string;
  readonly scopeId: string;
  readonly epochId: string; // string (bigint serialized)
  readonly allocationSetHash: string;
  readonly poolTotalCredits: string; // string (bigint serialized)
}

/** Build the EIP-191 canonical message for payout statement signing. */
export function buildCanonicalMessage(params: CanonicalMessageParams): string {
  return [
    "Cogni Payout Statement",
    `Node: ${params.nodeId}`,
    `Scope: ${params.scopeId}`,
    `Epoch: ${params.epochId}`,
    `Allocation Hash: ${params.allocationSetHash}`,
    `Pool Total: ${params.poolTotalCredits}`,
  ].join("\n");
}
```

Zero runtime deps. Shared between frontend (wallet signing) and backend (verification in task.0102). Export from `packages/ledger-core/src/index.ts`.

#### 6. Approvers config

**`src/shared/config/repoSpec.schema.ts`** — add `ledger` section:

```typescript
export const ledgerSpecSchema = z.object({
  approvers: z
    .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address"))
    .min(1, "At least one approver required"),
});

// Add to repoSpecSchema:
ledger: ledgerSpecSchema.optional(),
```

**`src/shared/config/repoSpec.server.ts`** — add `getLedgerApprovers()`:

```typescript
let cachedLedgerApprovers: string[] | null = null;

export function getLedgerApprovers(): string[] {
  if (cachedLedgerApprovers) return cachedLedgerApprovers;
  const spec = loadRepoSpec();
  cachedLedgerApprovers = spec.ledger?.approvers ?? [];
  return cachedLedgerApprovers;
}
```

**`src/shared/config/index.ts`** — add export.

**`.cogni/repo-spec.yaml`** — add section:

```yaml
ledger:
  approvers:
    - "0xYourWalletAddress" # Replace with actual scope approver
```

#### 7. API route: close-ingestion

**Contract**: `src/contracts/ledger.close-ingestion.v1.contract.ts`

```typescript
export const closeIngestionOperation = {
  id: "ledger.close-ingestion.v1",
  input: z.object({ epochId: z.string() }),
  output: z.object({
    epoch: EpochDtoSchema, // if task.0096 contracts landed, import; otherwise define inline
  }),
};
```

If task.0096 contracts are not yet merged, define a minimal inline `EpochDtoSchema` (id, status, periodStart, periodEnd) and replace with the shared one later.

**Route**: `src/app/api/v1/ledger/epochs/[id]/close-ingestion/route.ts`

POST handler:

1. SIWE session → get walletAddress
2. Check `walletAddress.toLowerCase()` against `getLedgerApprovers().map(a => a.toLowerCase())` → 403 if not (EVM addresses are case-insensitive; SIWE returns EIP-55 checksummed)
3. Parse epochId from URL param
4. Call `store.closeIngestion(BigInt(epochId))`
5. Return epoch DTO

Uses `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })`. Route lives under `/api/v1/ledger/` (SIWE-protected namespace).

### What This Does NOT Include (deferred)

| Feature                               | Deferred to     | Why                                                                                              |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| sign API route                        | task.0102 or V1 | `statement_signatures` FK requires statement to exist first. V0: signature inline with finalize. |
| finalize API route                    | task.0102       | Triggers FinalizeEpochWorkflow which computes payouts                                            |
| FinalizeEpochWorkflow                 | task.0102       | Needs `computeProposedAllocations()` + payout computation                                        |
| `verifyStatementSignature()`          | task.0102       | Uses viem at app layer; called by finalize route                                                 |
| `computeProposedAllocations()`        | task.0102       | Weight policy → allocations                                                                      |
| INGESTION_CLOSED_ON_REVIEW DB trigger | Never (V0)      | App-level enforcement via workflow skip sufficient                                               |

### Files

<!-- High-level scope -->

- Create: `packages/ledger-core/src/signing.ts` — `buildCanonicalMessage()` pure function
- Create: `src/contracts/ledger.close-ingestion.v1.contract.ts` — Zod contract
- Create: `src/app/api/v1/ledger/epochs/[id]/close-ingestion/route.ts` — SIWE + approver route
- Modify: `packages/db-schema/src/ledger.ts` — 3-phase CHECK + partial unique index
- Modify: `src/adapters/server/db/migrations/0010_shallow_paibok.sql` — match Drizzle schema (edit in place, never deployed)
- Modify: `src/adapters/server/db/migrations/0011_triggers_and_backfill.sql` — rename trigger to `curation_freeze_on_finalize`, check `'finalized'`
- Modify: `packages/ledger-core/src/model.ts` — `EPOCH_STATUSES = ["open", "review", "finalized"]`
- Modify: `packages/ledger-core/src/store.ts` — add `closeIngestion()` to port
- Modify: `packages/ledger-core/src/index.ts` — export signing module
- Modify: `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — implement `closeIngestion()`, rename + update `closeEpoch()` → `finalizeEpoch()`
- Modify: `src/shared/config/repoSpec.schema.ts` — add `ledger.approvers` schema
- Modify: `src/shared/config/repoSpec.server.ts` — add `getLedgerApprovers()`
- Modify: `src/shared/config/index.ts` — export `getLedgerApprovers`
- Modify: `.cogni/repo-spec.yaml` — add `ledger.approvers` section
- Test: `services/scheduler-worker/tests/ledger-activities.test.ts` — state transition tests
- Test: `tests/unit/packages/ledger-core/signing.test.ts` — canonical message format
- Test: `tests/stack/ledger/close-ingestion.stack.test.ts` — API route + approver check

## Validation

**Command:**

```bash
pnpm check
pnpm packages:build
pnpm test -- tests/unit/packages/ledger-core/signing
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** Types pass, signing unit tests green, stack tests green.

## Review Checklist

- [ ] **Work Item:** `task.0100` linked in PR body
- [ ] **Spec:** EPOCH_THREE_PHASE, ONE_ACTIVE_EPOCH, CURATION_FREEZE_ON_FINALIZE, APPROVERS_PER_SCOPE, SIGNATURE_SCOPE_BOUND invariants enforced
- [ ] **Tests:** state transitions (open→review, review→finalized, reject backward), curation mutable during review, canonical message format, approver check on close-ingestion
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
