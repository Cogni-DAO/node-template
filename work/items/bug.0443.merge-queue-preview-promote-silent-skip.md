---
id: bug.0443
type: bug
title: "Merge-queue squash → preview deploy silent-skip — flight-preview can't resolve PR, promote-and-deploy reports success on no-op"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "OBSERVED: PR #1166 merged via GH merge-queue squash. flight-preview triggered on push:main, ran its 'Resolve target SHA and associated PR' step against squash commit `db2e416f`, found no PR (squash commits don't have a PR head SHA association), printed 'Dispatched with SHA db2e416f that has no PR — skipping' and skipped the retag step. promote-and-deploy still ran, but no `preview-db2e416f` images exist → resolve-digests returned empty → all promote-k8s jobs uploaded `PROMOTED: false` cell artifacts → verify-deploy steps skipped (silent) → workflow reported SUCCESS while preview still served the broken pre-merge image (`8b1227d6`) and the broken pod (Ready 0/1, 134m old) was never replaced. EXPECTED: (a) flight-preview's PR resolver falls back to parsing `(#NNNN)` from the squash commit message → `gh pr view NNNN --json headRefOid` → uses that as the head_sha for retag; (b) when promote-and-deploy ends with all PROMOTED=false despite a non-empty affected set, the workflow HARD-FAILS instead of silently succeeding. REPRO: any squash-merge to main via merge queue. IMPACT: prod outages can survive a hotfix merge silently — the fix's PR is green, main is green, deploy reports green, but the running pod is still broken. Took ~30+ minutes to diagnose during 2026-04-30 preview outage."
outcome: "Two structural fixes land together so we can't ship a hotfix and have it silently no-op: (1) flight-preview.yml's PR resolver handles squash-merge commits via commit-message PR-number parsing; (2) promote-and-deploy's aggregator hard-fails when affected_targets > 0 but all promote-k8s cells return PROMOTED=false. After this PR, a clean repro merging a small hotfix via merge-queue produces a real new digest in deploy/preview-<node> and a new pod with the merged code on preview within ~5 min."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch: fix/merge-queue-preview-promote-gap
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-05-01
updated: 2026-05-01
labels: [ci, deploy, merge-queue, silent-failure, p0, preview]
external_refs:
---

# Merge-queue squash → preview deploy silent-skip

## Observed (2026-05-01 04:25–04:39 UTC)

PR #1166 (env-validator hotfix) merged at 04:25:49 UTC via GH merge-queue (squash strategy). Expected outcome: preview heals on auto-deploy ~5min. Actual outcome: 14+ minutes of confusion, manual intervention required.

Workflow trace from the post-merge cascade:

1. `Flight Preview` run 25202180337 fired on `push:main` for sha `db2e416fd` (the squash commit).
2. `flight` job's "Resolve target SHA and associated PR" step ran:
   ```
   ℹ️  Dispatched with SHA db2e416f that has no PR — skipping.
   ```
   The retag step (which would tag `pr-1166-<head-sha>` images as `preview-db2e416f`) never executed.
3. `Flight Preview` reported conclusion=success anyway — the missing retag was a "silent skip".
4. `Promote and Deploy` run 25202187333 was dispatched downstream for `db2e416f`.
5. Every `promote-k8s (<node>)` job ran `resolve-digests-from-preview.sh`, found no `preview-db2e416f` image, uploaded a per-cell artifact with `PROMOTED: false` and `DEPLOY_SHA: ""`.
6. Every `verify-deploy (<node>)` step had `if: steps.cell.outputs.promoted == 'true'` → all real verification steps skipped.
7. Workflow reported conclusion=success.
8. Preview pods unchanged. `/version` still returns `8b1227d6` (pre-fix image). `/api/v1/work/items` still 500. Old pod Ready 1/1, broken new pod stuck Ready 0/1.

`deploy/preview-operator` branch confirms it: last commit is `092da711b promote preview operator: 0a7f41cd` from PR #1162 — no commit was pushed for #1166's merge.

## Why each existing safeguard failed

| Layer                        | What it should catch                                               | Why it didn't                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flight-preview PR resolution | Find the PR head SHA so we know which `pr-N-<sha>` images to retag | Looked up `db2e416f` → no PR (squash sha isn't a branch tip), gave up. Did not parse `(#NNNN)` from the squash commit message.                                                                                                   |
| promote-and-deploy.decide    | Refuse to run when nothing's promotable                            | Ran fine — `decide` doesn't check whether images exist for the resolved SHA, just emits the target list.                                                                                                                         |
| promote-k8s per-node         | Either promote a new digest OR fail loudly                         | Wrote `PROMOTED=false` to a cell artifact and reported job success. Same silent-success-on-no-op bug.0321 was supposed to kill (cf. bug.0441 which already documented the verify-deploy half of this in promote-and-deploy.yml). |
| verify-deploy                | Fail when nothing was promoted but verification was expected       | Step-level `if: steps.cell.outputs.promoted == 'true'` skipped all real checks → job green. Same primitive as bug.0441.                                                                                                          |
| aggregate-preview            | Refuse to advance the rollup when no nodes promoted                | Reported success, presumably because at least one node skipped cleanly.                                                                                                                                                          |

The compound effect: every layer reports green, the running build is unchanged. Operators and dashboards see "deploy succeeded" while production behavior is still broken. **This is exactly the failure mode bug.0321 was created to eliminate; it's now leaking through a sibling code path.**

## Root cause #1 — flight-preview PR resolver doesn't handle squash-merge commits

`.github/workflows/flight-preview.yml` (and the helper script that resolves the PR for the pushed SHA) calls something equivalent to `gh pr list --search "<sha>"` or queries the API for `repos/:owner/:repo/commits/:sha/pulls`. That returns empty for a squash-merge because the squash commit is **not** the PR's branch tip — it's a brand-new tree-state on `main` with one parent (previous main HEAD). GitHub does keep the association in the merge metadata, but only the squash commit message reliably contains the PR number (the trailing ` (#NNNN)`).

The fix is mechanical: when the SHA → PR lookup returns empty, parse `(#NNNN)` from `git log -1 --format=%s` of the SHA and re-query `gh pr view NNNN --json headRefOid`. Use that head SHA as the source for the retag.

## Root cause #2 — promote-and-deploy treats "nothing to promote" as success

`promote-k8s` jobs that produce `PROMOTED=false` cell artifacts should not silently succeed when the `decide` job declared the node as a target. The aggregator (or a final gate job) needs to detect the contradiction:

```
decide.outputs.targets_json contains "operator"
  AND
promote-k8s (operator) cell.promoted = "false"
  →  HARD FAIL
```

Today it's: `decide` emits the target → `promote-k8s` records PROMOTED=false → `verify-deploy` step-level skip turns into silent green → `aggregate-preview` advances → workflow conclusion=success. Each link looks reasonable in isolation; the chain produces a lie.

## Approach (one PR, both fixes)

### Fix 1 — flight-preview.yml PR-resolver fallback

In the workflow's "Resolve target SHA and associated PR" step (or its helper script), add the squash-message fallback:

```bash
# Existing path (unchanged): try the SHA-to-PR API lookup first.
PR=$(gh api "repos/${REPO}/commits/${SHA}/pulls" --jq '.[0].number // empty')

# NEW fallback: parse PR number from squash commit message.
if [ -z "$PR" ]; then
  MSG=$(git log -1 --format=%s "$SHA")
  PR=$(echo "$MSG" | grep -oE '\(#[0-9]+\)' | head -1 | tr -d '(#)')
  if [ -n "$PR" ]; then
    echo "ℹ️  Resolved PR via squash-message: #$PR"
  fi
fi

if [ -z "$PR" ]; then
  echo "::error::Cannot resolve PR for SHA $SHA — neither commit/pulls API nor squash-message parse worked. Refusing to dispatch downstream with empty PR."
  exit 1
fi

# Use gh pr view for the actual head SHA (where pr-N-<sha> images live).
HEAD_SHA=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
```

The hard-fail at the end is intentional. If we can't determine the source of images, the right answer is to stop, not to silently dispatch a no-op deploy.

### Fix 2 — promote-and-deploy hard-fail on full-skip contradiction

Add a final job to `.github/workflows/promote-and-deploy.yml` that runs after all per-cell `promote-k8s` jobs:

```yaml
verify-something-promoted:
  needs: [decide, promote-k8s]
  if: always() && needs.promote-k8s.result != 'skipped'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@v4
      with:
        pattern: cell-*
        merge-multiple: true
    - run: |
        targets='${{ needs.decide.outputs.targets_json }}'
        target_count=$(jq 'length' <<<"$targets")
        promoted_count=$(grep -l 'PROMOTED=true' cell-*/promotion.env 2>/dev/null | wc -l)
        if [ "$target_count" -gt 0 ] && [ "$promoted_count" -eq 0 ]; then
          echo "::error::decide identified $target_count targets but 0 promoted. Likely cause: source images don't exist for the resolved SHA. Check flight-preview's PR-resolver step in the upstream workflow."
          exit 1
        fi
```

Mirror the per-cell artifact convention already in the workflow. The aggregator job's failure makes the whole `Promote and Deploy` run fail, which (per the existing `unlock-preview-on-failure` lever) releases the preview lease cleanly so the next push can retry.

## Validation

1. Open a tiny PR touching `nodes/operator/app/src/shared/env/server-env.ts` (e.g. add a comment). Merge via merge-queue (squash).
2. Wait for `Flight Preview` on the squash sha. The "Resolve target SHA and associated PR" step now logs `Resolved PR via squash-message: #<N>` instead of `has no PR — skipping`.
3. `Promote and Deploy` runs to completion with at least one promote-k8s reporting PROMOTED=true. New `deploy/preview-operator` commit appears.
4. Within ~5min: preview `/version` returns the new sha; old pod terminates; new pod Ready 1/1.
5. Negative test: dispatch `Promote and Deploy` manually with `source_sha=<a-sha-with-no-built-images>`. The new `verify-something-promoted` job hard-fails with the clear error message, and the run conclusion is `failure` (not silent success).

## Related

- bug.0321 — the original silent-green primitive cleanup. This bug is the same shape leaking through a sibling code path (flight-preview ↔ promote-and-deploy seam).
- bug.0441 — verify-deploy step-level `if:` survived in promote-and-deploy.yml. Same family. Could be folded into a single "ban step-level conditional verification across all CD workflows" cleanup.
- 2026-05-01 incident PRs: #1158 (NULLS LAST regression), #1162 (NULLS LAST fix), #1166 (env-validator hotfix). PR #1166's heal was delayed by this bug.

## Bootstrap notes for the dev picking this up

Worktree: `.claude/worktrees/bug-merge-queue-preview-promote-gap`  
Branch: `fix/merge-queue-preview-promote-gap` (off latest main `db2e416fd`)

After bootstrap (`pnpm install --frozen-lockfile`), the relevant files to read:

- `.github/workflows/flight-preview.yml` — PR resolver lives here
- `.github/workflows/promote-and-deploy.yml` — needs the new hard-fail job
- `scripts/ci/flight-preview.sh` — the helper script that does the PR lookup (look for the `gh api commits/.../pulls` call)
- `scripts/ci/resolve-digests-from-preview.sh` — what currently silently returns empty
- `scripts/ci/promote-build-payload.sh` — emits `PROMOTED=false` to the cell artifact

Two scoped commits, one PR. Skill: `devops-expert` is the right one for review.
