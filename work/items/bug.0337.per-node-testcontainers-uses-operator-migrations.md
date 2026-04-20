---
id: bug.0337
type: bug
title: Per-node testcontainers setup uses operator's migrations — drift once any node diverges
status: needs_triage
priority: 2
rank: 50
estimate: 2
summary: All four nodes (`operator`, `poly`, `resy`, `node-template`) have their own `tests/component/setup/testcontainers-postgres.global.ts`, and every one of them runs `pnpm -w db:migrate:direct` — which is aliased to **operator's** drizzle config only (`--config=nodes/operator/drizzle.config.ts`). After task.0324 made migrations per-node, poly's `0028_small_doomsday.sql` (synced_at, task.0328) and `0029_poly_copy_trade_multitenant.sql` (tenant scoping, task.0318) live only in poly's migrations dir. Poly's testcontainers therefore boot against a test DB that's missing all poly-specific schema changes — component tests that touch `poly_copy_trade_*` fail with `column "billing_account_id" of relation "poly_copy_trade_config" does not exist` (see PR #944 CI run 24652686991). Same drift will hit `resy` and `node-template` the first time they add a node-specific migration.
outcome: Each node's component-test globalSetup runs THAT node's migrations (`db:migrate:<node>:container`), not operator's. Poly already fixed in PR #944; resy + node-template fixed preemptively. Operator's `0027_silent_nextwave.sql` cleaned of poly-specific `poly_copy_trade_*` tables (legacy cross-node contamination from pre-task.0324).
spec_refs:
  - databases
assignees: derekg1729
credit:
project: proj.database-ops
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [db, migrations, testcontainers, per-node, ci]
external_refs:
  - work/items/task.0324.per-node-db-schema-independence.md
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - work/items/task.0328.poly-sync-truth-ledger-cache.md
---

# Per-node testcontainers setup uses operator's migrations

> Surfaced in PR #944 (task.0318 Phase A). Fixed for poly on that PR; resy + node-template still at risk.

## Reproducer

PR #944 CI run [24652686991](https://github.com/Cogni-DAO/node-template/actions/runs/24652686991/job/72078967841) component job:

```
PostgresError: column "billing_account_id" of relation "poly_copy_trade_config" does not exist
  query: insert into "poly_copy_trade_config" ("billing_account_id", "created_by_user_id", …)
```

Failure in `tests/component/copy-trade/db-target-source.int.test.ts` and `tests/component/copy-trade/targets-route.int.test.ts`. Tests expect the Phase A schema (migration 0029); DB had the Phase-0 schema because only operator's `0001-0027` migrations applied.

## Root cause — two facts that only drift once a node diverges

1. **`pnpm -w db:migrate:direct` is hardcoded to operator.**

   ```json
   "db:migrate:direct": "tsx node_modules/drizzle-kit/bin.cjs migrate --config=nodes/operator/drizzle.config.ts"
   ```

   Only applies migrations under `nodes/operator/app/src/adapters/server/db/migrations/`.

2. **All four testcontainers setups call it.**

   | File                                                                                 | Last migration it gets                                      |
   | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
   | `nodes/operator/app/tests/component/setup/testcontainers-postgres.global.ts:90`      | operator's 0027 (✓ correct)                                 |
   | `nodes/poly/app/tests/component/setup/testcontainers-postgres.global.ts:90`          | operator's 0027 (❌ misses poly 0028, 0029)                 |
   | `nodes/resy/app/tests/component/setup/testcontainers-postgres.global.ts:90`          | operator's 0027 (❌ will miss any resy divergence)          |
   | `nodes/node-template/app/tests/component/setup/testcontainers-postgres.global.ts:90` | operator's 0027 (❌ will miss any node-template divergence) |

Historical reason the pattern hasn't bitten before: operator's `0027_silent_nextwave.sql` **redundantly contains poly-specific tables** (`poly_copy_trade_fills/config/decisions`) — legacy cross-node contamination predating task.0324. So prior poly component tests happened to see the Phase-0 copy-trade schema via the operator migrations. That contamination is the second half of the bug: operator carries dead SQL it doesn't use.

## Fix plan

### Immediate (per-node fix)

- [x] **Poly** — `nodes/poly/app/tests/component/setup/testcontainers-postgres.global.ts` → `pnpm -w db:migrate:poly:container`. Shipped in PR #944 commit `c116fd567`.
- [ ] **Resy** — `nodes/resy/app/tests/component/setup/testcontainers-postgres.global.ts` → `pnpm -w db:migrate:resy:container`. Preemptive, no failure observed yet but guaranteed to drift.
- [ ] **Node-template** — same pattern. Currently has no node-specific migrations (stops at operator's 0026), but will drift the first time it adds one.

### Structural (remove the trap)

- [ ] **Clean operator's `0027_silent_nextwave.sql`** of `poly_copy_trade_*` DDL. Operator doesn't use those tables. The presence makes the drift invisible until a new migration is added in a downstream node. Follow-up migration on operator's dir: `DROP TABLE IF EXISTS poly_copy_trade_fills, poly_copy_trade_config, poly_copy_trade_decisions CASCADE;` — but only once we're confident no env has old data needing preservation.
- [ ] **Audit `db:migrate:direct` + `db:migrate:container` aliases.** Currently:
  ```json
  "db:migrate:direct": "… --config=nodes/operator/drizzle.config.ts",
  "db:migrate:container": "pnpm db:migrate:direct"
  ```
  Rename to `db:migrate:operator:direct` / `db:migrate:operator:container` for clarity, or delete the generic variants entirely so callers must pick a node. Avoids the "which config does this resolve to?" pitfall.
- [ ] **Lint rule or arch-probe**: assert that every `nodes/<N>/app/tests/component/setup/testcontainers-postgres.global.ts` invokes `db:migrate:<N>:container` for its own node. A 5-line grep in `scripts/check-fast.sh` or an arch probe rule would have prevented this.

## Why this matters for proj.database-ops

This project owns per-node schema independence (task.0324 "Per-Node Schema Independence" deliverable). The testcontainers setup was missed in that migration — the test path still goes through operator's migrations, making per-node drift invisible during local + CI testing until the node-specific code is actually exercised. Closes a gap in task.0324's invariant.

## Not in scope

- Runtime (production) migration application — that already uses the correct per-node migrator images (`db:migrate:<node>:container`).
- Stack tests — they also run against real DB via compose, which uses per-node migrator images.
- Doltgres migrations — separate pipeline (`db:migrate:<node>:doltgres:container`), not affected.

## Validation

- exercise: From a fresh worktree, run `pnpm test:comp` (or a single-file subset: `pnpm exec vitest run --config nodes/resy/app/vitest.component.config.mts …`) and assert each node's component tests see their OWN migrations — add a node-specific sentinel table in `nodes/resy/packages/db-schema/` + migration, expect resy component tests to access it and operator component tests to NOT see it. For poly the Phase A round-trip test (`tests/component/copy-trade/targets-route.int.test.ts`) already exercises this — it POSTs a target and reads it back, which requires migration 0029's `billing_account_id` column.
- observability: CI component-job step logs show `[✓] migrations applied successfully!` followed by that node's `_journal.json` high-water mark. For poly post-fix: last applied should be `0029_poly_copy_trade_multitenant`; for resy post-fix: the resy-specific migration count, not operator's.
