---
id: cicd-deploy-branches
type: handoff
work_item_id: task.0281
status: active
created: 2026-04-04
updated: 2026-04-05
branch: canary
last_commit: 35a46f4ad
---

# Handoff: Deploy-Branch CI/CD + Canary → Staging Promotion

## Context

- Canary CI/CD pipeline was rebuilt to use **deploy branches** (orphan `deploy/canary`, `deploy/staging`, `deploy/production`) for Argo CD GitOps, separating app code from rendered deploy state
- The full chain is: push to canary → Build Multi-Node → Promote and Deploy (PR against `deploy/canary`, auto-merge) → Argo syncs pods → deploy-infra (Compose) → verify health → E2E smoke → staging promotion
- Goal 1 (manual deploy-branch validation) is **proven** — round-trip digest swaps work, Argo syncs in ~15s
- Goal 2 (automated CI/CD) is **almost there** — the promote-and-deploy chain runs green through verify, but E2E smoke tests fail
- Related work item: `task.0281` (canary CI/CD parity + staging promotion)

## Current State

- Deploy branches pushed and live: `deploy/canary`, `deploy/staging`, `deploy/production` (all orphan)
- ApplicationSet on canary VM patched to watch `deploy/canary` — verified working
- Promote and Deploy chain: **green** (promote-k8s ✅, deploy-infra ✅, verify ✅)
- E2E Smoke: **failing** — 2 tests fail because operator node's home page layout doesn't have the landmarks the tests expect (skip link, `nav[aria-label="Primary"]`)
- The a11y fixes in `#754` edited `AppHeader.tsx` in all 4 nodes but **operator doesn't use AppHeader on its public routes**. The operator home page renders a different layout without `<header>` or `<nav>` elements
- `workflow_run` caveat resolved: workflows on staging (default branch) now have the deploy-branch PR model (#757, #759 merged)

## Decisions Made

- Deploy-branch model: [PR #747](https://github.com/Cogni-DAO/node-template/pull/747), [spec](docs/spec/cd-pipeline-e2e.md)
- PR-driven promotion, not direct push: concurrency groups per environment prevent race conditions
- `workflow_run` reads workflow YAML from default branch (staging): all CI workflows must be synced to staging — [PR #757](https://github.com/Cogni-DAO/node-template/pull/757), [PR #759](https://github.com/Cogni-DAO/node-template/pull/759)

## Next Actions

- [ ] **Fix E2E smoke tests** — the blocker. Two options:
  - Option A: Add skip link + nav landmarks to operator's ACTUAL public layout (find what renders at `/` — it's NOT `AppHeader.tsx`)
  - Option B: Update E2E tests to match operator's real layout (check what elements actually exist)
  - Start by running `curl -sk https://test.cognidao.org/ | grep '<header\|<nav\|<main'` to see what's there
- [ ] Once E2E green: `promote-to-staging` job auto-triggers → staging promotion → release PR to main
- [ ] Verify preview VM has ApplicationSets pointing to `deploy/staging` (may need `kubectl patch` like canary)
- [ ] After full chain proven: sync remaining workflows to staging, clean up stale overlays from app branches
- [ ] Set "restrict push" on `deploy/*` branches (only CI bot should push)

## Risks / Gotchas

- **`workflow_run` always reads from default branch (staging)** — any workflow change MUST be synced to staging or it won't take effect for `workflow_run` triggers. `workflow_dispatch` reads from the specified `--ref` branch
- **Operator node does NOT use `AppHeader.tsx`** on canary — it has a different public layout. The a11y fix (#754) was applied to the wrong component. Find operator's actual `(public)/layout.tsx` or equivalent
- **E2E checkout uses `head_branch`** not `head_sha` (#759) — this means it gets branch HEAD, not the exact promoted commit. Acceptable for now but could cause a race if canary moves fast
- **Preview VM** may need the same ApplicationSet patch (`kubectl patch applicationset`) before staging promotion works
- The `promote-to-staging` job in `e2e.yml` passes `source_sha` which is the canary build SHA — verify `promote-and-deploy.yml` resolves images from that SHA correctly for staging

## Pointers

| File / Resource                                                | Why it matters                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `.github/workflows/promote-and-deploy.yml`                     | Two-checkout PR model (app-src + deploy-branch), rsync, auto-merge |
| `.github/workflows/e2e.yml`                                    | E2E + promote-to-staging + promote-release jobs                    |
| `.github/workflows/build-multi-node.yml`                       | Triggers the chain on push to canary                               |
| `infra/k8s/argocd/*-applicationset.yaml`                       | Point to `deploy/*` branches                                       |
| `scripts/ci/promote-k8s-image.sh`                              | Updates overlay digests (`--no-commit` mode)                       |
| `scripts/setup/provision-test-vm.sh`                           | Applies ApplicationSets during VM bootstrap                        |
| `docs/guides/multi-node-deploy.md`                             | Updated deploy guide with deploy-branch mechanics                  |
| [PR #758](https://github.com/Cogni-DAO/node-template/pull/758) | Example auto-merged deploy PR from the working chain               |
| Canary VM: `84.32.109.222`, key: `.local/test-vm-key`          | SSH access for kubectl/debugging                                   |
