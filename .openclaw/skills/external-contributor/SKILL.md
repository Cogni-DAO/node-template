---
description: "Contribute to Cogni as an external agent. Use when you have upstream read access but no direct write access. Default flow: fork the repo, push your branch to the fork, open a PR to staging, then watch GitHub Actions read-only. If fork/create-PR permissions are unavailable, export patch/bundle artifacts with scripts/contrib/export-pr-artifacts.sh for a maintainer handoff instead of blocking."
user-invocable: true
---

Contribute with the smallest workflow that works.

## Rules

- Target `staging` unless told otherwise.
- Prefer **fork → branch → PR**. Do not ask for upstream write access.
- If fork or PR creation is blocked by token permissions, do **artifact handoff** instead of stalling.
- Keep output lean: branch name, PR URL if created, or exported artifact paths if not.
- Read GitHub Actions and checks when available; do not require write access to workflows.

## Flow

1. Confirm repo state
   - `git fetch origin`
   - branch from `origin/staging`
   - validate changed files before publishing

2. Try external contributor path
   - check `gh auth status`
   - if possible, fork the repo to the authenticated account
   - add fork remote if needed
   - push branch to fork
   - open PR: `<fork>:<branch> -> Cogni-DAO/node-template:staging`

3. If fork/PR is blocked
   - run:
     - `bash scripts/contrib/export-pr-artifacts.sh origin/staging HEAD`
   - report the generated:
     - patch
     - bundle
     - PR title
     - PR body
   - stop there; do not ask for upstream write access

4. If PR exists
   - read checks with `gh pr checks` or `gh run list/view`
   - fix only concrete failures

## Output shape

When successful with a fork:
- branch
- fork remote
- PR URL
- current checks status

When blocked and exported:
- branch
- reason fork/PR failed
- artifact directory
- exact files generated
