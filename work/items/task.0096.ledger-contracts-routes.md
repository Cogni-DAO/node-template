---
id: task.0096
type: task
title: "Ledger Zod contracts + API routes (3 write, 5 read) + stack tests"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Define Zod contracts for all ledger endpoints, implement 5 read routes (public, direct DB) and 3 write routes (SIWE-protected), with stack tests. Finalize route deferred to task.0102; verify route deferred to task.0102."
outcome: "Frontend can display current epoch, past epochs with allocations, and payout statements. Admins can trigger collection, adjust allocations, and record pool components via API."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-api-routes
pr:
reviewer:
revision: 1
blocked_by: task.0095
deploy_verified: false
created: 2026-02-20
updated: 2026-02-22
labels: [governance, ledger, api]
external_refs:
---

# Ledger Zod Contracts + API Routes

## Problem

The ledger pipeline collects activity and stores it in the DB, but nothing exposes this data over HTTP. The frontend mockup (community-ledger) needs epoch data, activity events, allocations, and payout statements to render its 3 pages (Current Epoch, History, Holdings). Admins need write routes to trigger collection, adjust allocations, and record pool components.

## Design

### Outcome

Frontend can fetch epoch data, activity events, allocations, and payout statements via public read routes. Admins can trigger activity collection, adjust allocations, and record pool components via SIWE-protected write routes.

### Approach

**Solution**: 9 Zod contracts defining all ledger API shapes. 5 read routes (public) and 3 write routes (SIWE-protected) following existing Next.js App Router patterns. Routes are thin HTTP handlers that validate with contracts, resolve `activityLedgerStore` from container, query with `getNodeId()`, and return validated output. No facades needed — each route is a single call to the store.

**Frontend data mapping** (from community-ledger mockup):

- **Current Epoch page** → `GET /epochs` (find active) + `GET /epochs/:id/activity` + `GET /epochs/:id/allocations`
- **Epoch History page** → `GET /epochs` (finalized) + `GET /epochs/:id/allocations` + `GET /epochs/:id/statement`
- **Holdings page** → Client-side aggregation from epochs + allocations (V0: few epochs, few users)

**Reuses**:

- Existing `ActivityLedgerStore` port — all read methods already implemented in `DrizzleLedgerAdapter`
- Existing `getContainer().activityLedgerStore` — wired in bootstrap
- Existing `getNodeId()` from `@/shared/config` — provides node_id for all queries
- Existing `wrapRouteHandlerWithLogging` — auth + logging + error handling
- Existing `wrapPublicRoute` — rate limiting + cache headers for read routes
- Existing Zod contract pattern from `src/contracts/schedules.*.v1.contract.ts`

**Rejected**:

- **Composite "epoch detail" endpoint**: Over-engineering — frontend can compose from 2-3 granular calls. Matches REST conventions.
- **Server-side Holdings aggregation endpoint**: V0 has <10 epochs, <20 users. Client-side aggregation is trivial. Add when data volume warrants it.
- **Facade layer**: Routes are single store calls — no shared wiring to extract. Facades add files without value.
- **Approver check on write routes**: The `ledger.approvers` config doesn't exist in repo-spec yet. Deferred to task.0100 (signing + state machine). V0 write routes require SIWE session only — any logged-in user can manage the ledger. This is acceptable for a single-operator node.

### Deferred Routes

| Route                              | Blocked By | Reason                                                       |
| ---------------------------------- | ---------- | ------------------------------------------------------------ |
| `POST /epochs/:id/finalize`        | task.0102  | Needs `FinalizeEpochWorkflow` + `computeProposedAllocations` |
| `GET /verify/epoch/:id`            | task.0102  | Needs `computeProposedAllocations` to recompute and compare  |
| `POST /epochs/:id/close-ingestion` | task.0100  | Needs 3-phase epoch state machine                            |
| `POST /epochs/:id/sign`            | task.0100  | Needs signing workflow + approver config                     |

Contracts for these routes are still defined (Zod schemas have no implementation dependency). Route handlers are created as stubs returning 501 with a clear message.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONTRACTS_SINGLE_SOURCE: All request/response shapes defined in `src/contracts/ledger.*.v1.contract.ts`. Routes, tests, and frontend use `z.infer<>` — no parallel interfaces. (spec: architecture)
- [ ] VALIDATE_IO: Routes parse input before processing, parse output before responding. Fail closed. (spec: architecture)
- [ ] READ_ROUTES_PUBLIC: Read routes use `wrapPublicRoute()` — no auth required, rate-limited. (spec: architecture)
- [ ] WRITE_ROUTES_AUTHED: Write routes use `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })`. (spec: architecture)
- [ ] NODE_SCOPED: All store queries pass `nodeId` from `getNodeId()`, never from user input. (spec: epoch-ledger)
- [ ] ALL_MATH_BIGINT: BigInt values serialized as strings in JSON contracts. Parsed back with `BigInt()` in routes. (spec: epoch-ledger)
- [ ] SIMPLE_SOLUTION: Thin routes, no facades, no extra abstractions. (spec: architecture)
- [ ] ARCHITECTURE_ALIGNMENT: `app → features/contracts/shared` only. Routes never import adapters or core. (spec: architecture)

### API Contracts

#### Read Routes (public)

**1. `GET /api/v1/ledger/epochs`** — List all epochs

```typescript
// ledger.list-epochs.v1.contract.ts
const EpochSchema = z.object({
  id: z.string(), // bigint as string
  status: z.enum(["open", "closed", "review", "finalized"]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  weightConfig: z.record(z.string(), z.number()),
  poolTotalCredits: z.string().nullable(), // bigint as string
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
// Output: { epochs: EpochSchema[] }
```

**2. `GET /api/v1/ledger/epochs/[id]/activity`** — Activity events for epoch

```typescript
// ledger.epoch-activity.v1.contract.ts
const ActivityEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  eventType: z.string(),
  platformUserId: z.string(),
  platformLogin: z.string().nullable(),
  artifactUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  eventTime: z.string().datetime(),
  // Curation join (populated after task.0101, null before)
  curation: z
    .object({
      userId: z.string().nullable(),
      included: z.boolean(),
      weightOverrideMilli: z.string().nullable(), // bigint as string
      note: z.string().nullable(),
    })
    .nullable(),
});
// Output: { events: ActivityEventSchema[], epochId: z.string() }
```

Implementation: Load epoch → `getActivityForWindow(nodeId, periodStart, periodEnd)` + `getCurationForEpoch(epochId)` → join by eventId in handler.

**3. `GET /api/v1/ledger/epochs/[id]/allocations`** — Proposed + final allocations

```typescript
// ledger.epoch-allocations.v1.contract.ts
const AllocationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  proposedUnits: z.string(), // bigint as string
  finalUnits: z.string().nullable(), // bigint as string
  overrideReason: z.string().nullable(),
  activityCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
// Output: { allocations: AllocationSchema[], epochId: z.string() }
```

**4. `GET /api/v1/ledger/epochs/[id]/statement`** — Payout statement

```typescript
// ledger.epoch-statement.v1.contract.ts
const PayoutLineSchema = z.object({
  user_id: z.string(),
  total_units: z.string(),
  share: z.string(),
  amount_credits: z.string(),
});
const StatementSchema = z.object({
  id: z.string(),
  epochId: z.string(),
  allocationSetHash: z.string(),
  poolTotalCredits: z.string(),
  payouts: z.array(PayoutLineSchema),
  supersedesStatementId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
// Output: StatementSchema | null (404 if no statement)
```

**5. `GET /api/v1/ledger/verify/epoch/[id]`** — Verification (stub)

Contract defined. Route returns 501 "Not yet implemented — requires task.0102".

#### Write Routes (SIWE-protected)

**6. `POST /api/v1/ledger/epochs/collect`** — Trigger collection

```typescript
// ledger.collect-epoch.v1.contract.ts
// No input body required — uses repo-spec config for sources/schedule.
// Starts CollectEpochWorkflow via Temporal. Returns 202.
// Output: { accepted: true, message: string }
```

Implementation: Read ledger config from `getGovernanceConfig().ledger`, construct `LedgerIngestRunV1`, start Temporal workflow. Requires Temporal client access (check if container exposes it, or use SDK directly).

**Note**: If Temporal client is not accessible from the app container, this route will be a stub. The schedule already triggers collection daily — the route is a manual trigger for admins.

**7. `PATCH /api/v1/ledger/epochs/[id]/allocations`** — Adjust final_units

```typescript
// ledger.update-allocations.v1.contract.ts
const UpdateAllocationInputSchema = z.object({
  adjustments: z.array(
    z.object({
      userId: z.string(),
      finalUnits: z.string(), // bigint as string
      overrideReason: z.string().optional(),
    })
  ),
});
// Output: { updated: number }
```

Implementation: Parse epoch ID from URL, call `updateAllocationFinalUnits()` for each adjustment. Verify epoch exists and is `open` or `review`.

**8. `POST /api/v1/ledger/epochs/[id]/pool-components`** — Record pool component

```typescript
// ledger.record-pool-component.v1.contract.ts
const PoolComponentInputSchema = z.object({
  componentId: z.string(), // "base_issuance", "kpi_bonus_v0", "top_up"
  algorithmVersion: z.string(),
  inputsJson: z.record(z.string(), z.unknown()),
  amountCredits: z.string(), // bigint as string
  evidenceRef: z.string().optional(),
});
// Output: { id, componentId, amountCredits, computedAt }
```

Implementation: Parse epoch ID from URL, call `insertPoolComponent()` with nodeId from `getNodeId()`.

**9. `POST /api/v1/ledger/epochs/[id]/finalize`** — Finalize (stub)

Contract defined. Route returns 501 "Not yet implemented — requires task.0102".

### Route Structure

```
src/app/api/v1/ledger/
  epochs/
    route.ts                       # GET list + POST collect
    [id]/
      activity/route.ts            # GET
      allocations/route.ts         # GET + PATCH
      pool-components/route.ts     # POST
      statement/route.ts           # GET
      finalize/route.ts            # POST (stub → 501)
  verify/
    epoch/
      [id]/route.ts                # GET (stub → 501)
```

### BigInt Serialization Convention

All bigint values are serialized as strings in JSON:

- `epochId: "123"` (not `123`)
- `proposedUnits: "8000"` (not `8000`)
- `poolTotalCredits: "10000"` (not `10000`)

Routes parse string → BigInt for store calls, and BigInt → string for responses. This is consistent with how `ensureEpochForWindow` already handles `epochId` for Temporal.

### Files

**Create:**

- `src/contracts/ledger.list-epochs.v1.contract.ts` — Epoch list output schema
- `src/contracts/ledger.epoch-activity.v1.contract.ts` — Activity events + curation output schema
- `src/contracts/ledger.epoch-allocations.v1.contract.ts` — Allocations output + update input schema
- `src/contracts/ledger.epoch-statement.v1.contract.ts` — Payout statement output schema
- `src/contracts/ledger.verify-epoch.v1.contract.ts` — Verification report schema (stub)
- `src/contracts/ledger.collect-epoch.v1.contract.ts` — Collection trigger schema
- `src/contracts/ledger.update-allocations.v1.contract.ts` — Allocation adjustment input schema
- `src/contracts/ledger.record-pool-component.v1.contract.ts` — Pool component input/output schema
- `src/contracts/ledger.finalize-epoch.v1.contract.ts` — Finalize trigger schema (stub)
- `src/app/api/v1/ledger/epochs/route.ts` — GET list + POST collect
- `src/app/api/v1/ledger/epochs/[id]/activity/route.ts` — GET activity
- `src/app/api/v1/ledger/epochs/[id]/allocations/route.ts` — GET + PATCH allocations
- `src/app/api/v1/ledger/epochs/[id]/pool-components/route.ts` — POST pool component
- `src/app/api/v1/ledger/epochs/[id]/statement/route.ts` — GET statement
- `src/app/api/v1/ledger/epochs/[id]/finalize/route.ts` — POST stub
- `src/app/api/v1/ledger/verify/epoch/[id]/route.ts` — GET stub

**Test:**

- `tests/stack/ledger/ledger-api.stack.test.ts` — Stack test: seed data → query all read routes → verify shapes

**Modify:**

- `src/contracts/AGENTS.md` — Add ledger contracts to public surface list

### Implementation Details

#### Route Handler Pattern

Each route follows the existing schedule route pattern:

```typescript
import { getContainer } from "@/bootstrap/container";
import { wrapPublicRoute } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { listEpochsOperation } from "@/contracts/ledger.list-epochs.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapPublicRoute(
  { routeId: "ledger.list-epochs" },
  async (ctx) => {
    const store = getContainer().activityLedgerStore;
    const epochs = await store.listEpochs(getNodeId());
    return NextResponse.json(
      listEpochsOperation.output.parse({ epochs: epochs.map(toEpochDto) })
    );
  }
);
```

#### DTO Mapping

BigInt/Date → string conversion in a shared mapper (inline in route file or a small `_lib/ledger-dto.ts`):

```typescript
function toEpochDto(e: LedgerEpoch) {
  return {
    id: e.id.toString(),
    status: e.status,
    periodStart: e.periodStart.toISOString(),
    periodEnd: e.periodEnd.toISOString(),
    weightConfig: e.weightConfig,
    poolTotalCredits: e.poolTotalCredits?.toString() ?? null,
    openedAt: e.openedAt.toISOString(),
    closedAt: e.closedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}
```

#### Activity + Curation Join

The activity route joins events with curations in-memory (V0 data sizes make this trivial):

```typescript
const epoch = await store.getEpoch(epochId);
const events = await store.getActivityForWindow(
  nodeId,
  epoch.periodStart,
  epoch.periodEnd
);
const curations = await store.getCurationForEpoch(epochId);
const curationMap = new Map(curations.map((c) => [c.eventId, c]));

const enriched = events.map((e) => ({
  ...toEventDto(e),
  curation: curationMap.has(e.id)
    ? toCurationDto(curationMap.get(e.id)!)
    : null,
}));
```

#### Collect Trigger

The collect route needs a Temporal client to start `CollectEpochWorkflow`. If the container doesn't expose a Temporal client, this route is a stub. Check: does the app have access to Temporal SDK? The scheduler-worker has it, but the Next.js app may not.

Fallback: If no Temporal client in app, the route returns 501 with a message directing to the Temporal schedule (which already runs daily at 6am UTC). Manual triggers can wait for Temporal client wiring.

## Plan

- [ ] Define 9 Zod contract files in `src/contracts/ledger.*.v1.contract.ts`
- [ ] Create route directory structure under `src/app/api/v1/ledger/`
- [ ] Implement 4 read routes: list-epochs, activity, allocations, statement
- [ ] Implement 2 write routes: update-allocations, record-pool-component
- [ ] Implement collect trigger (or stub if no Temporal client in app)
- [ ] Stub 2 deferred routes: finalize (501), verify (501)
- [ ] Add DTO mappers for BigInt/Date serialization
- [ ] Write stack test: seed epoch + events → query all read routes → verify contract shapes
- [ ] Update `src/contracts/AGENTS.md` public surface list
- [ ] `pnpm check` clean

## Validation

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

## Review Checklist

- [ ] **Work Item:** `task.0096` linked in PR body
- [ ] **Spec:** NODE_SCOPED, ALL_MATH_BIGINT upheld
- [ ] **Contracts:** All 9 defined, shapes match spec schema
- [ ] **BigInt:** Serialized as strings in all JSON responses
- [ ] **Auth:** Read routes public (wrapPublicRoute), write routes SIWE-protected
- [ ] **Tests:** Stack test covers read routes with seeded data
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: TBD
- Frontend mockup: `/Users/derek/dev/community-ledger/` (Lovable.dev React app)

## Attribution

-
