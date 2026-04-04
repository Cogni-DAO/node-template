---
id: handoff.multi-node-cicd
type: handoff
work_item_id: task.0281
status: active
created: 2026-04-03
updated: 2026-04-04
branch: fix/ci-caddy-upstream-default
last_commit: 8f7f52776
---

# Handoff: Canary CI/CD — Stack Test Unblock + Branch Management

## Context

- Canary CI/CD pipeline was fully broken for 3+ days — stack tests never ran (livez timeout)
- Root causes were layered: Caddy routing, indexedDB SSR build crash, LiteLLM healthcheck timeout, COGNI_NODE_ENDPOINTS format mismatches, billing callback path
- PR #721 (`fix/ci-caddy-upstream-default`) fixes all of them — CI now gets through livez + readyz and runs actual tests
- 5 billing-related stack tests fail because `cogni_callbacks.py` posted to base URL without `/api/internal/billing/ingest` path — fix included in PR #721
- Local dev workspace needs scheduler-worker Docker rebuild + `.env.test` COGNI_NODE_ENDPOINTS update

## Current State

- **PR #721**: 6 fixes combined, CI running (static/unit/component all pass, stack-test pending)
- **Local dev**: readyz passes (200), scheduler-worker running, stack tests ready to run via `pnpm test:stack:dev`
- **Canary VM**: being re-provisioned by other dev (provision script had 5 critical bugs, now fixed)
- **Branch**: `fix/ci-caddy-upstream-default` checked out in main worktree
- **Other open PRs**: #716 (contributor skill), #719 (indexedDB, merged into #721), #720 (provision path, duplicate of #718), #723 (infra deploy + Alloy), #724 (cleanup)

## Decisions Made

- `COGNI_NODE_ENDPOINTS` uses base URLs everywhere; `cogni_callbacks.py` appends `/api/internal/billing/ingest` — see PR #721
- Caddy upstream vars default to Docker DNS (`app:3000`) in CI/dev, overridden for k3s edge — `{$OPERATOR_UPSTREAM:app:3000}` syntax
- Three k8s overlays: `canary/`, `preview/`, `production/` — renamed from single `staging/`
- All PRs target `canary` via feature branches, never direct push — see `.claude/commands/git-branch-feature-coordinator.md`
- task.0281 defines 4-phase path from canary CI/CD to unified staging/production pipeline

## Next Actions

- [ ] Verify PR #721 stack-test passes in CI (running now)
- [ ] Run `pnpm test:stack:dev` locally — confirm all 51 test files pass
- [ ] Merge PR #721 to canary
- [ ] Close PR #719 (merged into #721) and #720 (duplicate of merged #718)
- [ ] Rebase + merge #716 (contributor skill), #724 (cleanup)
- [ ] Verify canary VM reprovision completes (other dev)
- [ ] Once canary green: start task.0281 Phase 1 (deploy-infra.sh) — branch `feat/task-0281-phase1-infra-deploy` exists with handoff
- [ ] Update `.env.test.example` with base-URL COGNI_NODE_ENDPOINTS format (partially done, needs commit)

## Risks / Gotchas

- `.env.test` is gitignored — local devs need to update `COGNI_NODE_ENDPOINTS` to `operator=http://host.docker.internal:3000,4ff8eac1-...=http://host.docker.internal:3000` format (no `/api/internal/billing/ingest` suffix)
- Scheduler-worker Docker image must be rebuilt locally (`pnpm scheduler:docker:build`) if stale — old image requires `APP_BASE_URL` which was removed from source
- SonarCloud external check fails on all PRs — not blocking, not our CI
- LiteLLM healthcheck needs 120s `start_period` in dev compose — old 30s causes `dependency failed to start` on slow machines
- Multiple worktrees exist under `.claude/worktrees/` — clean up unused ones to avoid branch lock conflicts

## Pointers

| File / Resource                                                | Why it matters                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `.github/workflows/build-multi-node.yml`                       | The canary CI pipeline — build, promote, verify                       |
| `.github/workflows/e2e-canary.yml`                             | Playwright smoke tests, triggers after build success                  |
| `.github/workflows/ci.yaml` (stack-test job)                   | Stack test configuration — env vars, Docker build, test runner        |
| `infra/compose/edge/configs/Caddyfile.tmpl`                    | Caddy upstream routing with per-node defaults                         |
| `infra/images/litellm/cogni_callbacks.py`                      | Billing callback — appends `/api/internal/billing/ingest` to base URL |
| `infra/compose/runtime/docker-compose.dev.yml`                 | Dev compose — LiteLLM healthcheck, Caddy env vars                     |
| `.claude/commands/git-branch-feature-coordinator.md`           | Branch management workflow for canary                                 |
| `work/items/task.0281-canary-cicd-parity-staging-promotion.md` | The roadmap: 4 phases to unified CI/CD                                |
| `work/handoffs/task.0281.handoff.md`                           | Phase 1 handoff: deploy-infra.sh implementation guide                 |
| `work/projects/proj.cicd-services-gitops.md`                   | Project scorecard and full roadmap                                    |
