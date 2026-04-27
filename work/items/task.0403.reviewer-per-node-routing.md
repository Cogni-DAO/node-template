---
id: task.0403
type: task
title: "Reviewer per-node routing — wire `extractOwningNode` into PrReviewWorkflow so PR webhooks load per-node `.cogni/rules/`"
status: needs_implement
priority: 0
rank: 1
estimate: 2
summary: "First consumer of `extractOwningNode` (task.0382). PrReviewWorkflow gains a routing step: after fetching PR context, call `extractOwningNode(rootSpec, changedFiles)`; switch on `kind` — `single` → load `nodes/<X>/.cogni/rules/` for the review; `conflict` → post diagnostic comment + neutral check, exit; `miss` → neutral check, exit. `createReviewAdapterDeps` factory gains a `nodeBasePath` parameter so `readRuleFile` reads from the per-node directory. Earns the per-node review pipeline its first deploy_verified."
outcome: "When a PR opens against `nodes/poly/`, the operator's reviewer loads `nodes/poly/.cogni/rules/` (not the root) and posts a poly-specific review. When a PR spans multiple domains, the reviewer refuses with a diagnostic comment instead of burning AI tokens on an ambiguous review. When a PR touches an unknown scope, a neutral check fires. Same policy as task.0381's CI gate, but at review-time."
spec_refs:
  - vcs-integration
  - node-ci-cd-contract
  - node-operator-contract
assignees: []
project: proj.vcs-integration
branch: feat/task-0403-reviewer-per-node-routing
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-26
updated: 2026-04-26
labels: [vcs, review, temporal, per-node, routing]
---

# Reviewer Per-Node Routing

## Problem

`extractOwningNode` (task.0382) shipped as a pure resolver but has no caller in shipped code. The reviewer pipeline in `PrReviewWorkflow` always loads the root `.cogni/rules/` regardless of which node a PR touches. After this task lands:

- A PR to `nodes/poly/` is reviewed against `nodes/poly/.cogni/rules/`.
- A PR to `nodes/operator/` (operator-only) is reviewed against root `.cogni/rules/`.
- A cross-domain PR is refused at review-time, mirroring the CI gate's verdict at runtime.

Without this task, `extractOwningNode` is dead code and the per-node reviewer story is unimplemented.

## Requirements

- **PER_NODE_RULE_LOADING**: `PrReviewWorkflow` resolves the owning domain from changed files via `extractOwningNode`. When result is `single`, the review handler reads rules from `<repoRoot>/<owningNode.path>/.cogni/rules/` (not the root). For an operator-only PR, `path === "nodes/operator"` so rules come from `nodes/operator/.cogni/rules/`.
- **CONFLICT_REFUSAL**: When `extractOwningNode` returns `conflict`, the workflow posts a single diagnostic PR comment (named domains, "split into N PRs" instruction) + neutral `Check Run` conclusion. **No AI tokens spent**, no `GraphRunWorkflow` child started, no gate evaluation.
- **MISS_NEUTRAL**: When `extractOwningNode` returns `miss` (empty diff in practice — meta-test invariant prevents unregistered-node leakage), workflow posts a neutral `Check Run` summarizing "no recognizable scope" and exits.
- **RIDE_ALONG_RESPECTED**: A PR with `nodes/poly/...` + `pnpm-lock.yaml` (or `work/items/**`) routes to poly per the resolver's `rideAlongApplied` carve-out — not flagged as conflict.
- **OBSERVABILITY**: Workflow logs a structured event `review.routed` with `{ owningNodeKind, owningNodeId, owningNodePath, changedFileCount, prNumber, headSha }` so the deploy_verified loop can find the route decision in Loki for a specific PR.
- **IDEMPOTENCY**: Diagnostic comment uses a stable marker (e.g., body prefix `<!-- cogni-cross-domain-refusal -->`) and the existing PR-comment idempotency mechanism so retries don't spam.
- **SPEC_PARITY**: Diagnostic comment text and the failure-mode wording match `docs/spec/node-ci-cd-contract.md § Single-Domain Scope > Diagnostic contract`.

## Allowed Changes

- `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — new routing step + branching on `OwningNode.kind`
- `packages/temporal-workflows/src/activity-types.ts` — extend `fetchPrContextActivity` return shape with `changedFiles: string[]` and `owningNode: OwningNode`
- `packages/temporal-workflows/src/domain/review.ts` — small helper(s) for diagnostic-comment formatting; pure
- `services/scheduler-worker/src/activities/review.ts` — call `extractOwningNode` inside `fetchPrContextActivity`; new activity `postCrossDomainRefusalActivity` (or extend existing post-comment activity)
- `nodes/operator/app/src/bootstrap/review-adapter.factory.ts` — add `nodeBasePath?: string` parameter (default `"."`); thread into `readRuleFile` (and only `readRuleFile` — `readRepoSpec` keeps reading root)
- Tests:
  - `tests/unit/packages/temporal-workflows/pr-review.workflow.test.ts` — new tests for the three branches (single / conflict / miss)
  - `tests/unit/packages/temporal-workflows/domain/review.test.ts` — diagnostic-comment formatter
  - `services/scheduler-worker/tests/review-activities.test.ts` (or sibling) — `fetchPrContextActivity` returns `owningNode`; `postCrossDomainRefusalActivity` posts the right body
  - `nodes/operator/app/tests/unit/bootstrap/review-adapter.factory.spec.ts` — factory respects `nodeBasePath` for `readRuleFile`, ignores it for `readRepoSpec`
- `work/items/_index.md` — auto-regenerated
- `work/projects/proj.vcs-integration.md` — add a row for this deliverable + mark `extractOwningNode` row as Done

**Out of scope** (separate tasks):

- Thin-CLI wrapper letting `task.0381`'s bash gate consume `extractOwningNode` (task to file)
- Per-node `.cogni/rules/` content authoring — only the routing mechanism here
- Per-node `repo-spec.yaml` (still read root spec for registry; per-node specs are a future seam)
- The `nodeBasePath` propagation into evidence-gathering / check-run scoping (the routing decision is enough; downstream adapters keep their current GitHub API behavior)

## Plan

- [ ] **Step 1 — Read the canonical spec**: `docs/spec/node-ci-cd-contract.md § Single-Domain Scope > Diagnostic contract` to lock the comment wording.
- [ ] **Step 2 — Extend activity return**: `fetchPrContextActivity` adds `changedFiles: string[]` (via `octokit.pulls.listFiles`) + `owningNode: OwningNode` (via `extractOwningNode(parsedRootSpec, changedFiles)`). Update `ReviewActivities` types.
- [ ] **Step 3 — Workflow branching**: in `pr-review.workflow.ts`, after the `fetchPrContextActivity` call, switch on `context.owningNode.kind`:
  - `single` → continue existing flow but pass `nodeBasePath = owningNode.path` to downstream activities that load rules
  - `conflict` → call `postCrossDomainRefusalActivity` + finalize check run as `neutral`, return
  - `miss` → finalize check run as `neutral` with "no recognizable scope" body, return
- [ ] **Step 4 — Factory parameterization**: `createReviewAdapterDeps(installationId, appId, key, nodeBasePath = ".")` — `readRuleFile` joins `<repoRoot>/<nodeBasePath>/.cogni/rules/<file>`. `readRepoSpec` always reads root.
- [ ] **Step 5 — Activity wiring**: any activity that constructs a `ReviewHandlerDeps`-shaped object (or calls the factory) accepts `nodeBasePath` from the workflow and passes it through.
- [ ] **Step 6 — Diagnostic comment formatter**: pure function in `domain/review.ts` that takes `OwningNode & { kind: "conflict" }` and produces the markdown body. Match spec's diagnostic-contract wording verbatim.
- [ ] **Step 7 — Idempotency**: marker comment in body so retries dedupe via existing `postPrComment` upsert mechanism.
- [ ] **Step 8 — Structured log**: emit `review.routed` event after the routing decision (workflow-side `logEvent` or activity-side; pick whichever doesn't break determinism).
- [ ] **Step 9 — Tests**: workflow-level (mock activities, assert branch taken); domain-level (formatter snapshot); activity-level (assert `extractOwningNode` is called + returned in context); factory-level (assert path joining).
- [ ] **Step 10 — `pnpm check` clean**, then `/closeout` flow.

## Validation

```yaml
exercise: |
  # Pre-merge (deterministic, fast):
  pnpm vitest run packages/temporal-workflows/tests/workflows/pr-review.workflow.test.ts
  pnpm vitest run nodes/operator/app/tests/unit/bootstrap/review-adapter.factory.spec.ts
  pnpm check

  # Post-merge → candidate-a (the deploy_verified loop):
  # 1. Open a one-line PR to nodes/poly/ (e.g., bump a comment in any poly file).
  # 2. Wait for the operator's reviewer Check Run to fire on candidate-a (look in PR Checks tab).
  # 3. Verify the review applied poly's rules (not root) — confirmed by the rule names in the
  #    review summary matching nodes/poly/.cogni/rules/* (currently empty? if so, neutral pass
  #    is the correct outcome — log shows the routing decision regardless).
observability: |
  # Pre-merge: tests pass; CI's single-node-scope job passes (PR is operator-only).
  # Post-merge candidate-a: query Loki for the routing event triggered by your PR:
  scripts/loki-query.sh '{namespace="cogni-candidate-a", pod=~"operator-node-app-.*"} | json | msg="review.routed"' 10 50 \
    | jq '.data.result[].values[][1] | fromjson | {ts:.time, owningNodeKind, owningNodeId, owningNodePath, prNumber, headSha}'
  # Expected: a single line with owningNodeKind=single, owningNodePath="nodes/poly", and prNumber
  # matching the PR you opened. Once seen, set deploy_verified: true on this work item AND on
  # task.0382 (the resolver finally has its real exercise on a deployed build).
```

## Pointers

- [`extractOwningNode`](../../packages/repo-spec/src/accessors.ts) — the resolver this task wires up
- [`docs/spec/node-ci-cd-contract.md § Single-Domain Scope`](../../docs/spec/node-ci-cd-contract.md#single-domain-scope) — diagnostic contract source-of-truth
- [`pr-review.workflow.ts`](../../packages/temporal-workflows/src/workflows/pr-review.workflow.ts) — primary edit target
- [`review-adapter.factory.ts`](../../nodes/operator/app/src/bootstrap/review-adapter.factory.ts) — `nodeBasePath` injection
- [`scheduler-worker/src/activities/review.ts`](../../services/scheduler-worker/src/activities/review.ts) — `fetchPrContextActivity` extension
- [task.0382 work item](task.0382.extract-owning-node-resolver.md) — what we're consuming
- [task.0381 work item](task.0381.single-node-scope-ci-gate.md) — the CI-side counterpart we mirror
