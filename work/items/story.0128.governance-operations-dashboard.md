---
id: story.0128
type: story
title: "Governance operations dashboard — epoch lifecycle, schedule visibility, and manual triggers"
status: needs_design
priority: 2
rank: 3
estimate: 5
summary: "Build admin-facing governance pages that surface epoch lifecycle status, Temporal schedule health, and allow authorized manual triggering of collection/finalization workflows. Replace reliance on raw Temporal UI for operational visibility."
outcome: "Admins can see all governance schedules (LEDGER_INGEST, HEARTBEAT, etc.), their last run status, current epoch state (open/review/finalized), and trigger manual collection passes or advance epochs — all from within the Cogni web UI. Non-admin users see their own epoch status and projected scores without operational controls."
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02
labels: [governance, admin, dashboard, attribution, temporal]
external_refs:
---

# Governance Operations Dashboard

## Context

Today, the only way to observe the attribution pipeline lifecycle is through:

1. **Temporal Web UI** — infrastructure-level debugging tool, not user-facing
2. **Review UI** — exists for epoch finalization, but no visibility into schedule health or collection status
3. **Database queries** — manual epoch/projection inspection

This leaves a critical operational gap: admins cannot see if the daily 6am LEDGER_INGEST ran, whether it collected anything, or what the current epoch status is — without SSH access or Temporal dashboard credentials.

## Problem Statement

- No admin-facing view of governance schedules and their execution history
- No way to manually trigger a collection pass (e.g., after fixing a GitHub token issue)
- No visibility into whether the last run actually collected new data vs. was a no-op
- The Temporal dashboard exposes infrastructure internals inappropriate for end users
- Admin role/permissions are not yet defined (RBAC gap)

## Requirements

### Must Have (Crawl)

1. **Epoch lifecycle page** — shows all epochs for a scope with status badges (open/review/finalized), period dates, receipt counts, and projected score summaries
2. **Schedule status panel** — for each governance schedule (LEDGER_INGEST, etc.): last run time, next scheduled run, last result (success/failure/skipped), run count
3. **Manual collection trigger** — admin-only button to start an ad-hoc `CollectEpochWorkflow` run for the current epoch
4. **Activity log** — recent workflow execution summaries (started, completed, failed, skipped-unchanged) with timestamps

### Should Have (Walk)

5. **Admin role gate** — define "governance admin" permission; gate manual triggers and schedule management behind it. Relates to RBAC spec gaps.
6. **Collection diff view** — after a run, show what changed: new receipts, identity resolutions, projection deltas
7. **Schedule management** — pause/resume schedules, modify cron expressions (with audit trail)
8. **Alerting integration** — surface failed workflow runs as notifications (push to Loki, email, or in-app)

### Nice to Have (Run)

9. **Multi-scope view** — when operator manages multiple nodes, show all scopes' governance status in one dashboard
10. **Projected score trends** — time-series view of projected allocations across epochs
11. **Self-service epoch advancement** — let admins force-close an epoch early or extend the grace period

## Open Questions

- **Admin role definition**: We don't have a formal admin role yet. The RBAC spec covers tenant-level roles but not governance operations. Should this be a new `governance_admin` role, or extend the existing `owner` role?
- **API surface**: Should manual triggers go through an HTTP API (like finalization does today) or use a Temporal signal/schedule trigger pattern?
- **Multi-tenant scope**: When operator manages external nodes (task.0122), does each node's admin see only their schedules, or does the operator see all?

## Technical Notes

- Epoch data is already queryable via `attribution_store` (epochs, projections, evaluations, pool components)
- Schedule metadata lives in Temporal — need a read API to surface schedule status (Temporal SDK `ScheduleClient.list()` / `describe()`)
- The `CollectEpochWorkflow` now skips unchanged enrichers/allocations (ENRICHER_SKIP_UNCHANGED) — the dashboard should surface this "skipped" vs. "computed" distinction
- Finalization already has an HTTP trigger route (`/api/v1/attribution/epochs/[id]/finalize`) — manual collection would follow the same pattern

## Validation

- [ ] Epoch lifecycle page renders all epochs with correct status badges
- [ ] Schedule status panel shows last run time and next scheduled run
- [ ] Manual collection trigger starts a workflow and reflects status on page
- [ ] Activity log shows recent workflow execution summaries
- [ ] Non-admin users cannot access manual trigger controls
