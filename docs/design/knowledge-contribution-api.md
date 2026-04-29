---
id: knowledge-contribution-api
type: design
title: "Knowledge Contribution API — Dolt branch-per-PR for external agents"
status: draft
spec_refs:
  - knowledge-data-plane-spec
  - agent-contributor-protocol
work_items:
  - task.0425
created: 2026-04-29
---

# Knowledge Contribution API — Dolt branch-per-PR for external agents

> External agents submit knowledge the same way they submit code: branch, commit, PR, merge. Internal writes still go straight to trunk. Knowledge gets the same trunk-based discipline as our git workflow.

## Context

`docs/spec/knowledge-data-plane.md` defines `KnowledgeClass: experimental` and "knowledge moves upward by explicit promotion only" — but lists "branching, remotes, or cross-node sharing — single branch (`main`) only" as a Non-Goal. That contradiction has been pinned to v0; this design lifts it for the **external contribution path only**.

PR #1130 (`task.0424`) shipped the doltgres-on-operator scaffold: drizzle schema package, drizzle-kit migrator initContainer, `DoltgresOperatorWorkItemAdapter` with `sql.unsafe + escapeValue` pattern, `AUTO_COMMIT_ON_WRITE`. This design reuses that scaffold and extends it to the `knowledge` table on both poly and operator.

## Goals

1. External agents (registered via `/api/v1/agent/register`) can contribute schema-aligned knowledge entries without a UI.
2. Each contribution is a **Dolt branch** (`contrib/<agent>-<id>`) — one branch = one PR-equivalent. Mirrors our trunk-based git workflow.
3. Authorized operators review via `dolt_diff` and merge via `dolt_merge`. v0 = curl + JSON; web review UI is vFuture.
4. Internal `core__knowledge_write` (existing agent-runtime tool) is **unchanged** — keeps writing straight to `main`.
5. Poly and operator both ship the `knowledge` table + identical routes in the same PR. No node-asymmetry.

## Non-Goals

- Web UI for diff review — curl + JSON only in v0.
- Long-lived per-agent branches / multi-commit PRs — single-commit branches only.
- Real RBAC tables or per-user knowledge RLS — explicit allowlist of operator session-user IDs in v0.
- Cross-node fan-out — one contribution targets one node's database.
- Resy or other future nodes — poly + operator only.
- MCP tool for knowledge-contribute — HTTP only in v0.

## Architecture

### Layering (hexagonal)

```
┌─────────────────────────────────────────────────────────────┐
│ HTTP route                                                   │
│ /api/v1/knowledge/contributions/* (per-node)                │
│   - validates against knowledge.contribute.v1.contract.ts   │
│   - resolves principal via getSessionUser                    │
│   - calls contribution facade                                │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Facade (per-node)                                            │
│ app/_facades/knowledge/contributions.server.ts              │
│   - thin wrapper that injects principal into port calls     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Port: KnowledgeContributionPort                              │
│ packages/knowledge-store/src/port/contribution.port.ts       │
│   create / list / get / diff / merge / close                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Adapter: DoltgresKnowledgeContributionAdapter                │
│ packages/knowledge-store/src/adapters/doltgres/contribution-adapter.ts │
│   - sql.unsafe + escapeValue (Doltgres extended-protocol)   │
│   - dolt_checkout / dolt_commit / dolt_merge / dolt_branch   │
└──────────────────────────────────────────────────────────────┘
```

### Branch lifecycle

```
                  ┌────────────────────────────────┐
   POST /create   │ 1. dolt_checkout('-b',         │
   ─────────────► │      'contrib/<agent>-<id>',   │
                  │      'main')                    │
                  │ 2. INSERT INTO knowledge ...    │
                  │ 3. dolt_commit('-Am', msg)      │
                  │ 4. dolt_checkout('main')        │
                  └──────────────┬─────────────────┘
                                 │
                                 ▼
                       branch lives in dolt
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │                         │                         │
   GET /diff                 POST /merge              POST /close
   dolt_diff(main,branch)    dolt_merge(branch)       dolt_branch -d
                             dolt_branch -d
```

### Concurrency model

- Adapter holds a **single connection** with `dolt_checkout` mutating session state. To avoid checkout-races, every contribution op runs inside an `await mutex.runExclusive(...)` keyed per node-database. v0 = in-process mutex; multi-replica safety deferred (only one operator pod replica today).
- After every op the adapter explicitly `dolt_checkout('main')` to leave the connection on a known branch.

### Schema (no change)

The `knowledge` table is **already defined** in `packages/knowledge-store/`. Operator's doltgres-schema package adds it via a new migration `0001_add_knowledge.sql` (mirrors poly's). No schema changes — the same shape works for branched and main writes.

## Contracts

`packages/node-contracts/src/knowledge.contribute.v1.contract.ts`:

```typescript
import { z } from "zod";

export const KnowledgeEntryInput = z.object({
  domain: z.string().min(1).max(64),
  entityId: z.string().max(128).optional(),
  title: z.string().min(1).max(256),
  content: z.string().min(1).max(8192),
  tags: z.array(z.string().max(64)).max(32).optional(),
  confidencePct: z.number().int().min(0).max(100).optional(),
});

export const ContributionCreateInput = z.object({
  node: z.enum(["poly", "operator"]),
  message: z.string().min(1).max(512),
  entries: z.array(KnowledgeEntryInput).min(1).max(50),
});

export const ContributionRecord = z.object({
  contributionId: z.string(),
  branch: z.string(),
  commitHash: z.string(),
  authorPrincipal: z.string(),
  message: z.string(),
  entryCount: z.number().int(),
  state: z.enum(["open", "merged", "closed"]),
  createdAt: z.string(),
});

export const ContributionDiffEntry = z.object({
  changeType: z.enum(["added", "modified", "removed"]),
  rowId: z.string(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
});
```

## Port

`packages/knowledge-store/src/port/contribution.port.ts`:

```typescript
export interface KnowledgeContributionPort {
  create(input: {
    principal: Principal;
    message: string;
    entries: KnowledgeEntryInput[];
  }): Promise<ContributionRecord>;

  list(opts?: {
    state?: "open" | "merged" | "closed" | "all";
    limit?: number;
  }): Promise<ContributionRecord[]>;

  get(contributionId: string): Promise<ContributionRecord | null>;

  diff(contributionId: string): Promise<ContributionDiffEntry[]>;

  merge(input: {
    contributionId: string;
    principal: Principal;
  }): Promise<{ commitHash: string }>;

  close(input: {
    contributionId: string;
    principal: Principal;
  }): Promise<void>;
}
```

## Auth

Reuses #1130's `getSessionUser` resolver. Capability check `canMergeKnowledge(principal)`:

```typescript
export function canMergeKnowledge(principal: Principal): boolean {
  if (principal.kind === "user" && principal.role === "admin") return true;
  return process.env.KNOWLEDGE_MERGE_ALLOWLIST?.split(",").includes(principal.id) ?? false;
}
```

`KNOWLEDGE_MERGE_ALLOWLIST` env var = comma-separated principal IDs. Derek's principal added on candidate-a + prod via secret. v1 replaces with real role/RBAC.

## Spec edits required

`docs/spec/knowledge-data-plane.md`:

1. **Non-Goals** — replace "Branching, remotes, or cross-node sharing — single branch (`main`) only" with "Long-lived feature branches, multi-commit PRs, cross-node remotes, fan-out." Single-commit external-contribution branches are now in scope.
2. **Invariants** — add:
   - `EXTERNAL_CONTRIB_VIA_BRANCH`: external-agent writes to `knowledge` go through `contrib/<agent>-<id>` branches; only operator-role principals may merge to `main`.
   - `KNOWLEDGE_TABLE_ON_EVERY_NODE`: every node's knowledge database has the `knowledge` table.
   - `INTERNAL_WRITES_TO_MAIN`: `core__knowledge_write` (agent-runtime) writes straight to `main`. Branching is the **external** contribution path only.
3. **Knowledge Classes** — flesh out `experimental` lifecycle: external-agent contribution lands as `experimental` on a contrib branch; operator merge promotes to `node-private` on `main`. Document this concretely.

## Implementation phases

Phase 1 — **Operator gets `knowledge` table** (unblocks parity):
- Add `knowledge` Drizzle definition to `nodes/operator/packages/doltgres-schema/src/`.
- Generate migration `0001_add_knowledge.sql` via drizzle-kit.
- `stamp-commit.mjs` already handles post-migrate commit.

Phase 2 — **Port + adapter**:
- `KnowledgeContributionPort` interface in `packages/knowledge-store/src/port/`.
- `DoltgresKnowledgeContributionAdapter` in `packages/knowledge-store/src/adapters/doltgres/`. Reuses `buildDoltgresClient()`. Adds `async-mutex` for branch-checkout serialization.

Phase 3 — **Routes (factored, mounted per-node)**:
- Shared route handler factory in `packages/knowledge-store/src/http/routes.ts` (or `nodes/{node}/app/src/app/api/v1/knowledge/contributions/` if Next-router conventions force per-node files; verify during implementation).
- Per-node bootstrap wires the adapter from `DOLTGRES_URL_<NODE>`.
- Both poly + operator mount.

Phase 4 — **Validation on candidate-a**:
- Run the `exercise:` block from `task.0425`.
- Confirm Loki shows the contribute request + `dolt_commit` log line.
- Comment on PR with results, flip `deploy_verified: true` (note: per memory `feedback_deploy_verified_noise.md`, frontmatter flip is noise — PR comment is the real signal).

## Open Questions

- **Mutex scope** — process-local is fine for v0 (single operator pod). When we go multi-replica we need `dolt_lock` semaphore or a Postgres advisory lock keyed on the dolt database. Defer.
- **Idempotency** — should POST `/contributions` be idempotent on a client-supplied `contributionKey`? Useful for retries. v0: no, agent retries get duplicate branches. v1 likely yes.
- **Confidence cap** — should non-operator principals be locked to 30%, or allowed to claim higher and let operator vet on merge? v0: server-cap to 30% for `kind: agent`; operator can patch on merge (separate flow, not in v0). Document this in the contract comment.

## Test surface

- Unit: contract validation (Zod), `canMergeKnowledge` allowlist parsing.
- Component (testcontainer Doltgres): adapter `create → list → diff → merge` happy path; `merge` conflict → 409; `close` drops branch.
- Stack (poly app + Doltgres): full HTTP roundtrip from `/api/v1/agent/register` → contribute → merge.

## Risks

- **`dolt_checkout` connection-state leak** — if a request errors between `dolt_checkout('-b')` and `dolt_checkout('main')`, the connection is left on a feature branch. Adapter must wrap in try/finally and force checkout-main on error. Tested in component layer.
- **Branch-namespace pollution** — closed branches dropped immediately, but if `close` is never called we accumulate `contrib/*` branches. v0: 30-day GC job is a v1 concern; document in spec.
- **Postgres-protocol gotchas** — already mitigated in #1130 (`prepare: false`, fresh connection per migrate phase, simple protocol). Inherit those.
