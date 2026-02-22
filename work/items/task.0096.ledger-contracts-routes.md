---
id: task.0096
type: task
title: "Ledger Zod contracts + API routes (2 write, 4 read) + stack tests"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Define 6 Zod contracts, implement 4 public read routes (under /api/v1/public/ledger/) and 2 SIWE-protected write routes (under /api/v1/ledger/), with stack tests. Deferred: collect trigger, finalize, verify, close-ingestion, sign."
outcome: "Frontend can display current epoch, past epochs with allocations, and payout statements. Admins can adjust allocations and record pool components via API."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-api-routes
pr:
reviewer:
revision: 2
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

**Solution**: 6 Zod contracts defining ledger API shapes. 4 read routes (public, under `/api/v1/public/ledger/`) and 2 write routes (SIWE-protected, under `/api/v1/ledger/`) following existing Next.js App Router patterns. Routes are thin HTTP handlers that validate with contracts, resolve `activityLedgerStore` from container, query with `getNodeId()`, and return validated output. No facades needed — each route is a single call to the store.

**URL namespace split** (per `src/proxy.ts` auth perimeter): The auth proxy rejects all `/api/v1/*` requests without a session, except `/api/v1/public/*`. Read routes MUST be under `/api/v1/public/ledger/` to be accessible without SIWE login. Write routes stay under `/api/v1/ledger/` (auth-protected).

**Frontend data mapping** (from community-ledger mockup):

- **Current Epoch page** → `GET /public/ledger/epochs` (find active) + `GET /public/ledger/epochs/:id/activity` + `GET /public/ledger/epochs/:id/allocations`
- **Epoch History page** → `GET /public/ledger/epochs` (finalized) + `GET /public/ledger/epochs/:id/allocations` + `GET /public/ledger/epochs/:id/statement`
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

### Deferred Routes (no stubs — contracts + routes created when features land)

| Route                              | Blocked By | Reason                                                                                |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `POST /epochs/collect`             | follow-up  | Needs Temporal `triggerSchedule` port method — daily schedule already runs collection |
| `POST /epochs/:id/finalize`        | task.0102  | Needs `FinalizeEpochWorkflow` + `computeProposedAllocations`                          |
| `GET /verify/epoch/:id`            | task.0102  | Needs `computeProposedAllocations` to recompute and compare                           |
| `POST /epochs/:id/close-ingestion` | task.0100  | Needs 3-phase epoch state machine                                                     |
| `POST /epochs/:id/sign`            | task.0100  | Needs signing workflow + approver config                                              |

No stub files created for deferred routes. Contracts and route handlers are added when their blocking tasks land. This avoids dead code that needs updating later.

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

#### Read Routes (public — under `/api/v1/public/ledger/`)

**1. `GET /api/v1/public/ledger/epochs`** — List all epochs

```typescript
// ledger.list-epochs.v1.contract.ts
const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const EpochSchema = z.object({
  id: z.string(), // bigint as string
  status: z.enum(["open", "closed"]), // matches current EpochStatus model
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  weightConfig: z.record(z.string(), z.number()),
  poolTotalCredits: z.string().nullable(), // bigint as string
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
// Output: { epochs: EpochSchema[], total: number }
```

Note: `status` enum matches the current `EpochStatus = "open" | "closed"` from `packages/ledger-core/src/model.ts`. When task.0100 implements 3-phase lifecycle, the model AND this contract are updated together.

**2. `GET /api/v1/public/ledger/epochs/[id]/activity`** — Activity events for epoch

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
// Input: PaginationQuerySchema (limit, offset)
// Output: { events: ActivityEventSchema[], epochId: z.string(), total: number }
```

Implementation: Load epoch → `getActivityForWindow(nodeId, periodStart, periodEnd)` + `getCurationForEpoch(epochId)` → join by eventId in handler → apply `offset`/`limit` via `slice()`.

**3. `GET /api/v1/public/ledger/epochs/[id]/allocations`** — Proposed + final allocations

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

**4. `GET /api/v1/public/ledger/epochs/[id]/statement`** — Payout statement

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

#### Write Routes (SIWE-protected — under `/api/v1/ledger/`)

**5. `PATCH /api/v1/ledger/epochs/[id]/allocations`** — Adjust final_units

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

Implementation: Parse epoch ID from URL, call `updateAllocationFinalUnits()` for each adjustment. Verify epoch exists and is `open` (or `review` once task.0100 lands).

**6. `POST /api/v1/ledger/epochs/[id]/pool-components`** — Record pool component

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

### Route Structure

```
src/app/api/v1/
  public/ledger/                         # Read routes (no auth — proxy passes through)
    epochs/
      route.ts                           # GET list
      [id]/
        activity/route.ts               # GET
        allocations/route.ts            # GET
        statement/route.ts              # GET
  ledger/                                # Write routes (SIWE-protected by proxy)
    epochs/
      [id]/
        allocations/route.ts            # PATCH
        pool-components/route.ts        # POST
```

### BigInt Serialization Convention

All bigint values are serialized as strings in JSON:

- `epochId: "123"` (not `123`)
- `proposedUnits: "8000"` (not `8000`)
- `poolTotalCredits: "10000"` (not `10000`)

Routes parse string → BigInt for store calls, and BigInt → string for responses. This is consistent with how `ensureEpochForWindow` already handles `epochId` for Temporal.

### Files

**Create:**

- `src/contracts/ledger.list-epochs.v1.contract.ts` — Epoch list output + pagination input schema
- `src/contracts/ledger.epoch-activity.v1.contract.ts` — Activity events + curation output schema
- `src/contracts/ledger.epoch-allocations.v1.contract.ts` — Allocations output + update input schema
- `src/contracts/ledger.epoch-statement.v1.contract.ts` — Payout statement output schema
- `src/contracts/ledger.update-allocations.v1.contract.ts` — Allocation adjustment input schema
- `src/contracts/ledger.record-pool-component.v1.contract.ts` — Pool component input/output schema
- `src/app/api/v1/public/ledger/epochs/route.ts` — GET list (public)
- `src/app/api/v1/public/ledger/epochs/[id]/activity/route.ts` — GET activity (public)
- `src/app/api/v1/public/ledger/epochs/[id]/allocations/route.ts` — GET allocations (public)
- `src/app/api/v1/public/ledger/epochs/[id]/statement/route.ts` — GET statement (public)
- `src/app/api/v1/ledger/epochs/[id]/allocations/route.ts` — PATCH allocations (SIWE)
- `src/app/api/v1/ledger/epochs/[id]/pool-components/route.ts` — POST pool component (SIWE)

**Test:**

- `tests/stack/ledger/ledger-api.stack.test.ts` — Stack test: seed data → query all read routes → verify shapes

**Modify:**

- `src/contracts/AGENTS.md` — Add ledger contracts to public surface list

### Implementation Details

#### Route Handler Pattern

Read routes use `wrapPublicRoute` (rate-limited, no auth, under `/api/v1/public/`). Write routes use `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })` (under `/api/v1/`).

```typescript
// src/app/api/v1/public/ledger/epochs/route.ts
import { getContainer } from "@/bootstrap/container";
import { wrapPublicRoute } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { listEpochsOperation } from "@/contracts/ledger.list-epochs.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapPublicRoute(
  { routeId: "ledger.list-epochs" },
  async (ctx, request) => {
    const url = new URL(request.url);
    const { limit, offset } = listEpochsOperation.input.parse({
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
    const store = getContainer().activityLedgerStore;
    const allEpochs = await store.listEpochs(getNodeId());
    const page = allEpochs.slice(offset, offset + limit);
    return NextResponse.json(
      listEpochsOperation.output.parse({
        epochs: page.map(toEpochDto),
        total: allEpochs.length,
      })
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

## Plan

- [ ] Define 6 Zod contract files in `src/contracts/ledger.*.v1.contract.ts`
- [ ] Create route directory structure under `src/app/api/v1/public/ledger/` (reads) and `src/app/api/v1/ledger/` (writes)
- [ ] Implement 4 read routes: list-epochs (paginated), activity (paginated), allocations, statement
- [ ] Implement 2 write routes: update-allocations, record-pool-component
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
- [ ] **Contracts:** 6 defined, shapes match spec schema + current EpochStatus model
- [ ] **BigInt:** Serialized as strings in all JSON responses
- [ ] **Auth namespace:** Read routes under `/api/v1/public/ledger/` (wrapPublicRoute), write routes under `/api/v1/ledger/` (SIWE)
- [ ] **Pagination:** list-epochs and epoch-activity support `?limit=N&offset=M`
- [ ] **No stubs:** No 501 route files — deferred features have no files
- [ ] **Tests:** Stack test covers read routes with seeded data
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: TBD
- Frontend mockup: `/Users/derek/dev/community-ledger/` (Lovable.dev React app)

## Attribution

-
