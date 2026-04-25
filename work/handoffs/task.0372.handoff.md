---
id: task.0372.handoff
type: handoff
work_item_id: task.0372
status: active
created: 2026-04-25
updated: 2026-04-25
branch: feat/task.0372-matrix-cutover
last_commit: 5dde7b1a7
---

# Handoff: Per-node matrix cutover (candidate-a + preview)

## Context

- Today, every flight workflow (`candidate-flight.yml`, `flight-preview.yml`, `promote-and-deploy.yml`) treats all 4 image targets as one all-or-nothing payload. A broken poly verify can fail an operator-only PR's flight. Single-slot lease, single deploy branch, single Argo wait.
- **Per-node lane isolation** = each `(env, node)` pair gets its own deploy branch (`deploy/<env>-<node>`), its own Argo Application, its own GHA matrix cell. Branch ref = lease (Kargo Stage primitive on existing infra). A failed verify on one node cannot block another node's lane.
- **Scope is candidate-a + preview only.** Production cutover deferred to **task.0375** until `release.yml`'s `deploy/preview/.promote-state/current-sha` semantics are designed. Don't extend this PR to prod.
- Substrate is in place: task.0320 declared per-env catalog branch fields; task.0374 shipped catalog-as-SSoT (axiom 16 `CATALOG_IS_SSOT`) so this task's enumeration logic reads `infra/catalog/*.yaml` natively.
- task.0373 already shipped snapshot/restore around the PR-branch rsync — keep it in the matrix cells; on single-target trees it's a near-no-op but cheap insurance.

## Current State

- task.0374 merged (`5dde7b1a7`). `image-tags.sh` is a catalog-backed shim; `detect-affected.sh` reads `path_prefix:`; `wait-for-argocd.sh` requires explicit `PROMOTED_APPS` (no default); `candidate-flight.yml` has a worked-example shape; `pr-build.yml` validates schema on catalog-touching PRs.
- task.0320 substrate in `infra/catalog/*.yaml`: `candidate_a_branch` / `preview_branch` / `production_branch` fields **declared** but per-node branches **NOT pushed**. `git ls-remote origin 'refs/heads/deploy/*-*'` returns zero rows today.
- The 3 AppSets (`infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml`) each have 1 git generator reading `infra/catalog/*.yaml` from the whole-slot deploy branch. Argo Applications named `<env>-<name>`.
- task.0372 design body already addresses dev2 gap-2 (preview lease aggregation policy: any cell red → preview unlocked; all green → locks) and gap-3 (decision: keep `deploy/preview` alive as roll-up). Open gaps 1/4/5 listed in Risks.
- Stale `feat/task.0372-per-node-matrix` branch deleted from origin; this fresh worktree branches from `origin/main` post-task.0374.

## Decisions Made

- [task.0320 design + GR-1..GR-6](../items/task.0320.per-node-candidate-flighting.md) — substrate + guardrails. AppSet shape is **4 git generators in one ApplicationSet** (Argo doesn't template `revision` per file). Concurrency group `flight-<env>-${{ matrix.node }}`. Dogfood ordering: this PR ships under the **existing whole-slot** workflow.
- [task.0372 work item](../items/task.0372.candidate-flight-matrix-cutover.md) — full design body, layered cutover plan, gap-2/gap-3 inline resolutions, files list, validation cases (a)–(f).
- [task.0374 PR #1053](https://github.com/Cogni-DAO/node-template/pull/1053) — catalog SSoT + decide-job pattern in `candidate-flight.yml` (the worked example to mirror in `flight-preview.yml` + `promote-and-deploy.yml`).
- [task.0373 PR #1047](https://github.com/Cogni-DAO/node-template/pull/1047) — snapshot/restore around rsync. Keep this on the per-node matrix cells.
- [`docs/spec/ci-cd.md` axiom 16](../../docs/spec/ci-cd.md) — `CATALOG_IS_SSOT`. New flight matrices read catalog via the pre-installed `yq` on `ubuntu-24.04`.
- Production cutover **out of scope** of this PR — filed as [task.0375](../items/task.0375.production-matrix-cutover.md).

## Next Actions

- [ ] Read [task.0372 work item](../items/task.0372.candidate-flight-matrix-cutover.md) end-to-end (Design + Freeze/Scope + Open gaps sections). It's the primary briefing.
- [ ] Read [task.0320 § Design + GR-1..GR-6](../items/task.0320.per-node-candidate-flighting.md). The architectural primitive lives there.
- [ ] **Pre-PR ops: write + run `scripts/ops/bootstrap-per-node-deploy-branches.sh`.** One-shot, idempotent. Iterates `infra/catalog/*.yaml` (catalog SSoT now lets this be ~10 lines). For each `env ∈ {candidate-a, preview}`, push `deploy/<env>-<node>` from each `deploy/<env>` HEAD. Verify via `git ls-remote origin 'refs/heads/deploy/{candidate-a,preview}-*'` → expect 8 rows. (production deploy/<env>-<node> is task.0375 ops.)
- [ ] Refactor `infra/k8s/argocd/candidate-a-applicationset.yaml` and `preview-applicationset.yaml`: 1 git generator → 4 per-node generators. Application names unchanged so Argo reconciles in place. Add `preserveResourcesOnDeletion: true`.
- [ ] Refactor `candidate-flight.yml` to matrix shape (decide → fan-out flight cells with `fail-fast: false`, concurrency `flight-candidate-a-${{ matrix.node }}`). Snapshot/restore (task.0373) collapses to single-target per cell.
- [ ] Refactor `flight-preview.yml` matrix; preserve task.0349's `preview-flight-outcome` artifact contract via the gap-2 aggregator job.
- [ ] Refactor preview half of `promote-and-deploy.yml` matrix; `flight-preview.yml`'s aggregator fast-forwards `deploy/preview` to a roll-up commit so `release.yml`'s current-sha read stays valid (gap-3).
- [ ] Update `candidate-flight-infra.yml` with GR-5 best-effort `gh run list --status=in_progress` pre-check.
- [ ] Delete `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh`. Update `scripts/ci/AGENTS.md`. Rewrite `.claude/skills/pr-coordinator-v0/SKILL.md`.
- [ ] Tighten `docs/spec/ci-cd.md` per-node-branch + Kargo prose (task.0320 stubbed; this task makes it operative for candidate-a + preview).
- [ ] Validate per task body cases (a)–(f). Especially (b) — broken-resy-on-multi-node PR must keep operator/poly/scheduler-worker cells green.

## Risks / Gotchas

- **Argo 1→4 generator transition.** Application names stay byte-identical (`<env>-<name>`), so Argo reconciles in place. `preserveResourcesOnDeletion: true` is belt-and-suspenders. **Dry-run-render the AppSet via `kubectl kustomize` and `argocd app diff` before merge.** Rollback = `git revert` of the AppSet diff (deploy branches stay).
- **Dogfood ordering (GR-2).** This PR's own diff flights via the **existing whole-slot** `candidate-flight.yml` (the file in main pre-merge). Don't introduce a chicken-and-egg bootstrap workflow. The first PR merged AFTER this one is the first matrix flight.
- **Stale PR overlay digests on per-node branches** — task.0373's snapshot/restore must run inside each matrix cell, scoped to that one node. Verify cells don't accidentally rsync the whole `infra/k8s/overlays/<env>/` rather than the per-node subdir.
- **Open gaps 1/4/5** (in task body): `detect-affected` BASE selection per env, `preview-flight-outcome` artifact aggregation, candidate-flight commit-status report fan-out. Each has a sketched resolution; verify in implementation.
- **promote-and-deploy.yml is 930 lines.** Highest implementation risk. Recommended order: candidate-flight (560 lines) → flight-preview (277 lines, retag already affected-only) → promote-and-deploy. Test each before moving on.

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`work/items/task.0372.candidate-flight-matrix-cutover.md`](../items/task.0372.candidate-flight-matrix-cutover.md)                     | Primary briefing: design body, gap-2/gap-3 resolutions, files list, validation (a)–(f)           |
| [`work/items/task.0320.per-node-candidate-flighting.md`](../items/task.0320.per-node-candidate-flighting.md)                           | Substrate + GR-1..GR-6 design guardrails                                                         |
| [`work/items/task.0375.production-matrix-cutover.md`](../items/task.0375.production-matrix-cutover.md)                                 | Out-of-scope follow-up — explains why prod is excluded                                           |
| [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md)                                                                                       | Axiom 16 (`CATALOG_IS_SSOT`); per-node-branch + Kargo prose to tighten                           |
| [`infra/catalog/*.yaml`](../../infra/catalog/)                                                                                         | SSoT — read `name`, `path_prefix`, `*_branch` fields                                             |
| [`infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml`](../../infra/k8s/argocd/)                                     | The 1→4 generator refactor surface (production = task.0375)                                      |
| [`.github/workflows/candidate-flight.yml`](../../.github/workflows/candidate-flight.yml)                                               | Worked-example decide job from task.0374 lives at the head; matrix-fan the `flight` job below it |
| [`.github/workflows/flight-preview.yml`](../../.github/workflows/flight-preview.yml)                                                   | Retag already affected-only; matrix the dispatch + add gap-2 aggregator job                      |
| [`.github/workflows/promote-and-deploy.yml`](../../.github/workflows/promote-and-deploy.yml)                                           | 930 lines; preview half only in this PR; keep production path untouched until task.0375          |
| [`.github/workflows/pr-build.yml`](../../.github/workflows/pr-build.yml)                                                               | task.0374 worked example for `decide` → `targets_json` matrix                                    |
| [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh)                                                                   | Catalog-backed shim — no edits needed; just source it from new code paths                        |
| [`scripts/ci/wait-for-argocd.sh`](../../scripts/ci/wait-for-argocd.sh)                                                                 | Requires `PROMOTED_APPS` per cell. Ancestry check fixed in PR #1054.                             |
| Argo CD ApplicationSet [files generator docs](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/Generators-Git/) | Confirm "1 generator → 4 generators" pattern. `revision` is per-generator, not per-file (GR-1)   |
