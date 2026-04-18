---
id: task.0322
type: task
title: Per-node DB schema independence via Atlas + Drizzle
status: needs_implement
priority: 2
rank: 50
estimate: 8
summary: Split the shared DB schema into per-node composite schemas (shared core + node-local tables) managed by Atlas with Drizzle `external_schema`. One Atlas Operator reconciles migrations via `AtlasMigration` CRs; Argo CD owns the manifests. Replaces the original bespoke two-phase drizzle-kit runner design.
outcome: Each node's DB contains only tables it needs, Atlas owns migration state in `atlas_schema_revisions`, and new schema changes flow from `packages/db-core/src/schema` → `drizzle-kit export` → `atlas migrate diff` → `AtlasMigration` CR → per-node DB. One parameterized migrator image serves all nodes. Candidate-a validated first, then preview, then prod.
spec_refs:
  - ci-cd-spec
  - databases-spec
assignees:
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [db, monorepo, architecture, cicd, atlas]
external_refs:
  - https://atlasgo.io/guides/orms/drizzle/existing-project
  - https://atlasgo.io/guides/deploying/k8s-argo
  - https://atlasgo.io/atlas-schema/projects
---

# Per-node DB schema independence (Atlas + Drizzle)

## Decision: ADOPT Atlas

Spike completed 2026-04-18. Atlas + Drizzle is an officially supported integration (Jan 2025 partnership) with a paved path for our exact shape: existing Drizzle project with populated `__drizzle_migrations` → Atlas-managed per-node DBs with composite schemas → Argo CD reconciliation. Evidence in § Spike Summary. This task's original bespoke two-phase drizzle-kit runner design is archived as § Rejected Alternative.

## Context — current state (audited 2026-04-18)

| Aspect | Reality |
|---|---|
| Per-node DBs (dev + k8s) | ✅ `cogni_template_dev`, `cogni_poly`, `cogni_resy`. Dev URLs in `package.json:42-43`. Prod overlays patch per-node secrets. |
| Schema source | ⚠️ Single shared `packages/db-schema` package. Every node's DB contains every node's tables (poly's `polyCopyTradeConfig` lives in resy's DB). |
| Per-node migration dirs | ⚠️ Exist but are byte-identical copies of operator's 0000-0026. Operator ahead at 0027. No per-node extension mechanism. |
| Migration runner (dev) | ⚠️ `db:migrate:poly` / `db:migrate:resy` swap `DATABASE_URL` then run root drizzle-kit against operator's out dir. Node migrations aren't isolated. |
| K8s migration Job (candidate-a + preview) | ⚠️ Shared operator migrator image applied against each node's DB via Argo PreSync hook. |
| K8s migration Job (production) | 🚩 Poly/resy overlays set `exit 0`. No prod migrations ever. `infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95`. |
| Doc accuracy | ✅ Corrected in Step 1 of this task. |

## Spike Summary — why Atlas (not bespoke)

Researched 2026-04-18. Three narrow questions, each answered with Atlas doc evidence:

### Q1 — Three DBs with differing schemas?

`composite_schema` ([atlasgo.io/atlas-schema/projects](https://atlasgo.io/atlas-schema/projects)) composes multiple schema sources into one unified graph. We use it per-node: each node's `env` block unions `@cogni/db-core` (Drizzle `external_schema`) + that node's local Drizzle `external_schema`.

Atlas's `for_each` multi-tenant primitive is NOT for us — that assumes homogeneous schemas across tenants (all share one `migration.dir`). We want heterogeneous; `composite_schema` + per-node `env` is the right primitive.

**Unverified assumption (single remaining risk):** Drizzle `external_schema` composes cleanly INSIDE a `composite_schema`. Docs show composite with SQLAlchemy/Ent/HCL/SQL but not Drizzle explicitly. Mechanism should transfer (both use `external_schema`), but is verified by the first implementation PR. Fallback if it fails: three independent per-node Atlas projects (duplicated core HCL — still simpler than bespoke runner).

### Q2 — Operator + Argo CD?

Official guide: [atlasgo.io/guides/deploying/k8s-argo](https://atlasgo.io/guides/deploying/k8s-argo). Clean ownership split: Argo owns manifests, Atlas Operator owns `AtlasMigration` CR execution. Recommended sync waves: DB resources → migrations → app.

**Mandatory gotcha:** Argo has no built-in health check for `AtlasMigration` CRD. Without a custom Lua health check in `argocd-cm`, the app-pod sync wave ships before migrations complete. Fix is a one-time ConfigMap patch (Step 3 below).

k3s-specific issues: none documented, none expected. Candidate-a is vanilla k3s via our OpenTofu bootstrap.

### Q3 — Atlas binary in CI?

Negligible. ~78 MB Go binary, speaks Postgres wire protocol natively (no drivers baked). Install via `curl -sSf https://atlasgo.sh | sh` or use `arigaio/atlas:latest-extended-alpine` base. Atlas replaces `drizzle-kit migrate` only; we still need Node + drizzle-kit for `drizzle-kit export` (emits schema for Atlas to read). Migrator image becomes multi-stage: Node stage for export, Atlas binary copied in.

### Bootstrap path for candidate-a's existing DBs

[atlasgo.io/guides/orms/drizzle/existing-project](https://atlasgo.io/guides/orms/drizzle/existing-project) walks this exact scenario. `atlas migrate apply --baseline <timestamp>` tells Atlas the DB is already at that version; skip replay. `atlas_schema_revisions` becomes the new source of truth; legacy `__drizzle_migrations` is left in place for rollback safety.

**This is the killer feature vs bespoke.** The bespoke plan required hand-rolled copy-forward logic from `__drizzle_migrations` → `__drizzle_migrations_core` with careful idempotency + a one-shot script + inlined runtime check. Atlas gives us `--baseline <ts>` as one flag. ~300 LOC of risky code we don't write.

### Tradeoff math (why this wins)

| Dimension | Atlas | Bespoke (rejected) |
|---|---|---|
| Lines we own | ~200 HCL + Dockerfile patch | ~500 TS + test suite |
| Baseline adoption | `--baseline <ts>` flag | Hand-rolled copy-forward from `__drizzle_migrations` |
| Schema composition | `composite_schema` (documented) | Ad-hoc two-dir runner |
| Drift detection | `atlas schema diff` out of box | Would be another task |
| Argo CD integration | Official guide + CRD | Standard PreSync Job |
| Argo CD health check | One Lua snippet (mandatory) | Standard Job health (free) |
| Team familiarity | Zero | Drizzle (existing) |
| Binary in image | +78 MB | None |
| Failure mode | Vendor escape hatch (standard postgres wire) | We own every bug |

Atlas wins on bootstrap + composition + drift — the three primitives we'd otherwise hand-roll. Bespoke wins only on familiarity and image-size. We're choosing to trade ~1 week of learning Atlas HCL against ~2 weeks of writing + testing the bespoke bootstrap correctly.

## Design — target architecture

### Repo layout

```
packages/db-core/                        # shared platform tables ONLY
  src/schema/
    auth.ts  billing.ts  identity.ts  ...
  AGENTS.md                              # "schema only, no migrations dir in source"

nodes/poly/app/
  schema/                                # poly-local tables
    copy-trade.ts                        # moved from packages/db-schema
  src/adapters/server/db/
    client.ts                            # Drizzle DML (unchanged shape)

nodes/operator/app/
  schema/                                # operator-local (DAO formation)

nodes/resy/app/
  schema/                                # empty for now; exists for future

atlas/                                   # Atlas HCL + generated migrations
  atlas.hcl                              # env blocks: operator, poly, resy
  operator/migrations/                   # per-node migration dirs (Atlas-generated)
  poly/migrations/
  resy/migrations/
```

### `atlas.hcl` sketch

```hcl
data "external_schema" "core" {
  program = ["pnpm", "drizzle-kit", "export",
             "--dialect", "postgresql",
             "--schema", "./packages/db-core/src/schema"]
}
data "external_schema" "poly_local" {
  program = ["pnpm", "drizzle-kit", "export",
             "--dialect", "postgresql",
             "--schema", "./nodes/poly/app/schema"]
}
data "composite_schema" "poly_full" {
  schema "public" { from = data.external_schema.core.url }
  schema "public" { from = data.external_schema.poly_local.url }
}
env "poly" {
  src        = data.composite_schema.poly_full.url
  dev        = "docker://postgres/16/dev"
  migration { dir = "file://atlas/poly/migrations" }
}
# ... same shape for operator, resy
```

### Migration flow

1. Dev edits `packages/db-core/src/schema/*.ts` or `nodes/<node>/app/schema/*.ts`
2. `pnpm atlas:diff --env <node>` → emits new SQL file in `atlas/<node>/migrations/`
3. PR review includes the generated SQL
4. Merge → pr-build rebuilds migrator image (digest promoted through candidate-a → preview → prod)
5. Argo syncs `AtlasMigration` CR → Operator applies to that node's DB → reports `Ready` → app wave proceeds

### One parameterized migrator image

Single image, multi-stage Dockerfile (packages/db-migrator/Dockerfile):

```dockerfile
FROM node:22-alpine AS exporter          # emits Drizzle schema for Atlas to read
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --filter='./packages/db-core...'
COPY packages/db-core ./packages/db-core
COPY nodes ./nodes

FROM arigaio/atlas:latest-extended-alpine
COPY --from=exporter /app /app
COPY atlas /app/atlas
WORKDIR /app
ENTRYPOINT ["atlas"]
```

The `AtlasMigration` CR references this image; each node's CR sets `--env=<node>`. One image, one digest, BUILD_ONCE_PROMOTE preserved.

### Argo CD health check (one-time ConfigMap patch)

```yaml
# infra/k8s/bootstrap/argocd-cm-patch.yaml
data:
  resource.customizations.health.db.atlasgo.io_AtlasMigration: |
    hs = {}
    if obj.status ~= nil and obj.status.conditions ~= nil then
      for _, c in ipairs(obj.status.conditions) do
        if c.type == "Ready" and c.status == "True" then
          hs.status = "Healthy"; hs.message = c.message; return hs
        end
      end
    end
    hs.status = "Progressing"; hs.message = "Waiting for migration"; return hs
```

Applied once per Argo CD instance. Without this, sync waves silently race.

## Invariants

- **ATLAS_OWNS_MIGRATION_STATE** — only `atlas_schema_revisions` is authoritative. Legacy `__drizzle_migrations` remains in DBs post-bootstrap as a read-only artifact; dropped in a follow-up after 30 days stable.
- **COMPOSITE_SCHEMA_PER_NODE** — every node has its own `env` block in `atlas.hcl` with a `composite_schema` unioning `@cogni/db-core` + its local schema. No homogeneous-tenant shortcut.
- **NODE_LOCAL_TABLES_NEVER_IN_CORE** — `packages/db-core/src/schema/` contains only tables every node needs. Table classification is committed before Step 2.
- **ONE_MIGRATOR_IMAGE** — one Dockerfile at `packages/db-migrator/Dockerfile`, one image, parameterized by `--env=<node>`.
- **BASELINE_ONCE_PER_DB** — `atlas migrate apply --baseline <ts>` runs exactly once per DB per environment at cutover. Subsequent runs are normal `apply`.

## Table Classification (committed before Step 2)

| Domain file | Tables | Destination | Rationale |
|---|---|---|---|
| `auth.ts` | users, sessions, accounts, verificationTokens | `@cogni/db-core` | Every node needs NextAuth. |
| `identity.ts`, `profile.ts` | (enumerate in PR) | `@cogni/db-core` | Platform identity. |
| `billing.ts` | (enumerate in PR) | `@cogni/db-core` | Every node bills. |
| `ai.ts`, `ai-threads.ts` | (enumerate in PR) | `@cogni/db-core` | Every node runs AI. |
| `connections.ts` | (enumerate in PR) | `@cogni/db-core` | BYO-AI. |
| `refs.ts`, `scheduling.ts`, `attribution.ts` | (enumerate in PR) | `@cogni/db-core` | Platform-wide. |
| `poly-copy-trade.ts` | polyCopyTradeConfig, polyCopyTradeDecisions, polyCopyTradeFills | **`nodes/poly/app/schema/`** | Poly-only. Currently in shared `@cogni/db-schema`. |
| DAO formation tables | (enumerate in PR) | **`nodes/operator/app/schema/`** | Operator admin surface. |

Rule: **core = strict intersection of what every node needs**. When in doubt, node-local.

## Allowed Changes

- `packages/db-schema/` → renamed to `packages/db-core/` (core tables only)
- `packages/db-migrator/` (new — multi-stage Dockerfile + atlas CLI wrapper scripts)
- `packages/db-core/AGENTS.md` (new)
- `nodes/*/app/schema/` (new, node-local tables)
- `nodes/*/app/src/adapters/server/db/migrations/` — **deleted entirely**. Atlas owns migration files under `atlas/<node>/migrations/`.
- `atlas/` (new, atlas.hcl + generated per-node migration dirs)
- `drizzle.config.ts` — replaced/deprecated. Drizzle is used only via `drizzle-kit export` inside Atlas `external_schema` programs.
- `package.json` scripts:
  - `db:migrate:<node>` → `atlas migrate apply --env <node> --url $DATABASE_URL`
  - `db:diff:<node>` → `atlas migrate diff --env <node> <name>`
  - `db:status:<node>` → `atlas migrate status --env <node>`
- `infra/k8s/base/node-app/migration-job.yaml` → **deleted**. Replaced by `AtlasMigration` CR in each node's overlay.
- `infra/k8s/bootstrap/argocd-cm-patch.yaml` (new — Lua health check)
- `infra/k8s/bootstrap/atlas-operator.yaml` (new — Helm chart reference for the Operator)
- `scripts/ci/compute_migrator_fingerprint.sh` — hash inputs: `packages/db-core/src/**`, `packages/db-migrator/**`, `nodes/*/app/schema/**`, `atlas/**`, `package.json`, `pnpm-lock.yaml`
- `scripts/ci/detect-affected.sh` — `add_target migrator` trigger paths extended
- `scripts/ci/build-and-push-images.sh` — migrator build step points at `packages/db-migrator/Dockerfile`
- `.github/workflows/build-multi-node.yml` — migrator leg updated
- `scripts/db/seed-money.mts` + `seed.mts` — split per-node where tables moved (non-blocking follow-up)
- `docs/spec/databases.md`, `docs/spec/ci-cd.md`, `docs/guides/multi-node-dev.md` — reflect Atlas-owned migrations

## Plan

### Phase A — Validation on candidate-a (1 PR, ~2 days)

- [x] **Step 0 — Atlas spike complete.** Decision: ADOPT. Evidence above. No standalone decision doc (spike output folded into this task per content-boundaries rule).
- [x] **Step 1 — Doc truth-up.** ✅ Done: `docs/guides/multi-node-dev.md` DB/Auth section corrected.
- [ ] **Step 2 — Install Atlas Operator on candidate-a k3s.** Add `infra/k8s/bootstrap/atlas-operator.yaml` (Helm chart ref). Apply via cloud-init or manual one-shot. Verify `kubectl -n atlas-operator-system get pods` shows Running.
- [ ] **Step 3 — Argo CD Lua health check ConfigMap patch.** Apply `infra/k8s/bootstrap/argocd-cm-patch.yaml` to candidate-a's Argo CD. Without this, app-pod sync wave races migration completion.
- [ ] **Step 4 — Commit Table Classification.** Enumerate every current table in the Classification table above. Classification-only PR, no code moves yet.
- [ ] **Step 5 — Write initial `atlas.hcl` + run first baseline on cogni_poly (SNAPSHOT of candidate-a's DB, not live).** This is the Q1 mechanism validation:
  1. `pg_dump $CANDIDATE_A_POLY_URL > /tmp/poly-snapshot.sql`; restore to local `cogni_poly_test`
  2. Write `atlas.hcl` with `env "poly"` only (Phase A scope)
  3. Move `poly-copy-trade.ts` to `nodes/poly/app/schema/`
  4. Rename `packages/db-schema` → `packages/db-core` (poly-copy-trade already moved out)
  5. Run `atlas migrate diff --env poly initial_poly_baseline` — **this is the verification that `composite_schema` + Drizzle `external_schema` compose**. Expect one SQL file unioning core + poly-local.
  6. Run `atlas migrate apply --env poly --url postgres://...cogni_poly_test --baseline <ts>` — **must not alter any tables**. Verify `atlas migrate status` reports Synced.
  7. Run `atlas schema diff --env poly --from "file://atlas/poly/migrations" --to postgres://...cogni_poly_test --exclude "atlas_schema_revisions"` — must report no changes.

  **If any of (5)/(6)/(7) fails**: Drizzle + composite_schema doesn't work as assumed. Fall back plan: three independent per-node Atlas projects with duplicated core HCL (still simpler than bespoke runner). Don't revert to bespoke plan — it was rejected for stronger reasons.

- [ ] **Step 6 — `AtlasMigration` CR for poly on candidate-a.** Write `infra/k8s/overlays/candidate-a/poly/atlas-migration.yaml`. Wire to the migrator image built by PR CI. Verify Argo sync applies it, Operator runs `atlas migrate apply` against live candidate-a `cogni_poly`, migration reports Healthy, app wave proceeds.

### Phase B — Extend to operator + resy on candidate-a (1 PR, ~1 day)

- [ ] **Step 7 — Extend `atlas.hcl`** with `env "operator"` + `env "resy"`. Move operator-local (DAO formation) tables to `nodes/operator/app/schema/`. Resy has no local tables today — env block still exists with empty node-local schema.
- [ ] **Step 8 — Baseline operator + resy DBs on candidate-a.** Same snapshot-first approach as Step 5. Both DBs get `atlas migrate apply --baseline <ts>`.
- [ ] **Step 9 — `AtlasMigration` CRs for operator + resy on candidate-a.** Full candidate-a now uses Atlas for all three nodes. Argo PreSync hooks (legacy Jobs) are deleted in this PR.

### Phase C — CI wiring (1 PR, ~1 day)

- [ ] **Step 10 — Migrator image + CI triggers.** Same four CI integration items flagged by devops-expert review:
  - `packages/db-migrator/Dockerfile` (multi-stage Node + Atlas)
  - `scripts/ci/compute_migrator_fingerprint.sh` — inputs: `packages/db-core/src/**`, `packages/db-migrator/**`, `nodes/*/app/schema/**`, `atlas/**`, `package.json`, `pnpm-lock.yaml`. **Silent failure mode otherwise:** a node schema change leaves the migrator cache valid, stale image gets promoted, new migration never runs.
  - `scripts/ci/detect-affected.sh:135` — extend `add_target migrator` to all paths above.
  - `scripts/ci/build-and-push-images.sh:146-155` — point migrator target at `packages/db-migrator/Dockerfile`. Update `.github/workflows/build-multi-node.yml` migrator leg too.
- [ ] **Step 11 — `pnpm db:*` scripts.** Replace `db:migrate:dev`/`db:migrate:poly`/`db:migrate:resy` with `db:migrate --env=<node>` backed by Atlas CLI. Add `db:diff:<node>`, `db:status:<node>`.

### Phase D — Preview rollout (1 PR, ~0.5 day)

- [ ] **Step 12 — Roll to preview.** Install Atlas Operator + Argo Lua patch on preview k3s. Baseline preview DBs (same snapshot-first approach as candidate-a). Sync `AtlasMigration` CRs via `deploy/preview`.

### Phase E — Production cutover (1 PR, dedicated deploy day)

- [ ] **Step 13 — Prod DB state inspection.** Prod poly/resy migration Jobs have been `exit 0` since inception (`infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95`) — DBs are in unknown state. Before any changes:
  1. SSH into prod VM; `pg_dump --schema-only` for all three prod DBs.
  2. Inspect each: does `__drizzle_migrations` table exist? How many rows? What hashes?
  3. Classify:
     - **(A) Fresh DB, no `__drizzle_migrations`** → Atlas applies from scratch (no `--baseline`, or baseline `0`).
     - **(B) Populated, all hashes match our `packages/db-core/migrations` → `atlas/**` translation** → baseline with recorded timestamp.
     - **(C) Populated, hashes diverge** → **STOP.** Reconcile manually before proceeding.
  4. Only after every prod DB is in state (A) or (B), land the prod-cutover PR.
- [ ] **Step 14 — Prod cutover PR.** Install Atlas Operator + Argo Lua patch on prod k3s. Delete `exit 0` no-ops in prod poly/resy overlays (replaced by `AtlasMigration` CRs). Monitor first prod promote-and-deploy cycle via Loki.

### Phase F — Cleanup (follow-up tasks, non-blocking)

- [ ] **Step 15 — Spec updates.** `docs/spec/databases.md` absorbs migration contract invariants. `docs/spec/ci-cd.md` adds Atlas migration to v0 Minimum Authoritative Validation.
- [ ] **Step 16 — Seed split.** `scripts/db/seed-money.mts` gains node awareness. Non-blocking.
- [ ] **Step 17 — Drop legacy `__drizzle_migrations` after 30 days stable.** Followup cleanup once confidence is high.

## Validation

### Per-node independence (Phase B end)

```bash
pnpm db:status --env poly      # expect: Synced, atlas_schema_revisions has N rows
pnpm db:status --env resy      # expect: Synced, fewer rows than poly (no node-local migrations)

psql $DATABASE_URL_RESY -c "select * from poly_copy_trade_fills limit 1;"
# expect: ERROR relation does not exist (isolation proved — poly tables NOT in resy DB)

psql $DATABASE_URL_POLY -c "select count(*) from atlas_schema_revisions;"  # > 0
psql $DATABASE_URL_POLY -c "select count(*) from __drizzle_migrations;"    # legacy table still present (rollback safety)
```

### Baseline idempotency (Phase A Step 6)

```bash
# First apply on legacy-populated DB
atlas migrate apply --env poly --url $TEST_DB --baseline <ts>
# expect: 0 DDL statements executed, atlas_schema_revisions populated

# Second apply (no changes)
atlas migrate apply --env poly --url $TEST_DB
# expect: "No migrations to apply"
```

### Argo wave ordering (Phase A Step 6)

```bash
kubectl -n poly get atlasmigration poly-migration -w
# expect: Progressing → Ready before poly-app Deployment reaches Healthy
```

### Observability

- Atlas Operator emits events; Argo surfaces them in UI.
- Operator pod logs captured by our existing Alloy → Loki pipeline under namespace `atlas-operator-system`. Confirm after Step 2.
- Migration success/failure signals through Argo health → `promote-and-deploy.yml` `lock-preview-on-success` / `unlock-preview-on-failure` gates (no change needed).

### Collision test (Phase C done)

```bash
# Branch A: add a core table
# Branch B: add a poly-local table
# Merge both into main in either order
pnpm check  # expect passes — atlas migrate diff emits independent files per env
```

## Review Checklist

- [ ] **Work Item:** `task.0322` linked in PR body
- [ ] **Phase A first:** candidate-a poly end-to-end before any other node touches
- [ ] **Table Classification:** concrete list committed before any code move (Step 4)
- [ ] **Baseline tested on SNAPSHOT first:** never baseline a live DB without a snapshot rehearsal
- [ ] **Composite schema proven:** Step 5 generated a migration file unioning core + poly-local without errors
- [ ] **Argo Lua health check:** applied BEFORE any `AtlasMigration` CR is synced (else silent race)
- [ ] **Single migrator image:** one Dockerfile, `--env=<node>` arg
- [ ] **Migrator CI inputs:** fingerprint + detect-affected cover all node schemas + atlas/ dir
- [ ] **Prod cutover gated:** Step 13 DB inspection completed before Step 14 PR opens
- [ ] **Specs:** `databases.md`, `ci-cd.md`, `multi-node-dev.md` reflect Atlas-owned migrations
- [ ] **No runtime in `@cogni/db-core`:** package contains schema `.ts` only; no migration dir in source tree (migrations live under `atlas/`)
- [ ] **Reviewer:** assigned and approved

## Design review history

- **2026-04-18 — original self-review + Codex review + devops-expert review.** Produced the bespoke two-phase drizzle-kit runner plan (now § Rejected Alternative). Surfaced three blockers (bootstrap path, 0027 routing, "core" undefined) plus Atlas evaluation gap.
- **2026-04-18 — Atlas spike.** Read [atlasgo.io/guides/orms/drizzle/existing-project](https://atlasgo.io/guides/orms/drizzle/existing-project), [atlas-schema/projects](https://atlasgo.io/atlas-schema/projects), [guides/deploying/k8s-argo](https://atlasgo.io/guides/deploying/k8s-argo), multi-tenant blog. Verdict: ADOPT. Replaced Phases B–E of original plan with Atlas-shaped equivalents. Candidate-a validation becomes Step 5's composite_schema proof instead of a conditional gate.

## Open questions

1. **composite_schema + Drizzle `external_schema` verification.** Step 5 is the test. If it fails, fall back to three independent per-node Atlas projects (not back to bespoke).
2. **Rollback semantics.** Atlas has `atlas migrate down` but our DBs are stateful — rollback = DB restore from backup for anything touching prod data. Document in `docs/spec/databases.md`.
3. **Schema DAG linting.** Node schema files should import only from `@cogni/db-core`, never another node. Add dep-cruiser rule in Phase B or follow-up.
4. **Legacy `__drizzle_migrations` cleanup timing.** Step 17 — 30 days post-prod-cutover feels right; revisit at cutover.

## Rejected Alternative — bespoke two-phase drizzle-kit runner

Original design (archived; retained here because the review history references it). Summary:

- New `packages/db-migrator` with `runCoreMigrations(db)` + `runNodeMigrations(db, nodeName)` hand-rolled TS
- Two migration tables per DB: `__drizzle_migrations_core` + `__drizzle_migrations_<node>`
- Bootstrap logic: copy hash/created_at rows forward from legacy `__drizzle_migrations` to `__drizzle_migrations_core` on first run; detect poly 0027 hash and re-route to `__drizzle_migrations_poly`
- Single parameterized migrator image via `--node=<name>`
- Django/Medusa.js pattern (per-package migration history)

**Rejected because** Atlas gives us the same architectural shape (per-node schemas, composition, single image, BUILD_ONCE_PROMOTE preserved) with:
- Documented `--baseline` flag replacing hand-rolled copy-forward (~300 LOC + tests we don't write)
- Documented composite_schema replacing ad-hoc two-dir runner
- Official Argo CD integration with one known fix (Lua health check)
- `atlas schema diff` for drift detection that we'd otherwise punt

The only bespoke-over-Atlas argument was "zero new tools, team already knows drizzle." Weighed against ~1–2 weeks of careful bootstrap testing, Atlas wins decisively.

## PR / Links

- Project: [proj.cicd-services-gitops.md](../projects/proj.cicd-services-gitops.md)
- Related: task.0260 (monorepo CI), task.0315 (poly copy-trade — node-local routing test case), task.0317 (per-node graph catalogs — analogous per-node pattern), task.0320 (per-node candidate flighting)
- Atlas docs: [existing-project](https://atlasgo.io/guides/orms/drizzle/existing-project), [composite_schema](https://atlasgo.io/atlas-schema/projects), [argo CD](https://atlasgo.io/guides/deploying/k8s-argo)

## Attribution

-
