---
id: task.0293
type: task
title: "Gate canary→preview promotion on CI success"
status: needs_implement
priority: 0
rank: 2
estimate: 1
summary: "e2e.yml promote-to-staging dispatches preview promotion without checking ci.yaml status. Hard invariant violation — broken code (failing typecheck/tests) can reach preview and create release PRs."
outcome: "Canary→preview promotion only fires when BOTH build-multi-node AND ci.yaml succeed. Broken code never reaches preview."
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

# Gate canary→preview promotion on CI success

## Context

On canary push, two workflows fire in parallel:

- `build-multi-node.yml` — builds images
- `ci.yaml` — typecheck, lint, unit, component, stack tests

`promote-and-deploy.yml` gates on build-multi-node success. `e2e.yml` promote-to-staging then dispatches preview promotion. **Neither checks ci.yaml status.** Broken code (failing CI) can promote all the way to preview and create release PRs.

This is a hard invariant from the CI/CD spec: "canary→preview promotion MUST gate on CI success."

## Changes

In `e2e.yml`, before the promote-to-staging dispatch step:

1. Query ci.yaml run status for the same HEAD SHA: `gh run list --workflow=ci.yaml --head-sha=<sha> --status=completed --json conclusion -q '.[0].conclusion'`
2. If conclusion != "success", skip promotion with clear message
3. If no ci.yaml run found yet (still running), wait with bounded timeout then recheck

## Validation

1. Push to canary with a typecheck error → build succeeds, CI fails → canary E2E runs → promote-to-staging is SKIPPED
2. Push to canary with clean code → build succeeds, CI succeeds → promote-to-staging fires normally
