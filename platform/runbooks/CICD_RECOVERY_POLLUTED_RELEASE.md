# CI/CD Recovery: Polluted Release Branch

## Symptom

A release branch PR to `main` shows:

```
This branch is out-of-date with the base branch
```

And the `require-pinned-release-branch` check fails with:

```
ERROR: Release branch head <sha> does not match pinned SHA <pin>.
This branch has been modified after promotion (e.g., 'Update branch' or extra commits).
```

## Root Cause

The staging-to-main promotion pipeline relies on **immutable release branches**:

1. `staging-preview.yml` creates `release/YYYYMMDD-<shortsha>` pinned to a tested commit
2. The branch name encodes the expected HEAD SHA
3. `require-pinned-release-prs-to-main.yml` validates HEAD matches the pin

**Pollution occurs when:**

- Someone clicks GitHub's "Update branch" button on a release PR
- This merges `main` INTO the release branch, creating a new merge commit
- The HEAD SHA no longer matches the pin in the branch name
- The validation check fails

**If the check is bypassed** (admin override or misconfigured branch protection),
the polluted merge reaches `main`. This causes all future release branches to
appear "out of date" because `main` now contains merge commits that aren't in
staging's linear history.

## Diagnosis

```bash
# 1. Check if main has merge commits not in staging's ancestry
git log --oneline origin/staging..origin/main | grep -i "merge"

# 2. Identify the polluting merge
git log --oneline --graph origin/main -10

# 3. Verify the pinned SHA check failed
gh run list --workflow=require-pinned-release-prs-to-main.yml --limit=10
```

Look for entries showing `failure` on release branch pushes or PRs.

## Recovery Procedure

### Step 1: Merge main into staging

Since staging has linear history and main has diverged with merge commits,
sync staging to include main's history:

```bash
git fetch origin main staging
git checkout staging
git merge origin/main -m "chore: sync staging with main to restore CI/CD alignment"
```

### Step 2: Create PR to staging (if protected)

If staging requires PRs:

```bash
git checkout -b chore/sync-staging-with-main
git push origin chore/sync-staging-with-main
gh pr create --base staging --head chore/sync-staging-with-main \
  --title "chore: sync staging with main to restore CI/CD alignment" \
  --body "Restores CI/CD alignment after polluted release branch merge."
```

### Step 3: Merge and let pipeline re-promote

Once merged to staging, `staging-preview.yml` will:

1. Build and test the image
2. Deploy to preview
3. Run E2E tests
4. Create a new release branch that includes main's history
5. Open a clean PR to main

### Step 4: Close stale release PRs

Any existing release PRs that show "out of date" should be closed:

```bash
gh pr close <pr-number> --comment "Superseded by CI/CD recovery - new release branch incoming"
```

## Prevention

1. **Branch protection**: Ensure `require-pinned-release-branch` is a required check
2. **Admin enforcement**: Enable "Do not allow bypassing the above settings" on main
3. **Team awareness**: Never click "Update branch" on release/\* PRs
4. **Documentation**: Reference `docs/CI-CD.md` for the branch model invariants

## Related

- [CI/CD Pipeline Flow](../../docs/CI-CD.md)
- [Deployment Architecture](DEPLOYMENT_ARCHITECTURE.md)
