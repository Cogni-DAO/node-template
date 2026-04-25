---
id: task.0372
type: task
title: Per-node cutover — refactor candidate-a + preview AppSets + matrix fan-out
status: needs_implement
priority: 0
rank: 99
estimate: 4
summary: "Unblocked 2026-04-25 by task.0374 (catalog SSoT). Scope: candidate-a + preview only; production stays whole-slot until release.yml current-sha semantics are designed (filed as task.0375 follow-up). Cutover refactors 2 AppSets from 1 git generator → 4 per-node git generators each, and cuts candidate-flight.yml + flight-preview.yml + (preview half of) promote-and-deploy.yml to strategy.matrix fan-out with fail-fast:false."
outcome: |
  - All 3 ApplicationSets refactored: `infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml` each goes from 1 git generator → 4 per-node git generators reading `deploy/<env>-<node>` and `files: [infra/catalog/<node>.yaml]`. `source.targetRevision` templates from `{{<env>_branch}}` (fields declared in task.0320).
  - `candidate-flight.yml` / `flight-preview.yml` / `promote-and-deploy.yml` all fan out via `strategy.matrix` with `fail-fast: false` — one job per affected node, each scoped to its own per-env branch + per-node Argo Application.
  - Affected-node list comes from `turbo ls --affected --filter=...[$BASE]` (candidate-a: vs origin/main; preview/prod: vs the previous promoted SHA per env).
  - Each matrix cell pushes to `deploy/<env>-<node>` and waits on `<env>-<node>` Argo Application only. Sibling node failure cannot fail this cell.
  - `concurrency: { group: flight-${{ matrix.env }}-${{ matrix.node }}, cancel-in-progress: false }` prevents same-branch racing across workflow types.
  - `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh` deleted if no remaining callers.
  - `candidate-flight-infra.yml` gains a best-effort pre-check querying in-progress flight runs (v0 per GR-5).
  - `.claude/skills/pr-coordinator-v0/SKILL.md` rewritten: drops lease-acquire steps, confirms Turbo-affected nodes, reads per-node branch heads in the Live Build Matrix.
  - `docs/spec/ci-cd.md` updated with per-node-branch model + Kargo-alignment note (task.0320 already added the two-part prose; task.0372 tightens it once the cutover is live).
  - Preserves invariants from task.0320 design review GR-1..GR-6. Adds preserveResourcesOnDeletion: true to all 3 AppSets as transition belt-and-suspenders.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
branch: feat/task.0372-matrix-cutover
pr:
reviewer:
revision: 2
deploy_verified: false
created: 2026-04-24
updated: 2026-04-25
labels: [cicd, deployment]
external_refs:
---

# task.0372 — Per-node matrix cutover

## Freeze + scope reduction (2026-04-25)

This task is **frozen** pending two upstream changes flagged in the design-prep review:

1. **task.0374 lands first.** `infra/catalog/*.yaml` becomes the single source of truth for the node list. After that, this task's Layer 1 bootstrap script is a one-liner over `infra/catalog/*.yaml`, and the matrix `include` derives from the same glob. Without it, every per-node list (image-tags.sh, detect-affected.sh, wait-for-argocd.sh, future bootstrap script) re-pays the migration cost.
2. **Scope reduced to candidate-a + preview only.** Production cutover deferred until `release.yml` current-sha semantics are designed. dev2's Gap 3 is correct: `release.yml` reads `deploy/preview` to decide what to promote forward; per-node preview branches break that read. Picking a roll-up branch design without the SSoT in hand is premature. **Production cutover filed as task.0375.**

The design body below still describes the eventual 3-env shape; the **PR that ships from this task** is the 2-env subset (candidate-a + preview). All "for each env" language below should be read as `env ∈ {candidate-a, preview}` until task.0375 lifts the constraint.

### dev2 gap-2 (preview lease aggregation) — inline policy

Today's `flight-preview.yml` + `promote-and-deploy.yml` chain treats the preview lease (`deploy/preview/.promote-state/lease.json` / lock-preview-on-success / unlock-preview-on-failure) as a single workflow-level decision. With the matrix, N cells can land different verdicts.

**Policy (decided): any matrix cell red → preview stays unlocked. All cells green → lock.** Implementation: a final `aggregate-lease` job with `needs: [matrix-cells]` and `if: always()` that:

- runs `unlock-preview` if `failure() || cancelled() || any(needs.*.result == 'failure')`,
- runs `lock-preview` if `success() && all(needs.*.result == 'success')`,
- writes the same `preview-flight-outcome` artifact (`dispatched | queued | failed`) consumed today by `promote-preview-digest-seed.yml` (task.0349 contract — must not break).

Documented here so the PR cannot ship a per-cell lock/unlock pattern by accident.

### dev2 gap-3 (release.yml current-sha post-cutover) — scope decision

`release.yml` today reads `deploy/preview/.promote-state/current-sha` to know "what's promotable to production". After per-node preview branches, no single SHA represents "all preview is green". Two valid responses:

- **(a) Keep `deploy/preview` alive as a roll-up branch.** Final `aggregate` job in `flight-preview.yml` (or its successor) commits `current-sha` + base/catalog rollup to `deploy/preview` only when **all** matrix cells passed. Argo no longer reconciles from this branch (the per-node branches do). It exists purely as the release-cut anchor.
- **(b) Defer prod cutover.** Keep `deploy/preview` driving production via `release.yml` for now (whole-slot model), per-node only for candidate-a + preview reads.

**Decided: (b).** Production stays on the whole-slot model. `release.yml` continues to read `deploy/preview/.promote-state/current-sha`. The matrix cells in `flight-preview.yml` push **both** their per-node branch (`deploy/preview-<node>`) **and** the preview AppSet still reads from `deploy/preview` whole-slot until task.0375. After all cells succeed, an `aggregate-preview` job fast-forwards `deploy/preview` to a roll-up commit so `release.yml`'s read stays honest. **The 2 ApplicationSets in scope for this task are `candidate-a-applicationset.yaml` only.** `preview-applicationset.yaml` keeps tracking `deploy/preview` until task.0375. Re-read the cutover layers below with this in mind: layer 2 refactors **one** AppSet (candidate-a), not two.

(This trims the cutover by ~50%. Cleaner, less amplified risk.)

### Open gaps (from dev2 review — not blockers, listed for next reviewer)

- **Gap 1 — `detect-affected` BASE selection per env.** candidate-flight uses `origin/main`. flight-preview's BASE for "what changed since last preview" is the previous preview SHA; promote-and-deploy similarly. Existing `detect-affected.sh` honors `TURBO_SCM_BASE`; callers set it. Risk: misset BASE = empty matrix = silent skip. Mitigation in the PR: log effective BASE/HEAD per workflow, fail loud on empty matrix unless explicitly opted-in.
- **Gap 4 — `preview-flight-outcome` artifact aggregation.** task.0349's `promote-preview-digest-seed.yml` consumes a single artifact per Flight Preview run. Matrix cells produce N. Resolution: the `aggregate-preview` job above writes the single outcome artifact based on the all-green policy from gap-2. Listed here so the implementer sees the contract from both ends.
- **Gap 5 — candidate-flight slot-release / commit status reporting.** Today's release-slot job emits one commit-status check per PR head SHA. Matrix cells could each emit, racing on the same head SHA. Resolution: keep one final `report-status` job at the end of the matrix, similar to the gap-2 aggregator. Don't fan out status reporting.

## Context

Split from task.0320 to keep that task at one-PR scope. Task.0320 lands the substrate (per-node branches + per-env AppSet refactor + catalog fields) uniformly across candidate-a / preview / production. This task lands the workflow cutover — also uniformly across all three.

Full design + design-review history live in `task.0320.per-node-candidate-flighting.md`. This task inherits those invariants and guardrails verbatim:

- Design: task.0320 `## Design` section (branch-head-as-lease, matrix-with-fail-fast, Turbo-affected, no new services/CRDs/controllers).
- Guardrails: GR-2 (dogfood ordering), GR-3 (concurrency group), GR-4 (PR #1043 deletion tail landed first — eliminates hook failure class), GR-5 (best-effort infra pre-check → follow-up).

## Requirements

See task.0320 `### Files` + `### Implementation Order` → PR 2 (unified 3-env variant).

## Dependencies

- **Hard-blocked on**: task.0320 merged + the 12 per-env per-node deploy branches pushed (otherwise the matrix cells have nothing to push to).
- **Soft-blocked on**: PR #1043 merged (task.0371 step 1 — kills Argo PreSync hook Jobs globally, removes the stuck-hook failure class at the source).

## Workflows Affected

| Workflow                     | Fan-out shape                                                         |
| ---------------------------- | --------------------------------------------------------------------- |
| `candidate-flight.yml`       | Matrix over Turbo-affected nodes vs `origin/main`                     |
| `flight-preview.yml`         | Matrix over Turbo-affected nodes vs previous preview SHA              |
| `promote-and-deploy.yml`     | Matrix over Turbo-affected nodes vs previous production SHA           |
| `candidate-flight-infra.yml` | Unchanged (still whole-slot); gains pre-check for in-progress flights |

Each matrix cell pushes to the matching `deploy/<env>-<node>` branch and waits on the matching Argo Application.

## Dogfood Ordering (GR-2)

This PR **must** ship under the pre-cutover whole-slot model:

1. task.0320 merges (whole-slot flight model unchanged — substrate only).
2. 12 per-env per-node branches pushed post-merge (automation script or manual).
3. THIS PR flights via the **existing whole-slot workflow** to validate its own diff.
4. Merge THIS PR.
5. The first PR merged _after_ this one is the first flight of the new lane model.

Do not create a bootstrap workflow to flight this PR on its own new model.

## Validation

- (a) Flight a PR touching only poly on candidate-a → only `deploy/candidate-a-poly` advances; sibling branches unchanged.
- (b) Flight a PR with an intentionally broken resy on candidate-a → resy matrix cell red, operator/poly/scheduler-worker cells green; their per-node candidate-a branches advance.
- (c) Merge to main triggering preview promotion with one affected node → only that node's preview matrix cell runs; other nodes' preview branches untouched.
- (d) Production promotion for one node via dispatch → matrix cell runs for that node only.
- (e) Concurrent flights on disjoint nodes → both complete, no cross-interference.
- (f) Concurrent flights on the same node → second gets non-fast-forward push OR waits on concurrency group (GR-3), eventually succeeds or fails cleanly.

## Follow-ups Out of Scope

- **GR-5**: Harden `candidate-flight-infra.yml` pre-check from best-effort `gh run list` to a proper lease before adding a 5th node.
- **Catalog-as-SSOT**: Separate task (see proj.cicd-services-gitops "Pareto Path Step 3") — make `infra/catalog/*.yaml` the single declaration that drives build scripts, wait-for-argocd APPS, compose, so adding a node collapses from 10 steps to 3.

## Design

### Outcome

A PR touching only one node promotes that node to candidate-a / preview / production without needing siblings to be green. Each `(env × node)` pair has its own deploy branch, its own Argo Application (still rendered by one ApplicationSet), and its own matrix cell. Failure isolation is structural — separate GHA jobs, not script-level filtering. The handoff's `task.0320` Kargo-primitives frame becomes operationally live.

### Approach

**Cutover is one PR, three concentric layers, all atomic at merge.**

#### Layer 1 — Push the 12 per-node deploy branches (pre-PR ops)

Read the SHA of each whole-slot deploy branch and push 4 sibling branches at the same SHA. Behaviour-equivalent at the moment of creation.

```
deploy/candidate-a-{operator,poly,resy,scheduler-worker}     ← deploy/candidate-a tip
deploy/preview-{operator,poly,resy,scheduler-worker}         ← deploy/preview tip
deploy/production-{operator,poly,resy,scheduler-worker}      ← deploy/production tip
```

One-shot script `scripts/ops/bootstrap-per-node-deploy-branches.sh` (idempotent: skip-if-exists). Run **before** opening this PR; verified via `git ls-remote origin 'refs/heads/deploy/*-*'`.

#### Layer 2 — Refactor the 3 ApplicationSets (1 generator → 4 generators each)

Per GR-1: Argo's git generator does **not** template `revision` from a per-file field. Each AppSet keeps **one** `cogni-<env>` resource but expands its `generators:` list from one entry to four:

```yaml
spec:
  generators:
    - git: { repoURL: …, revision: deploy/candidate-a-operator,         files: [{ path: infra/catalog/operator.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-poly,             files: [{ path: infra/catalog/poly.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-resy,             files: [{ path: infra/catalog/resy.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-scheduler-worker, files: [{ path: infra/catalog/scheduler-worker.yaml }] }
  template:
    metadata: { name: "candidate-a-{{name}}", … }
    spec:
      source:
        repoURL: …
        targetRevision: "{{candidate_a_branch}}"   # comes from catalog file
        path: "infra/k8s/overlays/candidate-a/{{name}}"
      …
```

Identical refactor for `preview-applicationset.yaml` and `production-applicationset.yaml` (using `preview_branch` / `production_branch` catalog fields). The `*-{{name}}` Application names stay the same → Argo reconciles in place; no Application teardown. `preserveResourcesOnDeletion: true` added as belt-and-suspenders.

#### Layer 3 — Refactor the 3 flight workflows to matrix shape

Each workflow gains a small `decide` job that emits a `targets_json` array of affected nodes; the existing job(s) become matrix-fanned-out cells.

**A. `candidate-flight.yml`** (560 lines → ~620 with matrix; ~80 lines deleted from lease handling)

```yaml
jobs:
  decide:
    runs-on: ubuntu-latest
    outputs:
      targets_json: ${{ steps.detect.outputs.targets_json }}
      has_targets: ${{ steps.detect.outputs.has_targets }}
    steps:
      - uses: actions/checkout@…
      - id: detect
        env:
          TURBO_SCM_BASE: origin/main
          TURBO_SCM_HEAD: ${{ inputs.head_sha }}
        run: bash scripts/ci/detect-affected.sh

  flight:
    needs: decide
    if: needs.decide.outputs.has_targets == 'true'
    strategy:
      fail-fast: false
      matrix:
        node: ${{ fromJson(needs.decide.outputs.targets_json) }}
    concurrency:
      group: flight-candidate-a-${{ matrix.node }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    environment: candidate-a
    steps:
      # … existing flight steps, but scoped to matrix.node:
      # - clone deploy/candidate-a-${{ matrix.node }} as deploy-branch
      # - rsync only infra/k8s/overlays/candidate-a/${{ matrix.node }}/ + base/ + catalog/
      # - resolve PR digest for ONLY this target via image_tag_for_target
      # - promote-k8s-image.sh --no-commit --env candidate-a --app ${{ matrix.node }}
      # - snapshot/restore (task.0373) reduces to no-op for single-target — drop, OR keep
      #   for cold-start safety. KEEP — it costs nothing on single-target trees.
      # - push to deploy/candidate-a-${{ matrix.node }}
      # - wait-for-argocd.sh APPS=candidate-a-${{ matrix.node }}
      # - smoke + verify-buildsha for ${{ matrix.node }} only
```

`acquire-candidate-slot` / `release-candidate-slot` / `report-no-acquire-failure` jobs **deleted**. The branch ref is the lease (GR-3 concurrency group is the belt).

**B. `flight-preview.yml`** (277 lines → ~320)

The retag loop (lines 190-203) **already iterates `ALL_TARGETS` and skips non-`RESOLVED_TARGETS`** — no shape change there. The fan-out is downstream: instead of one `flight-preview.sh` call dispatching `promote-and-deploy.yml` whole-env, the workflow loops the affected target list and dispatches `promote-and-deploy.yml` once per affected node with a `nodes` input naming that node only. The `preview-flight-outcome` artifact still records `dispatched | queued` (consumed by `promote-preview-digest-seed.yml` — unchanged contract).

Concurrency: `group: flight-preview-${{ matrix.node }}` per cell.

**C. `promote-and-deploy.yml`** (930 lines → ~1000) — the big one

Adds `workflow_call.inputs.nodes` (CSV) alongside existing `workflow_dispatch.inputs`. Adds a top `decide` job. Existing `promote-k8s` / `verify-deploy` / `verify` / `e2e` / `lock-preview-on-success` / `unlock-preview-on-failure` jobs become matrix-fanned-out over `nodes`. Each cell scopes to one `deploy/<env>-<node>` branch and one `<env>-<node>` Argo Application.

Concurrency: `group: flight-${{ inputs.env }}-${{ matrix.node }}` per cell.

**D. `candidate-flight-infra.yml`** (156 lines → ~170; GR-5 best-effort)

New first step queries in-progress candidate-flight runs:

```yaml
- name: Pre-check no candidate-flight in progress (best-effort, GR-5)
  env: { GH_TOKEN: ${{ github.token }} }
  run: |
    in_progress=$(gh run list --workflow="Candidate Flight" --status=in_progress --json databaseId --jq 'length')
    if [ "$in_progress" != "0" ]; then
      echo "::warning::${in_progress} candidate-flight run(s) in progress — infra changes may interleave with app promotions"
    fi
```

Best-effort warning, not a hard gate — explicitly per GR-5 deferred to follow-up.

#### Layer 4 — Cleanup

- Delete `infra/control/candidate-lease.json` (no remaining readers post-cutover).
- Delete `scripts/ci/acquire-candidate-slot.sh` + `scripts/ci/release-candidate-slot.sh`.
- Update `scripts/ci/AGENTS.md` to remove their entries.
- `.claude/skills/pr-coordinator-v0/SKILL.md` rewrite — drop lease-acquire prose; describe matrix output ("Live Build Matrix" reads `deploy/<env>-<node>` heads).
- `docs/spec/ci-cd.md` — replace whole-slot lease prose with `BRANCH_HEAD_IS_LEASE` axiom + Kargo-alignment note (task.0320 added the prose stub; tighten now that cutover is live).
- Old `deploy/candidate-a` / `deploy/preview` / `deploy/production` whole-slot branches — **leave in place, mark stale**. Don't delete in this PR. Once a few weeks pass with no consumers, a follow-up sweep deletes them. Argo's prior-known-good rev is still on these branches if we need to rollback.

### Reuses

- `scripts/ci/detect-affected.sh` (existing — emits `targets_json` matrix-ready).
- ApplicationSet's generator-list mechanism (extending one to four; already supported by Argo).
- GHA `strategy.matrix` + `fail-fast: false` + `concurrency` primitives.
- `wait-for-argocd.sh` `APPS=` filter (already supports per-app scope).
- `smoke-candidate.sh` `NODES_FILTER` (already supports per-app scope).
- `promote-k8s-image.sh --no-commit` (single-target writer; runs once per matrix cell).
- task.0373's snapshot/restore step — keep in candidate-flight matrix cells, no-op on single-target trees but cheap insurance for cold-start.

### Rejected

- **Templating `generator.git.revision` from `{{candidate_a_branch}}`** (GR-1). Argo applies one `revision` per generator across all `files:` matched. Cannot template revision per-file. Four-generator pattern is the only working shape.
- **Splitting each AppSet into 4 separate ApplicationSet resources** — violates `ONE_APPSET_SOURCE_OF_TRUTH` (task.0320). Per-env routing belongs inside one AppSet.
- **Templating `targetRevision` from a workflow-injected param instead of catalog field** — couples AppSet definition to a workflow rendering step. Catalog field is the simpler frame and already declared by task.0320.
- **Bootstrap workflow to flight task.0372 on its own new model** (GR-2 chicken-and-egg). This PR flights on the existing whole-slot model. The first post-merge PR is the first matrix-flight.
- **Per-node lease JSON files** — task.0320 already rejected. Branch ref + GHA concurrency group is the lease.
- **Hand-rolling affected-detection** — `detect-affected.sh` already exists and is CI-tested.
- **Dropping snapshot/restore from candidate-flight matrix cells** — single-target trees make it a near-no-op, but at no cost. Keep for cold-start invariance and to preserve task.0373's invariants verbatim.
- **Atomic deletion of old whole-slot deploy branches in this PR** — leave for a follow-up sweep; preserves rollback path for a few weeks.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] LANE_ISOLATION: Each affected node runs in its own GHA matrix job with `fail-fast: false`. A red sibling cell does not short-circuit other cells. Verified via Validation case (b): intentionally broken resy on a multi-node PR. (spec: ci-cd)
- [ ] BRANCH_HEAD_IS_LEASE: No `infra/control/candidate-lease.json`, no acquire/release scripts. Same-node concurrency is resolved by GHA `concurrency` group + `git push` non-fast-forward. (spec: ci-cd)
- [ ] CONCURRENCY_GROUP_KEYED_BY_ENV_AND_NODE: Every matrix-fanned cell carries `concurrency: { group: flight-<env>-${{ matrix.node }}, cancel-in-progress: false }`. candidate-a-poly, preview-poly, production-poly each have independent groups. (spec: ci-cd)
- [ ] AFFECTED_FROM_DETECT_AFFECTED_SH: Matrix include list is computed by `scripts/ci/detect-affected.sh`. No hand-rolled path-diff in any of the 3 workflows. (spec: ci-cd)
- [ ] ONE_APPSET_PER_ENV: `infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml` each remain **one** ApplicationSet resource. Per-node routing happens via 4 git-generators inside it. (spec: architecture)
- [ ] APPSET_PRESERVE_ON_TRANSITION: All 3 AppSets carry `spec.preserveResourcesOnDeletion: true` post-cutover. Belt-and-suspenders for the 1→4 generator transition. (spec: ci-cd)
- [ ] APPLICATION_NAMES_UNCHANGED: Pre- and post-cutover Argo Application names are byte-identical (`<env>-<node>` for all 4 nodes per env). The AppSet refactor is generator-shape-only — Argo reconciles in place, no Application teardown. (spec: ci-cd)
- [ ] DOGFOOD_ORDERING: This PR flights via the **existing** whole-slot `candidate-flight.yml` (the file in main pre-merge), not on its own diff. The first PR merged after this one is the first matrix flight. (spec: ci-cd)
- [ ] PER_NODE_BRANCH_PUSH_BEFORE_MERGE: All 12 `deploy/<env>-<node>` branches exist on origin before this PR merges. Verified via `git ls-remote`. (spec: ci-cd)
- [ ] NO_NEW_CONTROLLERS: No new CRDs, no new in-cluster controllers, no new long-running services. (spec: architecture)
- [ ] BUILD_ONCE_PROMOTE: pr-build still builds `pr-{N}-{sha}-*` once. Per-node matrix cells only rewrite their one node's overlay digest. (spec: ci-cd)
- [ ] SIMPLE_SOLUTION: Reuses existing detect-affected.sh, AppSet generators, `strategy.matrix`, `concurrency`, `wait-for-argocd.sh`, `smoke-candidate.sh`, `promote-k8s-image.sh`. Net new code is workflow plumbing + ~12 catalog-field-consumers + one bootstrap-branches script. No new packages, no new long-running services.
- [ ] ARCHITECTURE_ALIGNMENT: Branch-head-as-lease + matrix-with-fail-fast = Kargo primitives implemented on existing GHA + Argo substrate. Future Kargo install is rename + install, not rewrite. (spec: ci-cd)

### Files

<!-- High-level scope -->

**Create**

- `scripts/ops/bootstrap-per-node-deploy-branches.sh` — one-shot, idempotent. For each `(env, node)` pair, push `deploy/<env>-<node>` from `deploy/<env>` HEAD if not already present. Run **before** opening this PR.

**Modify (AppSets — 3 files)**

- `infra/k8s/argocd/candidate-a-applicationset.yaml` — 1 git generator → 4. `targetRevision: "{{candidate_a_branch}}"`. Add `preserveResourcesOnDeletion: true`.
- `infra/k8s/argocd/preview-applicationset.yaml` — same pattern with `preview_branch`.
- `infra/k8s/argocd/production-applicationset.yaml` — same pattern with `production_branch`.

**Modify (workflows — 4 files)**

- `.github/workflows/candidate-flight.yml` — add `decide` job; convert `flight` + `verify-candidate` + `release-slot` into matrix-fanned cells (most of the existing flight job collapses into the matrix cell since per-cell scope = one node). Delete acquire/release-slot job logic. Concurrency group `flight-candidate-a-${{ matrix.node }}`. Net: ~80 lines deleted from lease handling, ~140 added for matrix shape.
- `.github/workflows/flight-preview.yml` — add `decide` job that re-uses the existing `RESOLVED_TARGETS` output (already affected-only at retag); fan out `Flight to preview` step into matrix cells; per-cell artifact upload keyed by node.
- `.github/workflows/promote-and-deploy.yml` — add `decide` job; matrix-fan all post-decide jobs over `nodes`; per-cell `targetRevision: deploy/${OVERLAY_ENV}-${{ matrix.node }}`; per-cell `wait-for-argocd APPS=${OVERLAY_ENV}-${{ matrix.node }}`. ~70 lines added per fan-out point; multiple sub-jobs touched.
- `.github/workflows/candidate-flight-infra.yml` — add GR-5 best-effort pre-check step.

**Delete**

- `infra/control/candidate-lease.json` — no readers post-cutover.
- `scripts/ci/acquire-candidate-slot.sh` — no callers.
- `scripts/ci/release-candidate-slot.sh` — no callers.

**Modify (docs / skills)**

- `docs/spec/ci-cd.md` — replace whole-slot prose with `BRANCH_HEAD_IS_LEASE` axiom + `LANE_ISOLATION` axiom. Tighten the Kargo-alignment note that task.0320 stubbed.
- `scripts/ci/AGENTS.md` — remove acquire/release-slot from the script list.
- `.claude/skills/pr-coordinator-v0/SKILL.md` — drop lease prose, describe matrix output, document Live Build Matrix reading per-node branches.

**Test**

- Validation cases (a)–(f) from the original task body — no automated test harness; validated against live PRs per the validation block.

### Bootstrapping (PR mechanics)

1. **Before opening PR.** Run `scripts/ops/bootstrap-per-node-deploy-branches.sh` against the live remote. Verify all 12 branches exist (`git ls-remote origin 'refs/heads/deploy/*-*'` — expect 12 lines). Branches are dormant: no AppSet reads them yet, no workflow writes them yet.
2. **Open the PR** on `feat/task.0372-per-node-matrix`. CI runs on the existing whole-slot model (the workflows being refactored only matter at merge time when the AppSets flip).
3. **Flight via existing whole-slot `candidate-flight.yml`.** GR-2: this PR's own diff is validated through the lever it's about to retire. The whole-slot flight will write to `deploy/candidate-a` once more — that's expected and harmless; the new branches are still ahead of nothing yet.
4. **Merge.** AppSets re-render; Argo sees the same 4 Applications per env, now pointing at per-node branches. Initially each per-node branch SHA matches its parent whole-slot branch SHA, so reconcile is a no-op.
5. **First post-merge PR is the first real matrix flight.**

### Risks (priced in)

- **Argo reconcile glitch on AppSet 1→4 generator transition.** Application names stay identical, so in theory Argo updates each Application's `source.targetRevision` in place. `preserveResourcesOnDeletion: true` prevents accidental k8s teardown if Argo decides to recreate. Watch for stuck-syncing Applications post-merge; rollback is `git revert` of the AppSet diff (deploy branches stay).
- **promote-and-deploy.yml is 930 lines.** Highest implementation risk. Recommend implementing in this order: candidate-flight (smallest) → flight-preview (retag already affected-only) → promote-and-deploy (largest). Test each stage with a dry-run-equivalent (workflow_dispatch on a no-op PR) before committing the next.
- **Branch-protection rules on `deploy/*`.** If `deploy/*` glob is protected against new branches by an org rule, bootstrap step will fail. Pre-PR check: try pushing one branch (`deploy/candidate-a-operator`) first; if it fails, address the rule before continuing.
- **`detect-affected.sh` BASE selection for preview/prod**. candidate-flight uses `origin/main` as base. flight-preview's base should be the previous preview SHA (read from `deploy/preview/.promote-state/current-sha`). promote-and-deploy's base for preview-forward is the previous preview SHA; for production it's the previous production SHA. The decide job sets `TURBO_SCM_BASE` per workflow; existing `detect-affected.sh` honors it without modification.
- **Old whole-slot `deploy/candidate-a` etc. continue to receive writes from any in-flight runs that started pre-merge.** Acceptable: those runs complete on the old paths; the next dispatch picks up the new matrix workflow.

## PR / Links

- Handoff: [handoff](../handoffs/task.0372.handoff.md)
- Substrate: [task.0320](task.0320.per-node-candidate-flighting.md), [task.0374 PR #1053](https://github.com/Cogni-DAO/node-template/pull/1053)
- Reuses: [task.0373 PR #1047](https://github.com/Cogni-DAO/node-template/pull/1047) snapshot/restore
- Production follow-up: [task.0375](task.0375.production-matrix-cutover.md)
