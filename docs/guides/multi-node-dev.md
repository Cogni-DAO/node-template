---
id: guide.multi-node-dev
type: guide
title: Multi-Node Development Guide
status: draft
trust: draft
summary: Layout, dev commands, testing, and DB setup for running operator + node apps locally
read_when: Running multi-node dev stack, adding a new node, or debugging node auth
owner: derekg1729
created: 2026-04-01
verified: null
tags: [nodes, dev, infrastructure]
---

# Multi-Node Development Guide

## Layout

```
nodes/operator/         → Operator dashboard (port 3000)
nodes/node-template/    → Base template for new nodes
nodes/poly/             → Poly prediction node (port 3100)
nodes/resy/             → Resy reservations node (port 3300)
```

Each node has two workspace packages: `app/` (Next.js) and `graphs/` (AI graphs).
All nodes share infra services (Postgres, Temporal, LiteLLM, Redis) and the same
database. Auth sessions are shared — sign in once, use any node.

## Running Locally

```bash
# Start infra + operator (always first)
pnpm dev:stack                   # infra + operator on :3000

# Then add nodes in separate terminals
pnpm dev:poly                    # poly on :3100
pnpm dev:resy                    # resy on :3300

# Or start everything at once (one terminal)
pnpm dev:stack:full              # infra + operator + poly + resy
```

Auth is shared — sign in on any port, the cookie works on all (same `localhost`).

```bash
# Docker (containerized) — TODO: task.0247 adds per-node containers
pnpm docker:stack:full           # currently launches operator only
```

## Typechecking

```bash
# Operator (default, runs in pnpm check)
pnpm typecheck

# Individual nodes (from repo root, same pattern)
pnpm typecheck:node-template
pnpm typecheck:poly
pnpm typecheck:resy
```

All typecheck commands run from the repo root using `tsc -p <path>/tsconfig.app.json`.
Each node's tsconfig overrides `@/*` paths to resolve to its own `src/`.

## Testing

```bash
# Operator tests (unit + contract, no server needed)
pnpm test

# Operator stack tests (requires dev:stack:test running)
pnpm test:stack:dev

# Node-specific tests (from repo root, via pnpm filter)
pnpm --filter @cogni/poly-app test
pnpm --filter @cogni/resy-app test
pnpm --filter @cogni/poly-graphs test
pnpm --filter @cogni/resy-graphs test
```

## Pre-commit Gate

```bash
pnpm check          # Operator: typecheck + lint + format + tests + docs + arch
```

Node typechecks are not yet in the `pnpm check` pipeline — run them manually
when you change node-specific code. This will be unified in task.0248.

## Creating a New Node

1. Copy `nodes/node-template/` → `nodes/{name}/`
2. Update `app/package.json`: name → `@cogni/{name}-app`, port
3. Update `graphs/package.json`: name → `@cogni/{name}-graphs`
4. Add root scripts to `package.json`:
   - `"typecheck:{name}": "tsc -p nodes/{name}/app/tsconfig.app.json --noEmit"`
5. Add node-specific features under `app/src/features/`
6. Add node-specific graphs under `graphs/src/graphs/`
7. Run `pnpm install` to link the new workspace packages

## Database & Auth

**Each node has its own Postgres database.** Operator → `cogni_template_dev`,
poly → `cogni_poly`, resy → `cogni_resy`. Dev URLs live in `.env.local` as
`DATABASE_URL`, `DATABASE_URL_POLY`, `DATABASE_URL_RESY`. Production k8s
overlays patch the DB secret per node the same way.

**Schema source (today, 2026-04):** all tables are defined in the shared
`@cogni/db-schema` workspace package. `drizzle-kit` is driven by a single
root `drizzle.config.ts` that writes migrations to
`nodes/operator/app/src/adapters/server/db/migrations/`. Poly, resy, and
node-template currently hold **byte-identical copies** of those migrations
in their own `migrations/` dirs — there is no per-node extension mechanism
yet. Adding a node-local table means adding it to the shared schema and
applying it to every DB. This is a known limitation tracked in **task.0322**
(per-node schema independence via `@cogni/db-core` + per-node extensions).

```bash
pnpm db:setup           # provision cogni_template_dev + migrate + seed
pnpm db:migrate:dev     # operator DB
pnpm db:migrate:poly    # cogni_poly — swaps DATABASE_URL, runs same migrations
pnpm db:migrate:resy    # cogni_resy — swaps DATABASE_URL, runs same migrations
pnpm db:migrate:nodes   # run all three in sequence
```

**Production migration gap:** the production k8s overlays for poly and resy
currently ship a no-op migration Job (`exit 0` — see
`infra/k8s/overlays/production/{poly,resy}/kustomization.yaml`). Preview
overlays DO migrate. Production migration wiring is blocked on task.0260
(per-node migrator images) and task.0322.

**Auth:** Because each node has its own DB, NextAuth session rows do **not**
transit between nodes. Signing in on poly creates a session row in
`cogni_poly`; the same cookie on operator authenticates against
`cogni_template_dev` separately. Shared `AUTH_SECRET` means JWT decoding
works across ports, but DB-backed session state is per-node. OAuth redirects
are scoped to the right port via the `NEXTAUTH_URL_*` env vars set by the
`dev:stack:*` scripts.

**Future (task.0322):** Node-local schemas live in `nodes/{name}/app/schema/`
and compile to per-node migration dirs. Core platform tables move into
`@cogni/db-core` (semver'd), propagated by lockfile bumps rather than
copy-paste.

## Architecture Notes

- Each node app is a **full platform copy** of the operator (auth, chat, streaming,
  billing, treasury) minus the DAO formation wizard
- Node-specific features (e.g. resy's reservations) live in `app/src/features/`
- Shared packages (`@cogni/ai-tools`, `@cogni/market-provider`, etc.) are in `packages/`
- Each node has its own DB; schema is currently centralized in `@cogni/db-schema`
  with byte-copied per-node migrations. Per-node schema independence is task.0322.
- Future: task.0248 will extract the shared platform into `packages/node-platform`
  so nodes become thin shells instead of full copies
