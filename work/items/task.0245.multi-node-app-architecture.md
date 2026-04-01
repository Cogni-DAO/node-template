---
id: task.0245
type: task
title: "Multi-node app architecture — 3 apps, per-node graph packages"
status: needs_design
priority: 0
rank: 1
estimate: 5
summary: "Split monorepo into 3 deployable node apps (operator, poly, resy) with per-node langgraph packages. Apps are the only node-specific code. Packages and services are shared."
outcome: "cognidao.org (operator), poly.cognidao.org (poly), resy.cognidao.org (resy) each have independent sign-in, independent graph catalogs, and independent deployments — all from one repo."
spec_refs:
  - docs/spec/node-operator-contract.md
  - docs/spec/node-launch.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [nodes, multi-app, architecture]
external_refs:
---

## Context

task.0244 established the multi-app monorepo pattern by pulling `apps/poly` and
`packages/market-provider` from the cogni-resy-helper fork. But the current state
still has problems:

1. `apps/poly` is just a landing page — no auth, no chat, no AI runtime
2. Resy features live inside `apps/web` — no separate resy app exists
3. `poly-brain` graph lives in the shared `packages/langgraph-graphs/` — every
   node gets every graph, violating node sovereignty
4. Auth (NextAuth/Auth0) is hardcoded for `apps/web`'s domain

## Architecture Principle

> **Apps are the only duplicated code across nodes.**

Everything else is shared:

```
apps/
  operator/        ← cognidao.org — DAO admin, node management, chat
  poly/            ← poly.cognidao.org — prediction market node
  resy/            ← resy.cognidao.org — reservation helper node

packages/          ← ALL shared across every node
  ai-core/         ← AI primitives
  ai-tools/        ← tool contracts + implementations
  db-schema/       ← shared DB schema (Drizzle)
  langgraph-graphs/           ← shared graph runtime + base graphs (brain, poet, research)
  langgraph-graphs-poly/      ← poly-specific graphs (poly-brain) + poly catalog
  langgraph-graphs-resy/      ← resy-specific graphs (future) + resy catalog
  market-provider/             ← Polymarket + Kalshi adapters
  ... (all other packages)

services/          ← ALL shared — operator-level infrastructure
  scheduler-worker/
  sandbox-openclaw/
  sandbox-runtime/
```

Each node app contains ONLY:

- Next.js shell (layout, routes, pages)
- Auth config (NextAuth provider, domain, callbacks)
- Bootstrap/container.ts (registers which graph packages + tools are available)
- UI components (landing page, chat, admin)
- Per-node env config (.env overrides for domain, auth, features)

## Design Questions

1. **Graph catalog composition**: Each node app builds its catalog by importing
   from shared `langgraph-graphs` + its own `langgraph-graphs-{node}`. How?
   - Option A: Each node app has its own catalog.ts that merges shared + node entries
   - Option B: Shared catalog exports a `createCatalog()` that accepts extensions
   - Option C: Each langgraph-graphs-{node} exports a partial catalog; app merges at bootstrap

2. **Shared app shell vs. full duplication**: How much of `apps/web` gets shared?
   - Chat UI components → shared package? Or copy per app?
   - Auth setup → shared auth package? Or per-app config?
   - Bootstrap container → each app wires its own (different capabilities per node)

3. **DB schema**: Single shared DB schema or per-node schema extensions?
   - V0: single schema, all nodes use same tables
   - V1: per-node schema packages extending base

4. **apps/web rename**: Should `apps/web` become `apps/operator`? The ROADMAP
   and node-operator-contract both reference `apps/operator/` as the target name.

## Plan

### Phase 1: Per-node graph packages

1. Create `packages/langgraph-graphs-poly/` — move poly-brain from shared
2. Export `POLY_CATALOG` (partial catalog) from the new package
3. Update `apps/web` bootstrap to merge shared + poly catalog
4. Remove poly-brain from `packages/langgraph-graphs/`

### Phase 2: Rename + extract apps

1. Rename `apps/web` → `apps/operator` (or keep as `apps/web` if too disruptive)
2. Create `apps/resy` — clone operator app shell, strip non-resy features
3. Create `apps/poly` as full app (auth, chat, AI runtime) — not just landing page
4. Each app gets its own `next.config.ts`, `package.json`, bootstrap

### Phase 3: Per-node auth

1. Each app configures its own NextAuth domain
2. Shared auth utilities in a package (e.g., `packages/auth-core`)
3. Per-node Auth0 tenant or shared tenant with different callbacks

### Phase 4: DNS + deployment

1. Wire `operator.cognidao.org`, `poly.cognidao.org`, `resy.cognidao.org` via dns-ops
2. Per-app Dockerfile (or shared Dockerfile with build arg)
3. Per-app k8s overlay (infra/cd/nodes/)

## Non-goals

- Per-node databases (V1+ concern)
- Operator repo extraction (Phase 6 per ROADMAP — needs paying customer)
- Per-node CI isolation (proj.cicd-services-gitops P2+)

## Validation

- [ ] `packages/langgraph-graphs-poly/` builds and typechecks independently
- [ ] Poly-brain graph no longer in shared `packages/langgraph-graphs/`
- [ ] Each of 3 apps starts independently on different ports
- [ ] Each app shows only its own graphs in the chat picker
- [ ] `pnpm check` passes
- [ ] dns-ops can create subdomains for each node
