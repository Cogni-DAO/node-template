---
id: task.0273
type: task
title: "Unify workspace: move operator to nodes/operator/app"
status: needs_implement
priority: 1
rank: 5
estimate: 3
summary: "Move apps/operator/ to nodes/operator/app/ so all node apps follow one directory convention. Enables single Dockerfile template, single CI matrix, uniform Argo CD targets."
outcome: "All node apps live under nodes/{name}/app/. One glob, one Dockerfile pattern, one deploy target shape. The deploy dev (Argo CD) gets uniform inputs."
spec_refs:
  - spec.node-app-shell
  - docs/spec/packages-architecture.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch: feat/node-workspace-unify
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02

labels: [refactor, architecture, nodes, infra]
external_refs:
---

# Unify workspace: move operator to nodes/operator/app

## Context

Operator is the only node app living outside `nodes/`. It sits at `apps/operator/` while all other nodes are at `nodes/{name}/app/`. This creates:

- Different `outputFileTracingRoot` paths in next.config.ts
- Different workspace globs in pnpm-workspace.yaml
- Different Docker build contexts and Dockerfile paths
- Different CI configuration
- A special case the deploy dev (Argo CD) must handle separately

Operator has only 8 unique files vs node-template (DAO setup flow + VCS adapter). Everything else is shared platform code. The "operator plane" is a role distinction, not a code structure distinction.

## Plan

### Pre-flight

- [ ] Verify integration/multi-node is clean and all task.0248 phases merged
- [ ] Snapshot: `find apps/operator -type f | wc -l` for before/after comparison

### Move

- [ ] `mkdir -p nodes/operator && mv apps/operator nodes/operator/app`
- [ ] Create `nodes/operator/.cogni/repo-spec.yaml` (copy from node-template, update node identity)
- [ ] Update `nodes/operator/app/next.config.ts`: `outputFileTracingRoot` depth `../../` → `../../../` (matches other nodes)
- [ ] Update `nodes/operator/app/tsconfig.app.json`: verify `baseUrl` and path aliases resolve
- [ ] Update `nodes/operator/app/package.json`: verify name field

### Workspace wiring

- [ ] Update `pnpm-workspace.yaml`: remove `apps/*` glob (all apps now under `nodes/*/app`)
- [ ] `pnpm install` — verify lockfile resolves
- [ ] Update root `tsconfig.json`: path aliases `@/*` → `nodes/operator/app/src/*` (was `apps/operator/src/*`)
- [ ] Update root `tsconfig.base.json`: same path alias update

### Docker + CI

- [ ] Update `apps/operator/Dockerfile` → `nodes/operator/app/Dockerfile` (path references inside)
- [ ] Update `infra/compose/runtime/docker-compose.yml`: app service build context
- [ ] Update `infra/compose/runtime/docker-compose.dev.yml`: app service build context
- [ ] Update `.github/workflows/ci.yaml`: all `apps/operator` path references
- [ ] Update any scripts referencing `apps/operator` (`scripts/`, `infra/`)

### Dependency cruiser + lint

- [ ] Update `.dependency-cruiser.cjs`: operator path references
- [ ] Update `biome/` config if it references `apps/operator`
- [ ] Update `eslint` config paths in package.json lint scripts

### Documentation

- [ ] Update `CLAUDE.md`: usage commands, directory references
- [ ] Update `docs/spec/architecture.md`: directory structure diagram
- [ ] Update `docs/spec/node-app-shell.md`: file pointers
- [ ] Update `docs/guides/multi-node-dev.md`: operator references
- [ ] Remove stale `apps/` AGENTS.md if the directory is empty
- [ ] Create `nodes/operator/AGENTS.md`

### Validate

- [ ] `pnpm install`
- [ ] `pnpm packages:build`
- [ ] `pnpm check:fast`
- [ ] `pnpm --filter operator build` (next build passes)
- [ ] `pnpm check:docs`

### Post-merge coordination

- [ ] Notify Argo CD dev: operator deploy target path changed
- [ ] Verify `pnpm dev` still works (operator on port 3000)

## Validation

```bash
pnpm install
pnpm packages:build
pnpm check:fast
pnpm --filter operator build
pnpm check:docs
```

## Notes

- This subsumes task.0248 Phase 4 (workspace restructure). The original Phase 4 planned `nodes/*/app/` → `nodes/*/apps/web/` rename — that's deferred; current `app/` convention is fine for deploy.
- Adapter drift between operator and node-template is from parallel development, not intentional. Will naturally collapse as nodes share more code.
- The `apps/` directory may still be needed for future non-node apps (marketing site, docs site). If so, keep the glob but leave it empty for now.
