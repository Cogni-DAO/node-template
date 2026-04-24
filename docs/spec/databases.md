---
id: databases-spec
type: spec
title: Database & Migration Architecture
status: active
trust: draft
summary: Database organization, migration strategies, and URL construction patterns
read_when: Working with databases, migrations, or connection configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-04-18
tags: [databases]
---

# Database & Migration Architecture

This document describes database organization, migration strategies, and database-specific configuration patterns.

**For stack deployment modes and environment details, see [Environments](environments.md).**

## Quick Start: Primary Development Workflow

**If you only need to know ONE thing:**

```bash
# Daily development (fake adapters, no external API calls)
pnpm dev:stack:test           # Start app + infrastructure in test mode
pnpm dev:stack:test:setup     # First time: create test DB + migrate
pnpm test:stack:dev           # Run stack tests
```

**For real AI calls (production adapters):**

```bash
pnpm dev:stack                # Same as above, but hits real LiteLLM/OpenRouter
```

**Docker stacks:** Used primarily in CI, not required for daily development. See sections 2.3-2.5 for details.

---

## Database Separation

**Database Security Model**: Two-user PostgreSQL architecture separating administrative and application access.

**Per-Node Databases (DB_PER_NODE):** Each node gets its own database on a shared Postgres server. The database IS the node boundary — no tenancy columns. See [Multi-Node Tenancy](multi-node-tenancy.md).

**Postgres vs Doltgres:** This spec covers the Postgres (awareness plane) side. The knowledge plane runs on a separate Doltgres server with per-node `knowledge_<node>` databases and git-like versioning — see [Knowledge Data Plane](knowledge-data-plane.md).

| Environment | Databases                                                         | Configured via                   |
| ----------- | ----------------------------------------------------------------- | -------------------------------- |
| Development | `cogni_operator`, `cogni_poly`, `cogni_resy`                      | `COGNI_NODE_DBS` in `.env.local` |
| Test        | `cogni_template_stack_test`, `cogni_poly_test`, `cogni_resy_test` | `COGNI_NODE_DBS` in `.env.test`  |
| CI          | `cogni_template_test`                                             | `COGNI_NODE_DBS` in `ci.yaml`    |
| Production  | `cogni_operator` (single-node for now)                            | `COGNI_NODE_DBS` in deploy env   |

`COGNI_NODE_DBS` is required — `provision.sh` fails fast if not set. No defaults, no fallback chain.

All stack deployment modes use the same migration tooling but connect to appropriate database instances. Test environments always use the test database and reset it between test runs.

## Database Provisioning (Infrastructure-as-Code)

To ensure a repeatable and consistent database state across environments (especially for `docker compose` setups), we use a dedicated provisioning service.

### The `db-provision` Service

In `docker-compose.dev.yml`, the `db-provision` service handles:

1. **Per-node database creation**: Iterates over `COGNI_NODE_DBS` (comma-separated), creates each database with `app_user` ownership and RLS role hardening.
2. **LiteLLM database creation**: Creates `LITELLM_DB_NAME` (root-owned, shared across nodes).
3. **Role provisioning**: Creates `app_user` (RLS enforced) and `app_service` (BYPASSRLS) roles, shared across all node databases.

Both `COGNI_NODE_DBS` and `LITELLM_DB_NAME` are required — `provision.sh` fails immediately if either is missing.

This service is gated behind the `bootstrap` profile and runs only when explicitly requested.

### Development vs. Production Roles

- **Development:** Local dev connects via `app_user` (RLS enforced) and `app_service` (BYPASSRLS). `provision.sh` applies RLS role hardening to all node databases.
- **Production:** Same two-user model. The application user should NOT have `DROP` or `TRUNCATE` permissions on the schema in production.

## Current Schema Baseline (Phase 0)

- **billing_accounts** — `id` (text PK), `owner_user_id` (unique), `balance_credits BIGINT DEFAULT 0`, timestamps.
- **virtual_keys** — `id` (uuid PK), `billing_account_id` (FK → billing_accounts, cascade), `litellm_virtual_key`, labels/flags, timestamps.
- **credit_ledger** — `id` (uuid PK), `billing_account_id` (FK → billing_accounts, cascade), `virtual_key_id` (FK → virtual_keys, cascade, NOT NULL), `amount BIGINT`, `balance_after BIGINT DEFAULT 0`, `reason`, optional reference/metadata, timestamps.
- Credits are stored as whole units (Stage 6.5 invariant: 1 credit = $0.001 USD, 1 USDC = 1,000 credits). Keep all arithmetic integer-only; no fractional credits.
- Optional: make `credit_ledger.virtual_key_id` nullable if you need ledger rows that are not tied to a specific virtual key (e.g., admin adjustments). Not required for the MVP if every entry is keyed.

## Database URL Configuration

Per [Database RLS Spec](database-rls.md) design decision 7, the runtime app requires **explicit DSN environment variables** — no component-piece fallback.

**Required Environment Variables:**

- `DATABASE_URL` — app_user role (RLS enforced), used by Next.js request paths
- `DATABASE_SERVICE_URL` — app_service role (BYPASSRLS), used by auth, workers, bootstrap

**Startup Invariants (enforced by `assertEnvInvariants`):**

- Both DSNs must use distinct PostgreSQL users
- Neither DSN may use superuser names (`postgres`, `root`, `admin`)
- Both DSNs must be present

**Environment Examples:**

- **Local development:** `postgresql://app_user:password@localhost:55432/cogni_template_dev`
- **Local testing:** `postgresql://app_user:password@localhost:55432/cogni_template_stack_test`
- **Production:** `postgresql://app_user:<secret>@postgres:5432/cogni_template_production?sslmode=require`

**Tooling-Only:** The `buildDatabaseUrl()` helper in `nodes/<node>/app/src/shared/db/db-url.ts` is used only by CLI test tooling (`drop-test-db.ts`, `reset-db.ts`). It is **not** used by the runtime app and **not** used by drizzle configs — per-node drizzle configs (`nodes/<node>/drizzle.config.ts`) require `DATABASE_URL` from env explicitly (task.0324).

## Database Security Architecture

**Three-Role Model**: Production deployments use separate PostgreSQL roles:

- **Root User** (`POSTGRES_ROOT_USER`): Database server administration, user/database creation
- **Application User** (`app_user` via `APP_DB_USER`): Runtime web app connections, RLS enforced
- **Service User** (`app_service` via `APP_DB_SERVICE_PASSWORD`): Priviledged system users, avoid using. Scheduler workers and pre-auth lookups, BYPASSRLS. Connects via `DATABASE_SERVICE_URL`.

See [Database RLS Spec](database-rls.md) for the dual-client architecture and static import enforcement.

**Container Configuration**: The `db-provision` service runs `provision.sh`:

- Creates roles: `app_user` (RLS), `app_service` (BYPASSRLS)
- Iterates `COGNI_NODE_DBS`: creates each database with ownership + RLS hardening
- Creates `LITELLM_DB_NAME`: root-owned, shared LiteLLM database

**Provisioning Variables** (used by `provision.sh`, not by runtime app):

| Variable                  | Purpose                             | Required         |
| ------------------------- | ----------------------------------- | ---------------- |
| `POSTGRES_ROOT_USER`      | Superuser for role/DB creation      | Yes              |
| `POSTGRES_ROOT_PASSWORD`  | Superuser password                  | Yes              |
| `COGNI_NODE_DBS`          | Comma-separated node database names | Yes (no default) |
| `LITELLM_DB_NAME`         | LiteLLM database name               | Yes (no default) |
| `APP_DB_USER`             | Application role name               | Yes              |
| `APP_DB_PASSWORD`         | Application role password           | Yes              |
| `APP_DB_SERVICE_USER`     | Service role name                   | Yes              |
| `APP_DB_SERVICE_PASSWORD` | Service role password               | Yes              |

**Runtime Variables** (used by app, never by provisioning):

| Variable               | Purpose                      |
| ---------------------- | ---------------------------- |
| `DATABASE_URL`         | app_user role (RLS enforced) |
| `DATABASE_SERVICE_URL` | app_service role (BYPASSRLS) |

> **Note:** The runtime app never receives `POSTGRES_ROOT_*`, `APP_DB_*`, or `COGNI_NODE_DBS`. These are provisioning-only.

## 2. Migration Strategy

**Core Principle:** Each node owns its migrations. Migrations run as an **initContainer on the node-app Deployment using the same image digest as the main container** (task.0370 — replaces the earlier per-node migrator-image + Argo PreSync-hook pattern from task.0322 after bug.0368 showed the separate image caused ~4min of per-flight image-pull).

**Architecture:**

- **One image per node:** `ghcr.io/cogni-dao/cogni-template[-{poly,resy}]:{sha}` — single runtime image. The initContainer reuses this digest; k3s reads it from the local cache (already pulled for the main container), so migrations start in seconds, not minutes.
- **Per-node migrate.mjs runner:** `nodes/{node}/app/src/adapters/server/db/migrate.mjs` — ~20-line ESM script invoked as the Deployment's initContainer command. Uses `drizzle-orm/postgres-js/migrator` against the sibling `./migrations` dir. Both `drizzle-orm` and `postgres` are production dependencies (already declared in `serverExternalPackages` in each node's `next.config.ts`) — no devDep footprint, no drizzle-kit at runtime.
- **Per-node drizzle-kit configs (dev + CI only):** `nodes/<node>/drizzle.config.ts` — used by `pnpm db:migrate:*` for local dev and by testcontainers. **Not** invoked at production runtime.
- **Core schema package:** `packages/db-schema` (`@cogni/db-schema`) — cross-node platform tables.
- **Per-node schema packages:** `nodes/<node>/packages/db-schema` (`@cogni/<node>-db-schema`) — node-local tables. Today only `@cogni/poly-db-schema` exists.
- **Migration history per DB:** one `drizzle.__drizzle_migrations` table per database (standard drizzle default). `migrate.mjs` reads this journal, applies only new rows — idempotent on every pod start (no-op in ~1s when nothing to apply). `0027_silent_nextwave.sql` is byte-duplicated across `nodes/{operator,poly,resy}/app/src/adapters/server/db/migrations/` (pre-task.0324 legacy) — READMEs warn against deletion.
- **Poly-doltgres** runs on a separate migration path (task.0370 PR C). `drizzle-orm/postgres-js/migrator` must be verified against Doltgres's non-compliant extended-protocol implementation before the same initContainer pattern is applied; until then, poly-doltgres retains its Argo PreSync hook Job.

**Invariants:**

- **FORWARD_COMPAT_MIGRATIONS** — every migration must be forward-compatible with the prior code version. With `strategy: RollingUpdate`, the old pod continues serving traffic against the newly-migrated schema between the new pod's initContainer commit and the old pod's termination. A `DROP COLUMN` / non-default `NOT NULL` during that window = partial outage. (Holds equally under the prior PreSync-hook pattern — made explicit here; CI lint for destructive SQL without `needs_two_deploys` pragma is follow-up task.0371.)
- **IDEMPOTENT_MIGRATIONS** — drizzle's journal-based migrator is safe to run twice; pod restarts and rolling updates never re-apply a completed migration.
- **NO_CROSS_NODE_TABLE_LEAK** — node-local tables are defined in that node's own workspace package. Adding a node-local table to `@cogni/db-schema` is a review-blocking error.
- **CORE_TABLES_IN_SHARED_PACKAGE** — `@cogni/db-schema` contains only tables every node needs (intersection, not union).
- **EACH_NODE_OWNS_ITS_MIGRATIONS** — `nodes/<node>/app/src/adapters/server/db/migrations/` is that node's authoritative history. Core-table changes are copied to each node's dir manually.
- **EXPLICIT_DATABASE_URL_NO_FALLBACK** — drizzle configs and `migrate.mjs` read `DATABASE_URL` from env and throw if unset. No component-piece fallback (matches runtime app invariant from §Database URL Configuration).
- **ONE_IMAGE_PER_NODE** — each deployed node ships exactly one container image. No `-migrate` suffix image.

**Migration Commands:**

- `pnpm db:migrate` — alias for `db:migrate:dev` (operator dev database via `nodes/operator/drizzle.config.ts`)
- `pnpm db:migrate:dev` — drizzle-kit with `.env.local` (operator dev database)
- `pnpm db:migrate:poly` / `:resy` — drizzle-kit with `DATABASE_URL_POLY` / `DATABASE_URL_RESY` from `.env.local` + that node's config
- `pnpm db:migrate:nodes` — runs all three in sequence
- `pnpm db:migrate:test` — drizzle-kit with `.env.test` (operator test database)
- `pnpm db:migrate:test:poly` / `:resy` — same pattern with `.env.test`
- `pnpm db:migrate:test:nodes` — runs all 3 test DB migrations
- `pnpm db:migrate:direct` — drizzle-kit using operator config + `DATABASE_URL` from current environment (used by testcontainers)
- `pnpm db:generate:{operator,poly,resy}` — generate new migrations for a node's schema (runs drizzle-kit diff)

**Execution Contexts:**

- **Local Dev** (`db:migrate:dev` / `:poly` / `:resy`): runs `drizzle-kit migrate` with `.env.local` + per-node config. For daily development.
- **Local Test** (`db:migrate:test*`): runs with `.env.test`. For test database setup.
- **Direct** (`db:migrate:direct`): runs with operator config using `DATABASE_URL` from environment. For testcontainers (`testcontainers-postgres.global.ts` sets `process.env.DATABASE_URL` before `execSync`).
- **Production runtime** (k8s initContainer): the node-app Deployment's initContainer runs `node /app/nodes/{node}/app/src/adapters/server/db/migrate.mjs` with `DATABASE_URL` from the node's Secret. Main container starts only after initContainer exits 0. Failure → `Init:Error` → old ReplicaSet keeps serving → `kubectl rollout status` non-zero. See [ci-cd.md](./ci-cd.md) for the full deploy flow.

**Future: Atlas + GitOps migrations** — declarative schema, CRD-based Argo integration, destructive-change linting. Deferred to task.0325 with full spike intel preserved.

### 2.1 Local Development

**Databases:** `cogni_operator`, `cogni_poly`, `cogni_resy` (per `COGNI_NODE_DBS`)

**Environment:** `.env.local`

**Commands:**

```bash
pnpm db:setup:nodes          # Provision + migrate + seed all 3 node DBs
pnpm db:migrate:nodes        # Migrate all 3 node DBs
pnpm dev:stack               # Start operator using cogni_operator
pnpm dev:stack:full           # Start operator + poly + resy (each on its own DB)
```

### 2.2 Host Stack Tests

**Databases:** `cogni_template_stack_test` (single-node), + `cogni_poly_test`, `cogni_resy_test` (multi-node)

**Environment:** `.env.test`

**Commands:**

```bash
# Single-node
pnpm dev:stack:test:setup     # Provision + migrate operator test DB
pnpm dev:stack:test           # Start operator in test mode
pnpm test:stack:dev           # Run single-node stack tests

# Multi-node
pnpm dev:stack:test:full:setup  # Provision + migrate all 3 test DBs
pnpm dev:stack:test:full        # Start operator + poly + resy in test mode
pnpm test:stack:multi           # Run multi-node isolation tests
```

**Details:**

- `test:stack:dev` uses `vitest.stack.config.mts` with `.env.test`
- `test:stack:multi` uses `vitest.stack-multi.config.mts` with `.env.test`
- `reset-db.ts` truncates tables in the operator test DB between test suites
- Multi-node tests seed and clean their own data per-test (no global reset)
- See [Full-Stack Testing Guide](../guides/full-stack-testing.md) for details

### 2.3 Docker Dev Stack

**Database:** `cogni_template_dev` (container Postgres)

**Environment:** `.env.local` passed to Docker Compose

**Commands:**

```bash
# First time setup (creates DB + runs migrations)
pnpm docker:dev:stack:setup     # Complete: build stack, create DB, migrate

# Manual steps (if needed)
pnpm docker:dev:stack           # Start containers
pnpm db:provision               # Create database
pnpm db:migrate                 # Run migrations with drizzle-kit
```

**Key Properties:**

- Dev stack owns schema and migrations in shared `postgres_data` volume
- Uses `docker-compose.dev.yml` with db-migrate service for migrations
- Postgres exposed on `localhost:55432` for debugging
- Migrations run via dedicated migrator image (not inside app container)

### 2.4 Docker Stack (Production Simulation)

**Database:** `cogni_template_dev` (reuses dev stack's database)

**Environment:** `.env.local` passed to Docker Compose

**Commands:**

```bash
pnpm docker:stack:setup         # Start production compose (assumes DB exists)
```

**Key Properties:**

- Uses hardened `docker-compose.yml` production configuration
- Shares same `postgres_data` volume as dev stack
- **Assumes database already created and migrated** via `docker:dev:stack:setup`
- `docker:stack:migrate` available but not used in local workflow

**Local Workflow:**

1. **After nuking volumes:** Run `pnpm docker:dev:stack:setup` once to create schema
2. **To simulate prod:** Run `pnpm docker:stack:setup` (reuses existing DB/schema from shared volume)

### 2.5 Docker Stack Testing

**Database:** `cogni_template_stack_test` (container Postgres)

**Environment:** `dotenv -e .env.test -e .env.local` (test overrides base)

**Commands:**

```bash
# 1. Start Docker stack in test mode
pnpm docker:test:stack          # Build and start containers with test env

# 2. Run migrations via db-migrate service
pnpm db:migrate:test

# 3. Run host tests against containerized app
pnpm test:stack:docker
```

**Key Properties:**

- Uses dedicated migrator image for migrations (not app container)
- Environment variables passed via dotenv to Docker Compose
- Migrations run via db-migrate service with `--profile bootstrap`
- Tests run from host, connect to exposed postgres port (55432) and app via HTTPS

## 3. Production Deployments

### 3.1 CI/CD Pattern

In staging and production, environment variables come from GitHub Environments/secrets, not `.env` files.

**GitHub Actions Environment:**

```yaml
env:
  APP_ENV: production
  NODE_ENV: production
  # Database configuration (two-user security model)
  POSTGRES_ROOT_USER: ${{ secrets.POSTGRES_ROOT_USER }}
  POSTGRES_ROOT_PASSWORD: ${{ secrets.POSTGRES_ROOT_PASSWORD }}
  APP_DB_USER: ${{ secrets.APP_DB_USER }}
  APP_DB_PASSWORD: ${{ secrets.APP_DB_PASSWORD }}
  COGNI_NODE_DBS: ${{ secrets.COGNI_NODE_DBS }} # Required, comma-separated
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  DATABASE_SERVICE_URL: ${{ secrets.DATABASE_SERVICE_URL }}
  COGNI_NODE_ENDPOINTS: ${{ secrets.COGNI_NODE_ENDPOINTS }} # Per-node billing routing
  LITELLM_MASTER_KEY: ${{ secrets.LITELLM_MASTER_KEY }}
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
```

**Deployment Steps:**

```yaml
- name: Run migrations
  run: |
    docker compose -f infra/compose/runtime/docker-compose.yml \
      --profile bootstrap run --rm db-migrate

- name: Start application
  run: |
    docker compose -f infra/compose/runtime/docker-compose.yml \
      up -d app
```

**Benefits:**

- Same `DATABASE_URL` for migrations and app
- Dedicated migrator image with pinned drizzle-kit version
- Migrations as repeatable deployment step (idempotent)
- Lean runner image (~80MB) without migration tooling
- db-migrate service receives only DB env vars (least-secret exposure)

## 4. Technical Implementation

### 4.1 Docker Image Architecture

**One image per node (task.0370 — supersedes the two-image split in task.0322):** each deployed node ships exactly one image from its own `nodes/<node>/app/Dockerfile`:

- **Runtime image** (`ghcr.io/cogni-dao/cogni-template:{sha}` for operator; `cogni-template-{poly,resy}:{sha}` for node variants): the app's Next.js standalone bundle + the node's migration SQL files + a ~20-line `migrate.mjs` runner. Runs as both the main Deployment container and the initContainer; reuses the already-pulled digest so migrations start in seconds, not minutes.

**Runner stage:** gains three `COPY` lines to bundle the migration SQL + migrate.mjs into the standalone layout:

```dockerfile
# nodes/<node>/app/Dockerfile (runner stage, partial)
COPY --from=builder --chown=nextjs:nodejs /app/nodes/<node>/app/src/adapters/server/db/migrations \
     ./nodes/<node>/app/src/adapters/server/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/nodes/<node>/app/src/adapters/server/db/migrate.mjs \
     ./nodes/<node>/app/src/adapters/server/db/migrate.mjs
```

`drizzle-orm` + `postgres` are already in each node's `next.config.ts` `serverExternalPackages`, so the standalone output ships them; `migrate.mjs` resolves both via standard Node.js module resolution at runtime. If a future bundle prune drops the `drizzle-orm/postgres-js/migrator` subpath, force it via `outputFileTracingIncludes` (pattern explicitly listed in task.0370).

**CI wiring (see `scripts/ci/`):** simpler after task.0370 PR B — one target per node instead of two:

- `detect-affected.sh` — emits the per-node target when its paths change.
- `build-and-push-images.sh` — builds one image per node.
- `merge-build-fragments.sh` — `canonical_order` array has one entry per node (no migrator companions).
- `resolve-pr-build-images.sh` — resolves one digest per node.
- `promote-build-payload.sh` — writes one digest per app overlay. The kustomize `images:` block has one `name:` matching `ghcr.io/cogni-dao/cogni-template[-{poly,resy}]`, which patches both the main container and the initContainer references in one shot.

**Legacy (pre-task.0370):** `scripts/ci/compute_migrator_fingerprint.sh`, the `-migrate` tag convention, and the migrator legs in `lib/image-tags.sh` are removed in PR B. Forks migrating from the two-image world drop those plus the `FROM base AS migrator` stage from their Dockerfiles.

### 4.2 Drizzle Configuration

Each node has its own `nodes/<node>/drizzle.config.ts`. Example (operator):

```typescript
import { defineConfig } from "drizzle-kit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for drizzle-kit (nodes/operator/drizzle.config.ts)."
    );
  }
  return url;
}

export default defineConfig({
  schema: "./packages/db-schema/src/**/*.ts",
  out: "./nodes/operator/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: requireDatabaseUrl() },
  verbose: true,
  strict: true,
});
```

Poly's config uses an array schema that unions core + poly's per-node package source: `["./packages/db-schema/src/**/*.ts", "./nodes/poly/packages/db-schema/src/**/*.ts"]`. drizzle-kit reads raw TS via these globs — no pre-built `dist/` required for migration generation. Resy and node-template are core-only until they ship their first node-local table, at which point they gain a `nodes/<node>/packages/db-schema/` package.

**Why this shape:**

- **No relative imports in the config.** drizzle-kit compiles configs to a temp directory before executing; relative TypeScript imports break from there. All paths are repo-root-relative (drizzle-kit runs with `CWD=repo root`).
- **Explicit `DATABASE_URL`, no fallback.** Caller (pnpm script, testcontainer, k8s Job) must set it. Matches the runtime app invariant in §Database URL Configuration.
- **Per-node `out` dir.** Each node writes migrations to its own `nodes/<node>/app/src/adapters/server/db/migrations/`. Cross-node collisions impossible — nothing shared.

## 5. Trade-offs of Current Approach

### 5.1 Benefits

**k8s-native migration lifecycle (task.0370):**

- Migrations run as a Deployment initContainer — the correct k8s primitive for "must complete before the app container starts."
- No separate Argo PreSync hook Job, no ambient hook phase-machine state, no `BeforeHookCreation` Job churn on every sync.
- Failures surface uniformly via `kubectl rollout status` non-zero; `/readyz` from old pods keeps traffic on the previous schema during failed rollouts.

**Fast, cache-friendly deploys:**

- initContainer reuses the main container's image digest → k3s hits the local layer cache → migrations start in seconds, not minutes (bug.0368: prior two-image pattern paid ~3m45s of per-flight image pull per node).
- Single image per node to build, push, promote, and verify — PR-build matrix is one leg per node instead of two.

**Same idempotent tooling, minimal runtime surface:**

- `drizzle-orm/postgres-js/migrator` reads `__drizzle_migrations` journal and applies only new rows — safe on every pod restart.
- No drizzle-kit, no tsx, no pnpm in the runtime image. Migration capability is a 20-line `migrate.mjs` plus two already-present prod deps (`drizzle-orm`, `postgres`).

### 5.2 Trade-offs

**Migration capability in the runtime image:**

- The runtime image ships `drizzle-orm/postgres-js/migrator` + migration SQL (both already required by the app; migrator subpath adds no new files beyond what `drizzle-orm` already bundles).
- An attacker with RCE in the main container already has `DATABASE_URL` (app_user) and can issue raw SQL via the always-resident `postgres` driver — adding the migrator subpath does not broaden the blast radius.
- Narrower posture (separate `app_migrator` role with DDL rights, `app_user` with DDL revoked) is deferred to proj.database-ops P1 — see §6.4.

**Forward-compatibility obligation:**

- `FORWARD_COMPAT_MIGRATIONS` is explicit: a `DROP COLUMN` without a two-deploy dance will partial-outage the rolling update. This obligation existed under the prior PreSync-hook pattern equally; we are making it explicit. CI lint is follow-up task.0371.

**Per-pod-start migration invocation:**

- Every pod start (including restarts, not just rollouts) runs the idempotent migrator — adds ~1s to cold start when the journal is caught up. Acceptable; pod restarts are rare in steady state.

## 6. Future Improvements (If/When Needed)

### 6.1 Row-Level Security (RLS)

RLS is implemented on all user-scoped tables (P0 complete). Tenant isolation uses `SET LOCAL app.current_user_id` per transaction. The `app_user` role has RLS enforced; `app_service` has BYPASSRLS. The `@cogni/db-client` package exposes two sub-path exports (`@cogni/db-client` for app-role, `@cogni/db-client/service` for service-role), and the adapter layer isolates `getServiceDb()` in a depcruiser-gated file. See [Database RLS Spec](database-rls.md) for full design, adapter wiring tracker, and remaining P1 hardening items.

### 6.2 SSL Enforcement

Non-localhost `DATABASE_URL` values do not currently require `sslmode=require`. Covered in [Database RLS Spec](database-rls.md).

### 6.3 Least-Privilege App Role

`provision.sh` creates the `app_user` role but does not restrict it from DDL operations. Production deployments should revoke `CREATE`, `DROP`, `TRUNCATE`, `ALTER` from the app role. Covered in [Database RLS Spec](database-rls.md).

### 6.4 Migration Credential Scoping

The initContainer currently binds the same `DATABASE_URL` the main container binds (`{node}-node-app-secrets.DATABASE_URL`, app_user role). Top-0.1% posture: migrations bind a narrower role (`app_migrator`) with DDL rights, the main container binds `app_user` with DDL revoked — neither role can do the other's job if compromised. The app_user role hardening is tracked in proj.database-ops P1 (credential convergence); the initContainer can adopt the narrower secret once that role exists.

### 6.5 Destructive-SQL CI Lint

`FORWARD_COMPAT_MIGRATIONS` (§2 invariants) is enforced by convention + code review today. Follow-up task.0371: CI job that fails on `DROP COLUMN` / `DROP TABLE` / non-default `ALTER COLUMN ... NOT NULL` unless the migration declares `-- needs_two_deploys: true` pragma.

### 6.6 Enhanced Environment Separation

**Stricter Test Isolation:**

- Container-specific DB reset routines
- Separate test databases for different environments
- Longer-running smoke test environments

**Production Pipeline:**

- Blue/green deployments with migration gating
- Automated migration rollback on failure

## 7. Summary

**Environment Separation:** host dev DB, host stack test DB, container stack DB cleanly separated.

**One Image per Node (task.0370):** single runtime image per node. Migrations run as an initContainer reusing the main container's digest — no per-flight image pull, no Argo PreSync hook, no drizzle-kit at runtime.

**Forward-Compatible Migrations:** the rolling-update data path means every migration must be compatible with the prior code version. `FORWARD_COMPAT_MIGRATIONS` is a hard invariant; CI lint is follow-up.

**Idempotent Tooling:** `drizzle-orm/postgres-js/migrator` reads `__drizzle_migrations` and applies only new rows — safe on every pod start.
