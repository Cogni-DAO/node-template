---
id: task.0314
type: task
title: "Decouple infra flighting from app flighting — two independent levers"
status: needs_implement
priority: 0
rank: 1
estimate: 5
summary: "`candidate-flight.yml` always runs `deploy-infra.sh` alongside digest promotion, coupling VM compose re-sync to every app flight. This violates ci-cd.md's `Argo owns reconciliation` axiom and caused PR #879 to fail twice because its stale compose file rsynced to the VM. Split into two levers an agent can invoke independently; same split applies to the preview/production promotion chain."
outcome: |
  Two independent, agent-dispatchable workflows:
    - `candidate-flight-app.yml`  — digest → deploy/candidate-a → Argo sync pods → verify
    - `candidate-flight-infra.yml` — rsync infra/compose/runtime → VM → compose up → verify
  Same separation applied to promote-and-deploy.yml (preview/prod).
  Merge-to-main preview promotion still triggers both where appropriate (infra iff infra/ changed, app always).
  Shell scripts own the logic; workflows are thin dispatchers. No workflow_run chaining.
  App flights no longer regress on stale infra config because infra path no longer reads from PR checkout.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
supersedes: task.0281
blocks:
  - proj.cicd-services-gitops blocker #18 (PAT-dispatched workflow chain)
  - proj.cicd-services-gitops blocker #19 (deploy-infra unconditional)
branch: task/0314-decouple-infra-app-flighting
created: 2026-04-16
updated: 2026-04-16
labels: [ci-cd, deployment, spec-alignment, p0]
---

# task.0314 — Decouple infra flighting from app flighting

## Problem

`candidate-flight.yml` runs **both** of these in one monolithic job:

1. **App** — resolve PR digests → promote into `deploy/candidate-a` overlay → push → reconcile Argo → Argo syncs pods
2. **Infra** — rsync `$REPO_ROOT/infra/compose/runtime/` from the PR's checkout → SSH VM → `compose up -d` → wait healthchecks

Two independent regressions result:

**R1. Every app-only flight pays the infra cost.** ~5–8 min per flight, unconditionally. Violates ci-cd.md axiom: *Argo owns reconciliation. CI writes desired state to git; Argo syncs from git.*

**R2. The infra rsync source is the PR's own checkout.** App PRs branched before an infra change ship stale compose config to the VM, even though they didn't touch infra. PR #879 (poly agent API — app-only) failed twice on this: its `docker-compose.yml` predated #880's litellm GHCR fix, and deploy-infra rsynced the stale file. Resolution required rebasing #879 on main. That rebase requirement is not documented anywhere and is a silent foot-gun.

Same coupling lives in `promote-and-deploy.yml` (post-merge preview + production path) — worse blast radius, same shape.

## Target Architecture

```
┌─ APP LEVER ──────────────────────────────────────────┐
│  candidate-flight-app.yml                             │
│    ↓ inputs: pr_number                                │
│    scripts/ci/flight-app.sh                           │
│    ↓ resolve digests → promote overlay → push         │
│    deploy/candidate-a  →  Argo CD  →  pods roll       │
│    ↓ verify: wait-for-argocd + /readyz SHA check      │
└───────────────────────────────────────────────────────┘

┌─ INFRA LEVER ────────────────────────────────────────┐
│  candidate-flight-infra.yml                           │
│    ↓ inputs: ref (default: main)                      │
│    scripts/ci/flight-infra.sh                         │
│    ↓ rsync infra/compose/runtime/ @ ref → VM          │
│    ↓ SSH VM → compose up -d → healthcheck             │
└───────────────────────────────────────────────────────┘
```

Both independently invokable by an agent. Same pair exists for preview (`promote-app.yml` + `promote-infra.yml`) and production. No workflow_run chaining; every workflow is human- or agent-triggerable.

## Principles

- **Shell scripts own the logic.** Workflows are thin dispatchers: checkout, secret plumbing, invoke script, report status.
- **No workflow_run chaining.** Every workflow is directly dispatchable; composition lives in scripts or in an agent's triage loop.
- **Infra reads from `main` (or explicit ref), not from PR checkout.** Eliminates R2.
- **Locking is per-lane.** App lever locks the digest slot (existing `infra/control/candidate-lease.json`). Infra lever locks the VM (new `infra/control/infra-lease-{env}.json` or flock on VM). Locks never block each other.

## V0 Scope

Land the candidate-a split as one coherent PR:

1. Extract current `deploy-infra.sh` behavior into `scripts/ci/flight-infra.sh` (parameterized by `env`: `candidate-a` | `preview` | `production`, `ref`: git ref to rsync from — default `main`).
2. Extract current digest promotion behavior from `candidate-flight.yml` into `scripts/ci/flight-app.sh` (parameterized by `pr_number`, `env`).
3. Two new workflows:
   - `candidate-flight-app.yml` (replaces `candidate-flight.yml`)
   - `candidate-flight-infra.yml` (new)
4. Retire the combined `candidate-flight.yml`.
5. **Preview/prod promotion-on-merge must still work.** Options covered in design:
   - (a) `promote-and-deploy.yml` internally invokes both scripts sequentially (simple, no chaining).
   - (b) Split `promote-and-deploy.yml` into `promote-app.yml` + `promote-infra.yml`, both triggered by `push: deploy/preview`.
   - Pick (a) for v0 — single merge trigger, two sequential script calls, no workflow chaining. Split later if needed.

## Out of Scope (v0)

- Auto-detection of "infra changed → run infra lever." Agent decides for now; a skip-gate can ride later.
- Infra lever taking a per-PR ref. v0: `main` only (eliminates R2 for candidate-a path too).
- Sandbox-openclaw-specific mount changes (covered elsewhere).

## Supersedes

- **task.0281** — written 2026-04-04 with the inverted goal ("add compose deploy to canary"). The spec (ci-cd.md, 2026-02-05, verified 2026-04-14) has since clarified that Argo, not SSH, owns reconciliation. task.0281's Phase 1 ("canary infra deploy parity") is obsolete. Close task.0281 on merge of this task's PR.

## Related

- **proj.cicd-services-gitops blocker #18** — PAT-dispatched workflow_run chain. Closed by this task's "no workflow_run chaining" principle.
- **proj.cicd-services-gitops blocker #19** — deploy-infra unconditional. Closed by this task.
- **docs/spec/ci-cd.md** — this task realigns workflows to the spec's lane model.

## Acceptance

- [ ] Agent can run `gh workflow run candidate-flight-app.yml -f pr_number=N` and it flies ONLY the app pod changes. No VM SSH. Completes in <2 min when digests already exist in GHCR.
- [ ] Agent can run `gh workflow run candidate-flight-infra.yml` and it rsyncs+redeploys compose from `main`. No app promotion.
- [ ] PR #879's failure mode (app PR branched before infra change) is impossible on the new levers — app flight never touches compose files.
- [ ] Merge to main → `promote-and-deploy.yml` still deploys both app and infra to preview.
- [ ] `scripts/ci/flight-app.sh` and `scripts/ci/flight-infra.sh` runnable locally for dry-runs.
- [ ] `docs/spec/ci-cd.md` updated if the workflow inventory changes names.
- [ ] task.0281 closed with supersede note.

## Design

### Outcome

An agent (or human) can flight an app-only PR to candidate-a in <2 min without touching the VM, and separately reconcile infra compose on the VM without touching any PR digests. Preview/prod promotion-on-merge still redeploys both. Eliminates the class of failure where an app PR ships stale compose config.

### Approach

**Leverage what already exists.** The monolith isn't actually monolithic — `candidate-flight.yml` already composes discrete scripts under `scripts/ci/` (`acquire-candidate-slot.sh`, `promote-k8s-image.sh`, `deploy-infra.sh`, `wait-for-argocd.sh`, `smoke-candidate.sh`, `release-candidate-slot.sh`). The only real refactor is (a) moving workflow-level step sequencing into two umbrella scripts, (b) making `deploy-infra.sh`'s rsync source parameterizable, (c) splitting the workflow file into two. **No new logic, no new OSS.**

**Rejected**: (1) Moving to reusable workflows with `workflow_call` — adds GHA chaining coupling, fights the "shell owns logic" principle. (2) Rewriting in TypeScript/Dagger — massive scope, blocked on task.0260 project decisions. (3) Keeping one workflow with conditional steps — leaves the "app flight pays infra cost" regression intact and still requires PR-checkout rsync.

### Architecture

```
┌─ scripts/ci/flight-app.sh ─────────────────────────┐
│  args: --pr N --env candidate-a|preview|production │
│  reads:  GHCR pr-N-SHA-* digests                   │
│  writes: deploy/{env} overlay commit               │
│  emits:  deploy_branch_sha, head_sha               │
│  calls:  acquire-candidate-slot (env==candidate-*) │
│          resolve-pr-build-images                   │
│          promote-k8s-image                         │
│          push to deploy/{env}                      │
│          reconcile-argocd-appset (via ssh)         │
│          wait-for-argocd                           │
│          verify-deployment (readyz SHA match)      │
│          release-candidate-slot (env==candidate-*) │
└────────────────────────────────────────────────────┘

┌─ scripts/ci/flight-infra.sh ───────────────────────┐
│  args: --env candidate-a|preview|production        │
│        --ref <git-ref> (default: main)             │
│  reads:  infra/compose/runtime/ @ ref              │
│  writes: VM:/opt/cogni-template-runtime/           │
│  emits:  (none — smoke-checked in place)           │
│  calls:  checkout ref into temp dir                │
│          rsync infra/compose/runtime/ → VM         │
│          scp + ssh deploy-infra-remote.sh          │
│          compose up healthchecks                   │
│          infra-smoke (litellm /ready, pg_isready)  │
└────────────────────────────────────────────────────┘
```

Both scripts are **independently runnable locally** (with the right secrets) and in GHA. Workflows are thin:

```yaml
# candidate-flight-app.yml        (replaces candidate-flight.yml)
on: workflow_dispatch: { inputs: { pr_number } }
steps:
  - checkout
  - secrets → env
  - bash scripts/ci/flight-app.sh --pr "${{ inputs.pr_number }}" --env candidate-a

# candidate-flight-infra.yml      (new)
on: workflow_dispatch: { inputs: { ref: { default: main } } }
steps:
  - checkout (ref: main, to get the script itself)
  - secrets → env
  - bash scripts/ci/flight-infra.sh --env candidate-a --ref "${{ inputs.ref || 'main' }}"
```

### How preview/prod promotion-on-merge still runs both

`flight-preview.yml` + `promote-and-deploy.yml` already exist. V0 plan: **keep `promote-and-deploy.yml` as a single workflow, but have it call the two new scripts sequentially inside one job.** No workflow_run chaining, no new dispatch links:

```yaml
# promote-and-deploy.yml  (rewired internals, unchanged external contract)
jobs:
  promote:
    steps:
      - checkout main
      - bash scripts/ci/flight-app.sh   --source-sha $SHA --env $ENV
      - bash scripts/ci/flight-infra.sh --env $ENV --ref main
      - bash scripts/ci/verify-deployment.sh  # existing
      - bash scripts/ci/smoke-candidate.sh    # existing preview/prod equivalent
      - lock-preview-on-success (existing)
```

This preserves the existing lease + lock-gate behavior from task.0293 (done), and means the merge→preview→release chain continues to work unchanged from the caller's POV.

### Locking model

Two independent locks, by design:

| Lever | Lock | Mechanism | Why |
|---|---|---|---|
| `flight-app.sh candidate-a` | digest slot | existing `infra/control/candidate-lease.json` on `deploy/candidate-a` (atomic commit push) | one PR owns the slot's deployed digest at a time |
| `flight-infra.sh *` | VM compose dir | GHA `concurrency: group: infra-${env}` (cancel-in-progress: false) | prevents overlapping rsync/compose up; VM-level state |
| `promote-and-deploy.yml` | env-level | existing `concurrency: group: promote-deploy-${env}` | unchanged from today |

Locks are orthogonal. A running app flight does NOT block an infra reconcile on the same env, and vice versa — they touch different state (git deploy branch vs VM compose dir). If an agent wants both to run atomically it dispatches app first, waits, then infra.

### Script boundaries — I/O contract

**`scripts/ci/flight-app.sh`**:
- Inputs (env vars from workflow secrets layer): `GITHUB_TOKEN`, `IMAGE_NAME`, `GHCR_DEPLOY_TOKEN`, `GHCR_USERNAME`, SSH key for `reconcile-argocd-appset`, `VM_HOST`.
- Inputs (flags): `--pr N` OR `--source-sha SHA`, `--env {candidate-a|preview|production}`.
- Outputs: exit 0 on success, non-zero on failure. Writes `$GITHUB_OUTPUT` with `deploy_branch_sha`, `head_sha`, `image_tag` if `$GITHUB_OUTPUT` is set.
- Side effects: commits to `deploy/{env}`, reconciles AppSet, waits for Argo.

**`scripts/ci/flight-infra.sh`**:
- Inputs (env vars): all the runtime secrets currently passed through the SSH heredoc in `deploy-infra.sh:944`.
- Inputs (flags): `--env {candidate-a|preview|production}`, `--ref <git-ref>` (default: `main`).
- Outputs: exit 0/non-zero.
- Side effects: `git archive` or `git checkout --worktree` from `--ref` into a temp dir, rsync that temp dir to VM, ssh → `deploy-infra-remote.sh`.

The **only logic change** inside today's `deploy-infra.sh` is replacing `REPO_ROOT="$(git rev-parse --show-toplevel)"` with a parameterized source that resolves to a clean checkout of `--ref`. That single change eliminates R2 (stale PR compose files).

### Migration plan

One PR, atomic:

1. **Extract** — rename `deploy-infra.sh` → `flight-infra.sh`, add `--ref` param, replace `$REPO_ROOT` source with `git worktree add` of `--ref`. Preserve all current secret passthrough.
2. **Extract** — new `flight-app.sh` that inlines the steps currently in `candidate-flight.yml` between "Resolve PR image digests" and "Release candidate slot after success" (about 12 steps, mostly already scripts).
3. **Split workflows** — `candidate-flight.yml` → `candidate-flight-app.yml` + `candidate-flight-infra.yml`. Both thin dispatchers.
4. **Rewire** — `promote-and-deploy.yml` replaces its inline Promote + Deploy-Infra steps with calls to the two new scripts. Keeps existing locks, lease logic, E2E, lock-on-success, unlock-on-failure.
5. **Verify** — manually dispatch `candidate-flight-app.yml -f pr_number=<test-PR>` and confirm no SSH happens. Manually dispatch `candidate-flight-infra.yml` and confirm no digest promotion happens. Dispatch `promote-and-deploy.yml` on a preview promotion and confirm end-to-end parity.
6. **Retire** — delete `candidate-flight.yml` on merge.
7. **Close task.0281** with supersede note + link to this PR.
8. **Update** — `docs/spec/ci-cd.md` workflow inventory (if it enumerates workflow filenames); `proj.cicd-services-gitops` blockers #18 and #19 marked ✅ DONE.

No backwards compat path is needed — `candidate-flight.yml` is agent-triggered, not user-facing, and the only active caller (this skill's `gh workflow run candidate-flight.yml`) updates atomically.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **ARGO_OWNS_RECONCILIATION** — app flight writes deploy-branch state; Argo reconciles the pods. No SSH in the app lever. (spec: ci-cd.md §axioms)
- [ ] **NO_WORKFLOW_RUN_CHAINING** — every new/rewired workflow is directly `workflow_dispatch`-triggerable. No `on: workflow_run`. (spec: ci-cd.md §workflow-design-targets)
- [ ] **SCRIPT_OWNS_LOGIC** — non-trivial step sequencing lives in `scripts/ci/*.sh`. Workflows are secret-plumbing + single script invocation.
- [ ] **INFRA_REF_IS_EXPLICIT** — `flight-infra.sh` rsyncs from a specified git ref (default `main`), NEVER from the workflow's PR checkout. Eliminates R2.
- [ ] **LEVERS_ARE_INDEPENDENT** — app flight MUST work on a VM where `flight-infra.sh` has never run today; infra flight MUST work with no app promotion in the current lease.
- [ ] **MERGE_TO_MAIN_UNCHANGED** — `promote-and-deploy.yml`'s external contract (inputs, lease semantics, lock-gate) is byte-identical before and after; only internal step wiring changes. (spec: ci-cd.md §preview-review-lock, task.0293)
- [ ] **SIMPLE_SOLUTION** — no new OSS, no new runtimes. All existing scripts reused.
- [ ] **ARCHITECTURE_ALIGNMENT** — spec-aligns to ci-cd.md's already-written lane model.

### Files

- Create: `scripts/ci/flight-app.sh` — umbrella script for app lever, ~60 lines, composes existing scripts.
- Create: `scripts/ci/flight-infra.sh` — rename of `deploy-infra.sh` + `--ref` parameter.
- Create: `.github/workflows/candidate-flight-app.yml` — thin dispatcher for app lever.
- Create: `.github/workflows/candidate-flight-infra.yml` — thin dispatcher for infra lever.
- Modify: `.github/workflows/promote-and-deploy.yml` — replace inline promote+deploy-infra with script calls.
- Delete: `.github/workflows/candidate-flight.yml` — replaced by the two new files.
- Delete: `scripts/ci/deploy-infra.sh` — replaced by `flight-infra.sh` (git history preserves; update any stale references in `AGENTS.md` + docs).
- Modify: `work/items/task.0281-canary-cicd-parity-staging-promotion.md` — `status: done` with supersede note pointing at task.0314.
- Modify: `work/projects/proj.cicd-services-gitops.md` — mark blockers #18 and #19 ✅ DONE, add reference to task.0314.
- Modify: `docs/spec/ci-cd.md` — update workflow inventory if it names the files; the axioms need no change (this task spec-aligns to them).
- Test: manual dispatch matrix — `candidate-flight-app` on app-only PR (no SSH in logs), `candidate-flight-infra` standalone (no overlay changes in `deploy/candidate-a`), `promote-and-deploy` on a preview promotion (both run, lock-gate intact).

## Validation

Manual dispatch matrix after the single-PR rollout:

1. **App lever isolation** — `gh workflow run candidate-flight-app.yml -f pr_number=<app-only PR>` completes in <2 min with zero SSH/compose activity in logs. `/readyz` on the affected node returns the PR head SHA.
2. **Infra lever isolation** — `gh workflow run candidate-flight-infra.yml` completes without touching `deploy/candidate-a` (no new commits on that branch); the VM's `/opt/cogni-template-runtime/docker-compose.yml` matches the tip of `main`.
3. **Preview merge parity** — merge a PR to `main`, `flight-preview.yml` dispatches `promote-and-deploy.yml` as before, both levers run sequentially inside one job, lock-gate transitions `unlocked → dispatching → reviewing` fire correctly.
4. **Regression proof** — repeat PR #879's original failure scenario (app PR branched before an infra change on main, not rebased): `candidate-flight-app.yml` succeeds. Pre-refactor this would fail at `deploy-infra`.

## Attribution

- Surfaced by PR #879 flight failure loop on 2026-04-16.
