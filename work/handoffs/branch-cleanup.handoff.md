---
id: handoff.branch-cleanup
type: handoff
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Handoff: Branch Cleanup — Auto-Tag + Delete Stale Branches

## Context

Repo has **160 branches**. Breakdown:

- 44 feat/\* (most merged or abandoned)
- 24 fix/\* (same)
- 19 claude/\* (AI-generated, one-shot)
- 16 release/\* (conveyor belt leftovers from old e2e.yml)
- 7 codex/\* (AI-generated)
- 5 deploy/\* (keep — these are active deploy state branches)
- 4 dependabot/\* (auto-managed)
- ~40 others (design/_, spike/_, chore/\*, etc.)

Default branch changed from `staging` to `main` on 2026-04-06. `staging` is now deprecated.

## What to build

A GitHub Actions workflow (`cleanup-branches.yml`) that runs on a schedule (weekly) and:

1. **Archive merged branches** — for each branch whose HEAD is reachable from `main` or `canary`:
   - Create a lightweight tag: `archive/<branch-name>` (preserves the ref for history)
   - Delete the branch

2. **Flag stale branches** — branches with no commits in 30+ days that are NOT merged:
   - Open an issue or comment on the associated PR (if any)
   - Do NOT auto-delete — may have in-progress work

3. **Protected branches** (never touch):
   - `main`, `canary`
   - `deploy/canary`, `deploy/preview`, `deploy/production`, `deploy/staging`
   - `dependabot/*` (managed by Dependabot)

4. **Delete staging** — after confirming:
   - [ ] No open PRs target staging
   - [ ] No workflows reference staging as a trigger branch
   - [ ] `workflow_run` reads from main (confirmed 2026-04-06)
   - Tag as `archive/staging` before deletion

## Immediate manual cleanup (before workflow exists)

```bash
# Delete all 16 release/* branches (conveyor belt leftovers)
for b in $(gh api repos/Cogni-DAO/node-template/git/refs --paginate -q '.[].ref' | grep 'refs/heads/release/'); do
  BRANCH=${b#refs/heads/}
  echo "Archiving $BRANCH"
  git tag "archive/$BRANCH" "origin/$BRANCH" 2>/dev/null
  git push origin "archive/$BRANCH" 2>/dev/null
  gh api "repos/Cogni-DAO/node-template/git/refs/heads/$BRANCH" -X DELETE 2>/dev/null
done

# Delete claude/* and codex/* branches (one-shot AI branches, no ongoing work)
for prefix in claude codex; do
  for b in $(gh api repos/Cogni-DAO/node-template/git/refs --paginate -q '.[].ref' | grep "refs/heads/$prefix/"); do
    BRANCH=${b#refs/heads/}
    echo "Deleting $BRANCH"
    gh api "repos/Cogni-DAO/node-template/git/refs/heads/$BRANCH" -X DELETE 2>/dev/null
  done
done
```

## Design considerations

- Tags are cheap and preserve commit reachability for `git log` and blame
- Deleting a branch with an open PR auto-closes the PR — check first
- The 6 open canary PRs need rebasing (separate task), don't delete their branches
- `deploy/*` branches are active GitOps state — NEVER delete

## Files to create

- `.github/workflows/cleanup-branches.yml` — scheduled weekly workflow
- Use `actions/github-script` for API calls (avoids shell complexity)

## Validation

After cleanup: `git ls-remote --heads origin | wc -l` should be < 30 (main, canary, deploy/_, dependabot/_, 6 active PRs).
