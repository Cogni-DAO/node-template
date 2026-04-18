---
id: task.0322
type: task
title: Per-node DB schema independence (core package + per-node extensions)
status: needs_implement
priority: 2
rank: 50
estimate: 8
summary: Split the shared DB schema into a versioned `@cogni/db-core` package plus per-node extension schemas so each node owns its migration history without silent drift, shared-numbering collisions, or cross-node table leakage.
outcome: Each node's DB contains only tables it needs, has its own `__drizzle_migrations_<node>` history, and accepts new core migrations via a single versioned package bump. A single parameterized migrator image serves all nodes. Deployed DBs migrate into the new model idempotently (no re-apply crashes on rollout).
spec_refs:
  - ci-cd-spec
  - databases-spec
assignees:
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [db, monorepo, architecture, cicd]
external_refs:
---

# Per-node DB schema independence

## Context — current state (audited 2026-04-18)

| Aspect | Reality |
|---|---|
| Per-node DBs (dev + k8s) | ✅ `cogni_template_dev`, `cogni_poly`, `cogni_resy`. Dev URLs in `package.json:42-43`. Prod overlays patch per-node secrets. |
| Schema source | ⚠️ Single shared `packages/db-schema` package. Every node's DB contains every node's tables (poly's `polyCopyTradeConfig` lives in resy's DB). |
| Per-node migration dirs | ⚠️ Exist but are byte-identical copies of operator's 0000-0026. Operator ahead at 0027. No per-node extension mechanism. |
| Migration runner (dev) | ⚠️ `db:migrate:poly` / `db:migrate:resy` swap `DATABASE_URL` then run the root drizzle-kit against operator's out dir. Node migrations aren't isolated. |
| K8s migration Job (preview) | ⚠️ Shared operator migrator image applied against each node's DB. |
| K8s migration Job (production) | 🚩 Poly/resy overlays set `exit 0`. No prod migrations ever. `infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95`. |
| Doc accuracy | 🚩 `docs/guides/multi-node-dev.md:103-117` claimed shared `cogni_template_dev` + shared NextAuth sessions. Both false — corrected in Step 1 PR of this task. |

**Real problem:** adding a node-local table means editing the shared package, which ships it to every node's DB for no reason, and claims a globally-sequential migration number that any node could collide with. The current model forces nodes to share schema even when DBs are separate — the worst of both worlds.

## Design — per-package migration history, single parameterized migrator

Pick: Django/Rails-engine/Medusa.js-style per-package migration tables, composed at runtime by a node-aware migrator. The shape is explicitly "reinventing Django migrations for Drizzle" — own that framing rather than pretending it's novel.

### Step 0 (blocking) — Evaluate Atlas before committing to bespoke two-phase drizzle runner

[Atlas](https://atlasgo.io) (Ariga, CNCF-adjacent) supports multi-module schema composition natively and integrates with drizzle via `drizzle-kit export`. Before building any two-phase runner by hand, prototype Atlas for one day:

- Generate HCL from the current `packages/db-schema` via `drizzle-kit export`
- Compose one "core" module + one "poly" module, apply to a local `cogni_poly` DB
- Verify migration history tracked in `atlas_schema_revisions` with module namespacing
- Confirm drizzle-orm at runtime still reads tables defined in TS (Atlas owns DDL; drizzle owns DML)

**Decision output:** a 1-page doc `docs/spec/db-migration-tooling-decision.md` with adopt/reject verdict, tradeoff matrix, and if rejected, the concrete friction that disqualified it. If adopted, Steps 2–7 below are replaced wholesale by Atlas module config.

The rest of this plan assumes **rejection** (drizzle-kit continues as the generator). If Atlas is adopted, rewrite this task.

### The two critical invariants

- **CORE_MIGRATIONS_IDEMPOTENT_ON_LEGACY_DBS** — on first run against a DB that already has `__drizzle_migrations` populated, the runner MUST copy `hash`/`created_at` rows forward into `__drizzle_migrations_core` instead of re-applying migrations. Non-negotiable — blocks every existing preview/prod DB otherwise.
- **NODE_LOCAL_TABLES_ONLY_IN_NODE_LOCAL_MIGRATIONS** — poly tables never land in `@cogni/db-core`. Classification is committed before any code moves (see Table Classification below).

### Table Classification (committed before Step 2)

Every table in `packages/db-schema/src/*.ts` is routed to exactly one destination. **This list is the contract.** Adding a table means amending this table before the PR lands.

| Domain file | Tables | Destination | Rationale |
|---|---|---|---|
| `auth.ts` | users, sessions, accounts, verificationTokens | `@cogni/db-core` | Every node needs NextAuth. |
| `identity.ts` | (enumerate in PR) | `@cogni/db-core` | Platform identity primitive. |
| `profile.ts` | (enumerate in PR) | `@cogni/db-core` | Platform identity primitive. |
| `billing.ts` | (enumerate in PR) | `@cogni/db-core` | Every node bills. |
| `ai.ts`, `ai-threads.ts` | (enumerate in PR) | `@cogni/db-core` | Every node runs AI. |
| `connections.ts` | (enumerate in PR) | `@cogni/db-core` | Every node stores BYO-AI connections. |
| `refs.ts`, `scheduling.ts`, `attribution.ts` | (enumerate in PR) | `@cogni/db-core` | Platform-wide. |
| `poly-copy-trade.ts` | polyCopyTradeConfig, polyCopyTradeDecisions, polyCopyTradeFills | **`nodes/poly/app/schema/`** | Poly-only. Migration 0027 already landed these in shared — must be re-routed (see Blocker 2 in plan). |
| DAO formation tables (operator-only) | (enumerate in PR) | **`nodes/operator/app/schema/`** | Operator-specific admin surface. Poly/resy do not need these tables. Operator becomes symmetric — just another node with local tables. |

Rule of thumb: **core = strict intersection** of what every node needs. When in doubt, put it in node-local — moving up to core later is cheap; moving down is a forced migration.

### Package layout

```
packages/db-core/                        # RENAMED from packages/db-schema
  src/schema/
    auth.ts  billing.ts  ...             # only cross-node platform tables
    index.ts                             # barrel for @cogni/db-core
  migrations/                            # pre-generated, versioned with the package
    0000_*.sql  ...  0026_*.sql
    meta/_journal.json
  drizzle.config.ts                      # generates core migrations only
  package.json                           # "version": "1.0.0"
  AGENTS.md                              # documents: schema + migrations, no runtime lifecycle

packages/db-migrator/                    # NEW — runtime execution lives here, NOT in db-core
  src/
    run-core-migrations.ts               # copy-forward bootstrap + drizzle migrator with migrations.table=__drizzle_migrations_core
    run-node-migrations.ts               # parameterized by node name
    cli.ts                               # pnpm db:migrate --node=<name>
    index.ts
  Dockerfile                             # the ONE migrator image — parameterized by --node arg

nodes/poly/app/
  schema/                                # NEW
    copy-trade.ts                        # moved from packages/db-schema
    index.ts                             # re-exports @cogni/db-core/* + local tables
  src/adapters/server/db/
    migrations/                          # node-local only. 0000_poly_copy_trade.sql (renumbered from operator's 0027)
      meta/_journal.json
  drizzle.poly.config.ts                 # schema glob: ./nodes/poly/app/schema/**/*.ts ONLY
```

Same shape for `nodes/resy/` (no local tables initially — empty migrations dir) and `nodes/operator/` (DAO-formation tables become local).

**node-template is NOT a deployed node.** It's a fork scaffold. It gets the schema layout but ships zero local migrations and no `__drizzle_migrations_template` table. Forks customize after copy.

### Two migration tables per DB

Each node's DB ends up with:

- `__drizzle_migrations_core` — written by `run-core-migrations.ts` with `drizzle.migrations.table`
- `__drizzle_migrations_<node>` — written by `run-node-migrations.ts` for that node

No ordering ambiguity, no journal collisions, no renumbering. Both histories visible in the DB.

### One parameterized migrator image

**One Dockerfile, one image, one tag per release.** The image accepts `--node=<name>` and dispatches to the right config. N-images-for-N-nodes is overengineered — zero operational benefit, N× CI legs, N× tag sprawl.

```yaml
# infra/k8s/base/node-app/migration-job.yaml
containers:
  - name: migrate
    image: ghcr.io/cogni-dao/cogni-template-migrate:${TAG}
    args: ["--node=$(NODE_NAME)"]  # NODE_NAME from overlay
    env:
      - name: DATABASE_URL
        valueFrom: { secretKeyRef: ... }
```

Each overlay patches `NODE_NAME=poly|resy|operator`. No per-node Dockerfile, no per-node image.

### Migration ID strategy

- **Core**: sequential (`0028_*.sql`). One maintainer on `main`, collisions rare.
- **Per-node**: sequential also (`0000_*.sql` starting fresh). A single node has one or two devs; collision risk is negligible. Timestamp IDs sound good in theory but `drizzle-kit generate` emits sequential and post-rename adds friction. If a node ever grows to many parallel contributors, revisit.

### Propagation contract

When core schema changes: bump `@cogni/db-core` version, commit. Because this is a pnpm workspace, every node resolves to the same version automatically — no separate lockfile gate needed. The "check:db-core-sync" step from the earlier draft is **deleted** — it would only matter for external forks that vendor the package separately, which is not in scope for v0.

Each node's `run-node-migrations.ts` entry point ALWAYS calls `runCoreMigrations(db)` first, so pulling a new `@cogni/db-core` auto-applies its migrations on next deploy.

## Rollout — the bootstrap path is non-negotiable

On a DB that already has `__drizzle_migrations` with 0000-0026 applied, `runCoreMigrations()` runs this sequence:

1. If `__drizzle_migrations_core` exists and is non-empty → normal path (drizzle migrator).
2. Else if `__drizzle_migrations` exists with rows → **bootstrap mode**: read all rows, filter to those whose hash matches a file in `packages/db-core/migrations/`, insert into `__drizzle_migrations_core` with original `created_at`. Do NOT execute the SQL.
3. Then run drizzle migrator — it picks up any new core migrations (e.g., 0028+) past the bootstrapped baseline.
4. For poly DB only: detect rows in legacy `__drizzle_migrations` whose hash matches `0027_silent_nextwave.sql` (poly copy-trade). Those rows get rewritten into `__drizzle_migrations_poly` as the new `0000_poly_copy_trade.sql`, NOT into core.

Ship the bootstrap as a one-shot script first (`scripts/db/bootstrap-split-migrations.mts`) and run it manually against preview DBs, verify, THEN inline the same logic into `run-core-migrations.ts` as idempotent startup. Double-gate.

## Non-goals (this task)

- Adopting Postgres `CREATE SCHEMA` namespacing (separate DBs already namespace).
- Data migration ACROSS node DBs (they're already separate; nothing moves).
- Fixing production migration Jobs beyond flipping them on — broader prod-deploy reliability is task.0260.
- Making `@cogni/db-core` publishable to npm — workspace-internal is fine for v0.
- External-fork propagation contract — revisit if/when forks vendor the package separately.

## Allowed Changes

- `packages/db-schema/` → renamed to `packages/db-core/` (core tables only)
- `packages/db-migrator/` (new)
- `packages/db-core/AGENTS.md` (new, documents schema + migrations-as-assets contract)
- `nodes/*/app/schema/` (new dirs for node-local tables)
- `nodes/*/app/src/adapters/server/db/migrations/` — wiped + rebuilt with node-local migrations only
- `drizzle.config.ts` → split into `packages/db-core/drizzle.config.ts` + one per-node `drizzle.<node>.config.ts`
- `package.json` — single `db:migrate --node=<name>` entry point; remove per-node scripts
- `infra/k8s/base/node-app/migration-job.yaml` + overlays (one image, NODE_NAME arg)
- `scripts/ci/compute_migrator_fingerprint.sh` — hash inputs extended to cover all node schemas + migrations
- `scripts/ci/detect-affected.sh` — `add_target migrator` triggers extended to all new paths
- `scripts/ci/build-and-push-images.sh` — migrator build step points at `packages/db-migrator/Dockerfile`
- `.github/workflows/build-multi-node.yml` — migrator build leg updated to new Dockerfile location
- `scripts/db/bootstrap-split-migrations.mts` (new, one-shot)
- `scripts/db/seed-money.mts` + `seed.mts` — split seed logic per-node where tables moved (follow-up acceptable, not blocking)
- `docs/spec/databases.md`, `docs/spec/ci-cd.md`, `docs/guides/multi-node-dev.md` — document new model and migration gate
- `docs/spec/db-migration-tooling-decision.md` (new, output of Step 0)

## Plan

- [ ] **Step 0 — Atlas spike (1 day).** Prototype Atlas against `cogni_poly` with core + poly modules. Write `docs/spec/db-migration-tooling-decision.md`. If adopt → rewrite plan; if reject → proceed with Step 1.
- [x] **Step 1 — Doc truth-up.** ✅ Done in this worktree: `docs/guides/multi-node-dev.md` DB/Auth section corrected.
- [ ] **Step 2 — Commit Table Classification.** Enumerate every current table in this task body (the stub table above → concrete list). PR lands classification-only before any code moves.
- [ ] **Step 3 — Rename `packages/db-schema` → `packages/db-core`.** Move ONLY core tables. `poly-copy-trade.ts` and any operator-local tables move OUT per classification.
- [ ] **Step 4 — Ship core migrations 0000–0026 as `@cogni/db-core/migrations/`.** Copy from operator's migrations dir. These become authoritative. Add package README documenting migrations as pre-generated assets.
- [ ] **Step 5 — Route 0027 to poly.** Move `0027_silent_nextwave.sql` into `nodes/poly/app/src/adapters/server/db/migrations/0000_poly_copy_trade.sql` (renumber). Delete the duplicate from every other node's migrations dir.
- [ ] **Step 6 — `packages/db-migrator`.** Implement `runCoreMigrations(db)` with the four-step bootstrap (including poly 0027 row re-routing), `runNodeMigrations(db, nodeName)`, and CLI entry point.
- [ ] **Step 7 — Per-node drizzle configs.** One `drizzle.<node>.config.ts` per deployed node (operator, poly, resy). Schema glob excludes core; migrations table = `__drizzle_migrations_<node>`.
- [ ] **Step 8 — Wipe byte-identical duplicates.** Delete 0000-0026 copies from every `nodes/*/.../migrations/` dir. Keep node-local migrations only.
- [ ] **Step 9 — Package.json scripts.** Collapse `db:migrate:poly` / `db:migrate:resy` / `db:migrate:dev` into `db:migrate --node=<name>` via the migrator CLI. Backwards-compatible aliases acceptable during rollout.
- [ ] **Step 10 — One parameterized migrator image + CI wiring.** Single Dockerfile at `packages/db-migrator/Dockerfile`, single image tag. Three CI files MUST update in the same PR as the Dockerfile move:
  - **`scripts/ci/compute_migrator_fingerprint.sh`** — replace operator-only input list (`drizzle.config.ts`, `nodes/operator/app/src/shared/db`, operator migrations) with: `packages/db-core/src/**`, `packages/db-core/migrations/**`, `packages/db-migrator/**`, `nodes/*/app/schema/**`, `nodes/*/app/src/adapters/server/db/migrations/**`, `package.json`, `pnpm-lock.yaml`. **Silent failure mode otherwise:** a poly-local migration change leaves the migrator cache valid, stale image gets promoted, new migration never runs in prod.
  - **`scripts/ci/detect-affected.sh:135`** — extend `add_target migrator` to trigger on the same path set above. Today it only triggers on operator paths, so non-operator DB changes skip the migrator rebuild entirely.
  - **`scripts/ci/build-and-push-images.sh:146-155`** — migrator build step currently uses `--target migrator` against `nodes/operator/app/Dockerfile`. Point it at the new `packages/db-migrator/Dockerfile` instead. Also update `.github/workflows/build-multi-node.yml` migrator leg.
  - `infra/k8s/base/node-app/migration-job.yaml` accepts `NODE_NAME` env; overlays patch the value.
  - Un-no-op production poly/resy overlays (remove `exit 0`) — but **gated on Step 11a below**.
- [ ] **Step 11 — Bootstrap preview DBs.** Run `scripts/db/bootstrap-split-migrations.mts` against preview `cogni_template_dev`, `cogni_poly`, `cogni_resy`. Verify `__drizzle_migrations_core` matches expected hash list. Verify poly row re-routing worked. PreSync hook runs idempotently on subsequent deploys.
- [ ] **Step 11a — Prod cutover (ship separately from preview cutover).** Prod poly/resy migration Jobs have been `exit 0` since inception (`infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95`) — the DBs are in **unknown state**. Before flipping the switch:
  1. SSH into prod VM; `pg_dump --schema-only` for `cogni_template_dev`, `cogni_poly`, `cogni_resy` (production).
  2. Inspect each DB: does `__drizzle_migrations` table exist? How many rows? What hashes?
  3. Classify each DB into one of three states:
     - **(A) Fresh DB, no `__drizzle_migrations`** → runner will do fresh apply from scratch. Expected, fine.
     - **(B) Populated, all hashes match `@cogni/db-core/migrations/`** → bootstrap copy-forward succeeds.
     - **(C) Populated, hashes diverge** → **STOP.** Reconcile manually before flipping the overlay. Root-cause any drift from preview before cutover.
  4. Only after every prod DB is in state (A) or (B), land the overlay PR that removes the `exit 0`. Land as a dedicated PR, not bundled with the preview cutover.
  5. Monitor first prod promote-and-deploy cycle; watch migration Job logs in Loki.
- [ ] **Step 12 — Spec updates.** `docs/spec/databases.md` absorbs the migration contract as an invariant section (CORE_MIGRATIONS_IDEMPOTENT_ON_LEGACY_DBS, NODE_LOCAL_TABLES_ONLY_IN_NODE_LOCAL_MIGRATIONS). `docs/spec/ci-cd.md` gets per-node migration-Job health added to v0 Minimum Authoritative Validation.
- [ ] **Step 13 — Seed split.** `scripts/db/seed-money.mts` gains node awareness (or splits into `seed-money-poly.mts` etc). Non-blocking if deferred to follow-up task.

Steps 0–2 are sequential. Steps 3–9 can batch in one implementation PR. Steps 10–12 are the deploy-reliability follow-up. Step 13 can defer.

## Validation

**Per-node independence:**

```bash
pnpm db:migrate --node=poly
pnpm db:migrate --node=resy

psql $DATABASE_URL_POLY -c "select count(*) from __drizzle_migrations_core;"   # expect: 27+
psql $DATABASE_URL_POLY -c "select count(*) from __drizzle_migrations_poly;"   # expect: 1 (poly copy-trade)
psql $DATABASE_URL_RESY -c "select count(*) from __drizzle_migrations_poly;"   # expect: ERROR table does not exist (isolation proved)
psql $DATABASE_URL_RESY -c "select * from poly_copy_trade_fills limit 1;"     # expect: ERROR table does not exist (poly tables not in resy DB)
```

**Idempotent bootstrap on legacy DB:**

```bash
# Snapshot a preview DB as it exists today (has __drizzle_migrations with 27 rows)
pg_dump $PREVIEW_DATABASE_URL > /tmp/before.sql
psql $TEST_DB < /tmp/before.sql

pnpm db:migrate --node=operator  # first run — should bootstrap, not re-apply
psql $TEST_DB -c "select count(*) from __drizzle_migrations_core;"  # expect: 27 (copied from legacy, no re-applied DDL)

pnpm db:migrate --node=operator  # second run — no-op
# expect: zero new rows, zero errors
```

**Collision test:**

```bash
# In one branch: add a core migration (0028)
# In another branch: add a poly-local migration (nodes/poly/app/.../migrations/0001_whatever.sql)
# Merge both into main in either order
pnpm check  # expect: passes in any merge order
```

**Observability:** migration runs emit Pino structured logs with `migration_id`, `destination_table`, `rows_applied`, `bootstrap_mode` fields. `run-core-migrations` logs a WARN if it enters bootstrap mode (so we see it exactly once per legacy DB).

**Exercise:** after Step 11 (preview DBs bootstrapped), a new `_test` migration added to `@cogni/db-core/migrations/0028_test.sql` deploys cleanly to all three preview DBs on next CD run without manual intervention.

## Review Checklist

- [ ] **Work Item:** `task.0322` linked in PR body
- [ ] **Atlas Decision:** `docs/spec/db-migration-tooling-decision.md` committed (or plan rewrite merged if Atlas adopted)
- [ ] **Table Classification:** concrete table-by-table list committed before any code move
- [ ] **Bootstrap Path:** legacy `__drizzle_migrations` → `__drizzle_migrations_core` copy-forward tested on preview DB snapshot
- [ ] **0027 routing:** `poly_copy_trade_*` tables land in poly-local migrations, NOT core
- [ ] **Single migrator image:** one Dockerfile, `--node=` arg, N overlays set NODE_NAME
- [ ] **Migrator CI inputs:** `compute_migrator_fingerprint.sh` + `detect-affected.sh` cover ALL node schemas/migrations — not operator-only (silent failure mode otherwise)
- [ ] **Prod cutover gated:** Step 11a prod DB inspection completed; `exit 0` removal lands as a dedicated follow-up PR after preview proves clean
- [ ] **Specs:** `databases.md`, `ci-cd.md`, `multi-node-dev.md` reflect the new model
- [ ] **No runtime in package:** `@cogni/db-core` exports schema + SQL assets only. `run-core-migrations.ts` lives in `packages/db-migrator`.
- [ ] **Reviewer:** assigned and approved

## Design review history

- **2026-04-18 — self-review (critical).** Flagged three blockers: (1) no bootstrap from legacy `__drizzle_migrations`, (2) 0027 mis-classified, (3) "core" undefined. All three addressed above.
- **2026-04-18 — external review (Codex).** Converged on same three blockers + added: (a) Atlas evaluation gap → Step 0, (b) one parameterized migrator image instead of N → Step 10, (c) `check:db-core-sync` redundant → deleted, (d) `migrate.ts` out of `@cogni/db-core` → moved to new `packages/db-migrator`, (e) timestamp IDs not worth friction → stayed on sequential, (f) node-template not a real node → no migration table.
- **2026-04-18 — CI/CD pipeline review (devops-expert).** Traced plan against actual flighting wiring (`pr-build.yml`, `candidate-flight.yml`, `promote-and-deploy.yml`, Argo PreSync hooks). Design fundamentally compatible — one image, one digest, BUILD_ONCE_PROMOTE axiom preserved. Added four concrete integration gaps to Step 10: (1) `compute_migrator_fingerprint.sh` hash inputs must cover all node schemas/migrations (silent staleness otherwise), (2) `detect-affected.sh` add_target migrator must trigger on the same path set, (3) `build-and-push-images.sh` + `build-multi-node.yml` migrator leg must point at new `packages/db-migrator/Dockerfile`, (4) prod cutover (remove `exit 0` in production overlays) separated into Step 11a with mandatory DB state inspection before overlay change — preview cutover and prod cutover ship as separate PRs.

## Open questions

1. **Atlas spike outcome.** Step 0 blocks everything downstream. If Atlas wins, this task is rewritten — don't pre-commit to drizzle-kit bespoke plumbing.
2. **Rollback semantics.** Drizzle has no down migrations. Per-package tables at least contain blast radius (rolling back core ≠ rolling back poly-local). Document that rollback = DB restore from backup, not migration revert.
3. **Schema DAG linting.** Node schema files should import only from `@cogni/db-core`, never another node. Add dep-cruiser rule in Step 6 or a follow-up.
4. **Seed data timeline.** Step 13 can slip to a follow-up task if scope pressure — table classification determines what seeds need splitting.

## PR / Links

- Project: [proj.cicd-services-gitops.md](../projects/proj.cicd-services-gitops.md)
- Related: task.0260 (monorepo CI / Turborepo — unblocks the migrator image in CI), task.0315 (poly copy-trade — is the test case for node-local routing), task.0317 (per-node graph catalogs — analogous per-node pattern), task.0320 (per-node candidate flighting)
- External review source: pasted inline 2026-04-18

## Attribution

-
