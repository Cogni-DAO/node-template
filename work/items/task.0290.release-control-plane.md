---
id: task.0290
type: task
status: needs_implement
priority: 1
rank: 1
estimate: 5
title: "Release Control Plane — Temporal-driven candidate promotion"
summary: "Replace workflow_run chaining with two Temporal state machines (ReleaseCandidate + EnvironmentController), policy-gated preview, and unified SHA+digest candidate objects."
outcome: "Canary handles 1000+ AI commits/day. Preview gets policy-selected snapshots. Production gets human-approved exact-SHA releases. No split-brain between code and images."
project: proj.cicd-services-gitops
assignees: [derekg1729]
branch: design/release-control-plane
created: 2026-04-05
updated: 2026-04-05
labels: [ci-cd, temporal, deployment, architecture]
---

# Release Control Plane

## Design

### Outcome

AI agents ship 1000+ commits/day to canary without drowning humans in noise. Preview gets policy-selected snapshots (not every green SHA). Production gets human-approved, exact-SHA-matching releases. No split-brain between code and images.

### Approach

**Solution**: Two Temporal state machines — `ReleaseCandidateWorkflow(sha)` (many, per-commit) and `EnvironmentControllerWorkflow(env)` (scarce, per-environment) — with `PromotionPolicyWorkflow` running periodic selection. GH Actions emits build/test facts via webhook; Temporal owns all state transitions. Deploy-branch updates via Temporal activity (direct commits, no PRs for canary/preview). Kill `staging` as a code branch; feature PRs target `canary`. Release branches cut late, from canary, at the exact SHA running in preview.

**Reuses**:

- `@cogni/ingestion-core` `DataSourceRegistration` + `WebhookNormalizer` pattern for GH Actions → control plane fact ingestion
- `@cogni/temporal-workflows` activity profile tiers and workflow patterns
- `@cogni/db-schema` Drizzle table patterns (append-only audit logs like attribution)
- `scripts/ci/promote-k8s-image.sh` for deploy-branch updates (called from Temporal activity)
- Existing operator webhook receiver service pattern
- `@cogni/ids` for deterministic workflow IDs

**Rejected**:

- **Three-branch code promotion (canary → staging → main)**: Creates split-brain between code branches and image promotion. Staging as a long-lived code branch forces code to merge through an intermediate branch that adds latency, merge conflicts, and desynchronization from the images actually deployed.
- **GH Actions as the state machine**: `workflow_run` limited to 3-level chaining, only fires from default branch, provides no durable state, no policy queries, no soak windows. Not designed for release orchestration.
- **Auto-promote every green canary to preview**: At 1000 commits/day, this is noise. Preview resets every few minutes, humans can never meaningfully review, "green" becomes statistical noise.
- **PR-per-promotion for canary deploy branch**: 100+ PRs/day is pure noise. Direct bot commits are the standard GitOps pattern for high-churn environments.

### Invariants

- [ ] CANDIDATE_IDENTITY: SHA + digests are one object, never separate tracks (spec: release-control-plane)
- [ ] BUILD_ONCE: Images built once on canary, promoted by digest to all environments (spec: release-control-plane)
- [ ] PREVIEW_POLICY_NOT_PASS: Preview updates on policy (soak + availability), not every green SHA (spec: release-control-plane)
- [ ] TEMPORAL_OWNS_STATE: GH Actions emits facts only, Temporal owns transitions (spec: release-control-plane)
- [ ] HUMAN_GATE_AT_PROD: Single human approval at preview→production boundary (spec: release-control-plane)
- [ ] DEPLOY_BRANCH_DIRECT: Canary/preview deploy-branch updates are direct commits, not PRs (spec: release-control-plane)
- [ ] RELEASE_BRANCH_LATE: Release branches cut from canary at exact approved SHA (spec: release-control-plane)
- [ ] APPEND_ONLY_AUDIT: candidate_transitions and promotion_decisions are immutable audit logs (spec: release-control-plane)
- [ ] SIMPLE_SOLUTION: Reuses existing ingestion, Temporal, and webhook patterns
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layering — ports in packages, adapters in services

### Phases

**Phase 0** (immediate, this branch): Fix E2E smoke → get one clean flow through existing pipeline
**Phase 1** (1-2 PRs): DB tables + Temporal workflows + webhook receiver
**Phase 2** (1 PR): GH Actions simplification (orchestrator + reusable workflows)
**Phase 3** (1 PR): Branch model migration (canary as default branch)
**Phase 4** (1 PR): Swimlane visualization dashboard

### Files

**Spec:**

- Create: `docs/spec/release-control-plane.md` — full spec (done)

**Phase 1 — State Machine:**

- Create: `packages/db-schema/src/release.ts` — release_candidates, candidate_transitions, environment_state, promotion_decisions tables
- Create: `packages/temporal-workflows/src/workflows/release-candidate.workflow.ts` — per-SHA workflow
- Create: `packages/temporal-workflows/src/workflows/environment-controller.workflow.ts` — per-env workflow
- Create: `packages/temporal-workflows/src/workflows/promotion-policy.workflow.ts` — periodic selector
- Modify: `packages/temporal-workflows/src/activity-types.ts` — add ReleaseActivities interface
- Create: `services/scheduler-worker/src/activities/release/` — activity implementations
- Create: `nodes/operator/app/src/app/api/v1/release/build-complete/route.ts` — webhook endpoint
- Create: `nodes/operator/app/src/features/release/` — feature slice for release control

**Phase 2 — GH Actions:**

- Create: `.github/workflows/orchestrator.yml` — single entry point on canary push
- Create: `.github/workflows/_build-node.yml` — reusable build workflow
- Modify: `.github/workflows/e2e.yml` — strip to pure workflow_dispatch test runner
- Delete: `.github/workflows/staging-preview.yml`
- Delete: `.github/workflows/promote-and-deploy.yml` relay chain (replaced by Temporal)

**Phase 3 — Branch Model:**

- Modify: `.github/workflows/ci.yaml` — update branch triggers
- Modify: `docs/spec/ci-cd.md` — update branch model documentation

**Phase 4 — Visualization:**

- Create: `nodes/operator/app/src/contracts/release.status.v1.contract.ts` — API contract
- Create: `nodes/operator/app/src/app/(authenticated)/release/` — dashboard page

## Validation

- [ ] Spec reviewed and approved: `docs/spec/release-control-plane.md`
- [ ] Phase 0: E2E smoke tests pass, one clean canary→preview flow works
- [ ] Phase 1: ReleaseCandidate and EnvironmentController workflows registered in Temporal
- [ ] Phase 1: GH Actions webhook → operator → Temporal signal works end-to-end
- [ ] Phase 2: `orchestrator.yml` replaces `promote-and-deploy.yml` relay chain
- [ ] Phase 3: `canary` is default branch, feature PRs target canary
- [ ] Phase 4: Swimlane dashboard renders environment state and candidate queue
- [ ] All invariants in spec are enforced (code review checklist)
