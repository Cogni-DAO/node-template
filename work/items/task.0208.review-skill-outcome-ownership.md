---
id: task.0208
type: task
title: "RoleHeartbeatWorkflow + RoleSpec + outcome handlers"
status: needs_implement
priority: 0
rank: 2
estimate: 3
summary: "RoleSpec type + constants. RoleHeartbeatWorkflow with claim/release locking, real GraphRunWorkflowInput, and registry-driven outcome handlers. Two handlers (default, pr-lifecycle)."
outcome: "RoleHeartbeatWorkflow runs on Temporal, leases work items via claim(), delegates to GraphRunWorkflow, dispatches outcome by handler ID, always releases. Two roles operational on schedules."
spec_refs:
  - agent-roles
  - temporal-patterns
assignees:
  - derekg1729
project: proj.agent-workforce
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0207
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, temporal, workforce]
---

# RoleHeartbeatWorkflow + RoleSpec + Outcome Handlers

## Design

### Outcome

One reusable Temporal workflow for all roles. Atomic work item leasing. Registry-driven outcome processing. Two roles operational (CEO, Git Reviewer).

### Approach

**Solution**: `RoleSpec` type + 2 constants. `RoleHeartbeatWorkflow` (~40 lines) with claim/release and real `GraphRunWorkflowInput` shape. `OUTCOME_HANDLERS` registry with 2 handlers.

**Reuses**: `GraphRunWorkflow` via `executeChild`, `WorkItemCommandPort.claim()`/`release()`, `PrReviewWorkflow` pattern.

**Rejected**:

- "Per-role workflow" — duplication, violates ONE_WORKFLOW_ALL_ROLES
- "Read-then-act without lease" — race condition with concurrent schedules
- "Switch statement in processOutcome" — becomes soup at 4+ roles

### Invariants

- [ ] CLAIM_NOT_READ: claimNextItemActivity uses WorkItemCommandPort.claim()
- [ ] ALWAYS_RELEASE: releaseItemActivity in finally block
- [ ] REAL_GRAPHRUNINPUT: messages/model inside input:{}, plus runKind/triggerSource/requestedBy
- [ ] ONE_WORKFLOW_ALL_ROLES: RoleHeartbeatWorkflow parameterized by RoleSpec fields
- [ ] OUTCOME_HANDLERS_DISPATCHED: by handler ID, no role branches in workflow
- [ ] CONTEXT_STAYS_LEAN: buildRoleContext returns minimal messages (Temporal history limits)
- [ ] IDEMPOTENT_OUTCOMES: handlers use stable business keys for side effects

### Files

- Create: `packages/temporal-workflows/src/domain/role-spec.ts` — type + 2 constants
- Create: `packages/temporal-workflows/src/domain/outcome-handlers.ts` — registry + 2 handlers
- Create: `packages/temporal-workflows/src/workflows/role-heartbeat.workflow.ts` — workflow
- Create: `packages/temporal-workflows/src/activities/claim-next-item.ts`
- Create: `packages/temporal-workflows/src/activities/build-role-context.ts`
- Create: `packages/temporal-workflows/src/activities/process-outcome.ts`
- Create: `packages/temporal-workflows/src/activities/release-item.ts`
- Modify: `services/scheduler-worker/` — register workflow + activities
- Modify: `.cogni/repo-spec.yaml` — add PR_LIFECYCLE schedule
- Test: workflow unit test with mocked activities

## Validation

- [ ] claimNextItemActivity calls WorkItemCommandPort.claim() (not just list+pick)
- [ ] releaseItemActivity runs even when graph execution fails
- [ ] GraphRunWorkflow receives valid GraphRunWorkflowInput (matches pr-review.workflow.ts shape)
- [ ] processOutcomeActivity dispatches to handler by ID, not switch on roleId
- [ ] RoleHeartbeatWorkflow returns no_op when queue is empty (no claim attempted)
- [ ] HEARTBEAT schedule fires with roleId=ceo-operator
- [ ] PR_LIFECYCLE schedule fires with roleId=git-reviewer
- [ ] `pnpm check:fast` passes
