---
id: bug.0193
type: bug
title: "scheduler-worker houses workflow definitions — should be thin composition root"
status: needs_triage
priority: 3
rank: 50
estimate: 3
summary: "services/scheduler-worker/ contains 3,738 lines of business code (workflows + activities + domain) vs 1,949 lines of bootstrap. Workflows are deterministic/sandboxed and belong in a shared package. Worker should be import + register + start."
outcome: "packages/temporal-workflows/ owns all workflow definitions; services/scheduler-worker/ is thin composition root (bootstrap + activity wiring only)"
spec_refs: [temporal-patterns-spec]
assignees: []
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-24
updated: 2026-03-24
labels: [scheduler, architecture]
---

# scheduler-worker houses workflow definitions

## Symptoms

- Adding `PrReviewWorkflow` required adding `@cogni/langgraph-graphs` to the worker's Dockerfile — a graph package has no business being in the worker binary
- Worker service is 66% business logic, 34% infrastructure
- Every new webhook→graph flow will add more domain code to the worker

## Root Cause

Workflow definitions live in `services/scheduler-worker/src/workflows/` instead of a shared package. The worker should be a thin composition root: import workflows, import activities, register task queues, start worker.

## Proposed Fix

- `packages/temporal-workflows/` — all workflow definitions + types + activity profiles
- `services/scheduler-worker/` — bootstrap only (env, container, health, worker entrypoint)
- Activities stay in the worker (they need concrete deps like Octokit, DB)
- Domain logic (`domain/review.ts`) moves to the workflow package or a domain package

## Validation

```bash
pnpm check
```

## Attribution

-
