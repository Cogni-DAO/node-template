---
id: task.0281.handoff
type: handoff
work_item_id: task.0281
status: active
created: 2026-04-04
updated: 2026-04-04
branch: worktree-staging-cicd (PR #738 → canary)
last_commit: 28cf4d47f
---

# Handoff: Modular CI/CD Pipeline — task.0281 + task.0260 context

## Context

- Unified the CI/CD pipeline from 5 environment-specific workflows into 3 modular workflows chained via `workflow_run`: build → promote-and-deploy → e2e
- Build happens once on canary. Staging receives promoted digests (same images, no rebuild). Release PR auto-created after staging E2E passes.
- Legacy `staging-preview.yml`, `promote-k8s-staging.yml`, `verify-deployment.yml`, `e2e-canary.yml` deleted. `build-prod.yml` + `deploy-production.yml` kept for production until it migrates to k8s/Argo.
- Specs rewritten: `docs/spec/ci-cd.md` and `docs/spec/node-ci-cd-contract.md` now match the canary-first architecture.
- Next priority is task.0260: affected-only builds + image dedup between CI and CD.

## Current State

- **PR #738** (→ canary): CI running. Contains all workflow changes, spec rewrites, `--no-commit` flag on promote script. Ready to merge when CI passes.
- **PR #740** (→ staging, MERGED): Bootstrapped `promote-and-deploy.yml` + `e2e.yml` on staging so `workflow_run` triggers fire. Has stale `GITHUB_SHA=""` hack — will be fixed when canary merges forward to staging.
- **Canary VM**: Being re-provisioned. Pipeline will be provable once VM is healthy.
- **Staging VM**: Not yet provisioned. Needs k3s + Argo CD + preview ApplicationSet.
- **ci.yaml**: Now triggers on `[canary, staging, main]` — stack tests run on all branches.
- **Image dedup gap**: ci.yaml stack-test and build-multi-node.yml both build the same Dockerfile with separate GHA cache scopes. Documented in task.0260.

## Decisions Made

- Canary-first: build only on canary, promote digests to staging/production (no per-env rebuilds). Spec: `docs/spec/ci-cd.md` BUILD_ONCE_PROMOTE_DIGEST invariant.
- Single-responsibility workflows: build, promote+deploy, e2e are separate files. Spec: SINGLE_RESPONSIBILITY invariant.
- `promote-k8s-image.sh --no-commit`: script updates overlay files, caller manages git. No more `GITHUB_SHA=""` env override hacks.
- PAT checkout for commits: `ACTIONS_AUTOMATION_BOT_PAT` sets commit author to Cogni bot, no explicit `git config` needed.
- CI runs in parallel with build on canary push; promotion/deploy fires off build success. CI gates PR merge, not canary deploy.

## Next Actions

- [ ] **task.0260**: Turborepo `--affected` for scope-aware testing (poly-only PR skips operator tests)
- [ ] **task.0260**: Deduplicate image builds — ci.yaml stack-test should pull from GHCR after build-multi-node pushes, not rebuild
- [ ] **task.0260**: Multi-node stack test lane (boot all 3 nodes in CI, run `pnpm test:stack:multi`)
- [ ] Provision staging VM with k3s + Argo CD + preview ApplicationSet
- [ ] Verify full chain end-to-end: push to canary → build → promote → deploy → e2e → auto-promote to staging → staging e2e → release PR
- [ ] Fix staging's promote-and-deploy.yml (still has `GITHUB_SHA=""` hack from merged #740 — gets fixed when canary merges to staging)
- [ ] Gate canary→staging promotion on CI success (currently promotes even if CI fails in parallel)
- [ ] Migrate production to same pipeline: retire `build-prod.yml` + `deploy-production.yml`

## Risks / Gotchas

- `workflow_run` only fires when the workflow file exists on the DEFAULT branch (staging). New workflow files must reach staging before they trigger.
- Staging's `promote-and-deploy.yml` (from #740) has a known push bug (`src refspec staging` error) — the `--no-commit` fix in #738 resolves this, but only after canary merges to staging.
- `promote-k8s-image.sh` without `--no-commit` auto-commits per app (4 pushes). Always pass `--no-commit` from workflows and batch into one atomic commit.
- Canary E2E dispatches promote-and-deploy for staging via `gh workflow run`. This requires `ACTIONS_AUTOMATION_BOT_PAT` to have workflow dispatch permissions.
- `build-prod.yml` and `deploy-production.yml` still live — production is NOT on the new pipeline yet. Don't delete them until production has k3s/Argo.

## Pointers

| File / Resource | Why it matters |
|---|---|
| `docs/spec/ci-cd.md` | Canonical pipeline spec — full chain diagram, environment table, workflow inventory |
| `docs/spec/node-ci-cd-contract.md` | CI/CD invariants, merge gate, file ownership classification |
| `work/items/task.0260.monorepo-ci-pipeline.md` | Next task: affected-only builds + image dedup |
| `.github/workflows/build-multi-node.yml` | Build-only (canary trigger), ~140 lines |
| `.github/workflows/promote-and-deploy.yml` | Promote overlays + deploy-infra + verify, ~400 lines |
| `.github/workflows/e2e.yml` | E2E smoke + canary→staging promotion + release PR, ~160 lines |
| `.github/workflows/ci.yaml` | CI gate: static + unit + component + stack-test (canary/staging/main) |
| `scripts/ci/promote-k8s-image.sh` | Overlay digest updater. Use `--no-commit` from workflows. |
| `scripts/ci/deploy-infra.sh` | SSH Compose infra deploy (postgres, temporal, litellm, redis, caddy, alloy) |
| `work/items/task.0281-canary-cicd-parity-staging-promotion.md` | Original 4-phase plan. Phase 1 done, Phase 2-3 done in pipeline, Phase 4 (delete legacy) pending production migration. |
