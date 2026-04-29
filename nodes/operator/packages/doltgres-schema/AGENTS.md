# operator-doltgres-schema · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable
- **Package:** `@cogni/operator-doltgres-schema`

## Purpose

Drizzle ORM table definitions for **operator-local Doltgres** tables (`knowledge_operator` database). Owned by and namespaced to the operator node. Mirrors `@cogni/poly-doltgres-schema` shape.

Today's contents: the `work_items` table that backs operator's API for newly-created work items (task.0423 v0 — Doltgres replaces markdown for new items). Future tables: `work_relations` + `work_external_refs` (deferred to v1), agent-knowledge claims, etc.

## Pointers

- [Work Items Port Spec](../../../../docs/spec/work-items-port.md) — port + adapter contract
- [Knowledge Data Plane Spec](../../../../docs/spec/knowledge-data-plane.md) — Doltgres-side architecture
- [Packages Architecture](../../../../docs/spec/packages-architecture.md) — workspace package shape
- [@cogni/poly-doltgres-schema](../../../poly/packages/doltgres-schema/AGENTS.md) — sibling package; reference structure
- [task.0423](../../../../work/items/task.0423.doltgres-work-items-source-of-truth.md) — design + invariants

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** `drizzle-orm` only.

## Public Surface

- **Subpath exports:**
  - `@cogni/operator-doltgres-schema` — root barrel re-exports every slice
  - `@cogni/operator-doltgres-schema/work-items` — `work_items` table + `WorkItemRow` / `NewWorkItemRow` inferred types

## Responsibilities

- **Does:** define Drizzle table schemas for operator-local Doltgres tables.
- **Does not:** contain queries, adapters, business logic, RLS policies, or any I/O.

## Dialect separation (non-negotiable)

This package is globbed ONLY by `nodes/operator/drizzle.doltgres.config.ts` (Doltgres target). `nodes/operator/drizzle.config.ts` (Postgres target) MUST NOT include this path — if it did, the Postgres migrator would try creating the `work_items` table in operator's Postgres DB.

## Migrator behavior (runs in operator migrator initContainer)

```bash
# Container entrypoint for the Doltgres migration:
pnpm db:migrate:operator:doltgres:container
```

That script runs `drizzle-kit migrate` natively against `DATABASE_URL` pointing at `knowledge_operator`. After drizzle-kit completes, `stamp-commit.mjs` runs `SELECT dolt_commit('-Am', '...')` to land DDL in `dolt_log` (DDL doesn't auto-commit per [dolt#4843](https://github.com/dolthub/dolt/issues/4843)).

## Notes

- Mirrors poly's pattern (`@cogni/poly-doltgres-schema`) verbatim. Keep the two packages structurally aligned for cross-node syntropy.
- Sibling: `@cogni/db-schema` (Postgres tables, shared core).
- v0 holds work items as a single table with jsonb arrays for assignees/external_refs/labels/spec_refs. v1 breaks out `work_relations` + `work_external_refs` into separate tables.
