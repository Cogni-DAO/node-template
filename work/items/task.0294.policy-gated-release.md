---
id: task.0294
type: task
title: "Policy-gated release: kill auto-release PR conveyor belt"
status: needs_implement
priority: 0
rank: 3
estimate: 2
summary: "e2e.yml auto-creates a release/* branch + PR to main on every preview E2E success. With fast AI iteration, this floods main with release PRs. Change to human-initiated singleton release."
outcome: "Preview E2E success records the candidate SHA. Release PR creation is triggered by workflow_dispatch, not auto-fired. At most one active release PR at a time."
spec_refs: [ci-cd-spec]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr_url:
created: 2026-04-05
updated: 2026-04-05
labels: [ci-cd, deploy]
---

# Policy-gated release: singleton release PR

## Context

Current flow in `e2e.yml`: preview E2E passes → `promote-release` job auto-creates `release/YYYYMMDD-<sha>` branch + PR to main. Every preview success generates a new release PR.

With AI agents committing frequently to canary, this creates a conveyor belt of release PRs on main. Most get superseded before anyone reviews them.

The CI/CD spec says: "Preview success does NOT auto-create release PRs. Release promotion is policy-gated. At most one active release PR at a time."

## Changes

1. **Remove auto-trigger**: In `e2e.yml`, remove the `promote-release` job (or gate it behind `if: false`)
2. **Record candidate SHA**: After preview E2E passes, write the successful SHA to a known location (GitHub Actions output, deploy branch marker file, or environment variable in GH environment)
3. **Add workflow_dispatch release workflow**: New workflow (or new dispatch input on e2e.yml) that:
   - Reads the latest successful preview SHA
   - Creates `release/YYYYMMDD-<sha>` branch from that SHA
   - Opens PR to main (or updates existing release PR)
   - Closes any stale release PRs
4. **Singleton enforcement**: Before creating a new release PR, close any existing open release/\* PRs to main

## Validation

1. Preview E2E passes → no release PR auto-created
2. Manual dispatch → singleton release PR created from latest successful preview SHA
3. Second dispatch → previous release PR closed, new one opened
4. `auto-merge-release-prs.yml` still works on the singleton PR after approval
