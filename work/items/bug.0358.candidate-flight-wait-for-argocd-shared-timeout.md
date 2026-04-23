---
id: bug.0358
type: bug
title: "candidate-flight false-red: wait-for-argocd shares one timeout budget across all promoted apps"
status: needs_merge
priority: 1
rank: 1
estimate: 1
created: 2026-04-23
updated: 2026-04-23
summary: "`scripts/ci/wait-for-argocd.sh` budgets `ARGOCD_TIMEOUT` once for the entire promoted-app loop, then checks apps sequentially. Candidate flights that promote all four deployments can spend ~2-3 minutes reconciling operator/poly/resy before `scheduler-worker` is even examined, leaving it only the leftover time for `kubectl rollout status`. Result: the deploy finishes successfully on candidate-a, but the workflow fails red in `verify-candidate` and writes the lease state as `failed`."
outcome: "Each promoted app gets its own `ARGOCD_TIMEOUT` budget inside `wait-for-argocd.sh`. Later apps are no longer starved by earlier reconciles, so candidate-flight only fails when a specific app truly exceeds its own timeout."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/development-lifecycle.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/bug-0358-candidate-flight-shared-timeout
pr: 1002
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [ci-cd, candidate-flight, argocd]
external_refs:
  - PR #991
  - PR #995
---

# bug.0358 — candidate-flight wait-for-argocd shared timeout

## Why

Recent `candidate-flight.yml` runs on `main` are consistently red even though the deploy lands on candidate-a:

- `flight` succeeds: overlay promotion, deploy-branch push, and ApplicationSet reconcile all complete.
- `verify-candidate` fails only in `Wait for ArgoCD sync on candidate-a`.
- The failure is isolated to `candidate-a-scheduler-worker`, after operator/poly/resy already completed.
- `release-slot` then correctly writes `infra/control/candidate-lease.json` with `state: failed`, which makes the run look like a real deployment failure even when the rollout continues to converge afterward.

Representative evidence from runs `24821976670` and `24823638200` on 2026-04-23:

- `wait-for-argocd.sh` starts with `timeout 300s`
- operator/poly/resy consume roughly the first 150-180 seconds
- `scheduler-worker` begins its rollout check with only `124s` or `147s` remaining
- the script exits on `scheduler-worker rollout did not complete` even though the deployment had not been given its full 300-second budget

## Root Cause

`scripts/ci/wait-for-argocd.sh` computes:

```bash
DEADLINE=$((SECONDS + ARGOCD_TIMEOUT))
```

once before the `for app in "${APPS[@]}"` loop, then passes that same absolute deadline into every sequential `wait_for_app` call.

That means `ARGOCD_TIMEOUT` is not actually a per-app timeout. It is a shared wall clock for the entire batch. In the common four-app candidate-flight case, later apps inherit only whatever time earlier apps did not consume.

This is the remaining false-red class after:

- PR #991 — repeated hard refresh + sync kicks
- PR #995 — allow `Progressing` when `sync phase=Succeeded`

Those changes help apps reach the rollout gate, but they do not fix starvation of the last app in the sequence.

## Design

Minimal fix:

- Keep `ARGOCD_TIMEOUT` as the caller-facing env var.
- Change its semantics to the value the workflow already implies: **per promoted app**, not per batch.
- Move deadline calculation inside `wait_for_app()` so each app gets a fresh `SECONDS + ARGOCD_TIMEOUT`.
- Leave all reconciliation logic, rollout checks, and failure semantics unchanged.

## Validation

- exercise:
  - Open a PR from the fix branch, then dispatch `candidate-flight.yml` from that same branch against the PR head:
    - `gh workflow run candidate-flight.yml --ref fix/bug-0358-candidate-flight-shared-timeout -f pr_number=<PR_NUMBER>`
  - Observe `verify-candidate` no longer fails just because `scheduler-worker` starts late in the sequence.
- observability:
  - In the run log for `Wait for ArgoCD sync on candidate-a`, `scheduler-worker` gets a fresh `kubectl rollout status ... (up to 300s)` budget rather than inheriting `124s` / `147s` leftover from earlier apps.
  - The workflow reaches the downstream `Wait for in-cluster services` and `Verify buildSha on endpoints` steps.
- acceptance:
  - A four-app candidate flight is only red when an individual app truly exceeds its own timeout.
  - No lease patching is required after a successful candidate deploy that previously would have false-failed in `verify-candidate`.
