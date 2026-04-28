---
id: task.0403
type: task
title: "Reviewer per-node routing — wire `extractOwningNode` into PrReviewWorkflow so PR webhooks load per-node `.cogni/rules/`"
status: needs_merge
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
updated: 2026-04-27
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

- **PER_NODE_RULE_LOADING**: `fetchPrContextActivity` resolves the owning domain via `extractOwningNode(parsedRootSpec, changedFiles)`. When result is `single` AND `owningNode.path !== "nodes/operator"`, rule files are fetched from GitHub at `<owningNode.path>/.cogni/rules/<file>` (not the root). Operator-domain PRs keep reading root `.cogni/rules/` (operator's rules already live at root). Root `.cogni/repo-spec.yaml` is always the gates-config source — per-node specs are a future seam (task.0407).
- **CONFLICT_REFUSAL**: When `extractOwningNode` returns `conflict`, the workflow posts a single diagnostic PR comment (named domains, split instruction) + neutral `Check Run` conclusion. **No AI tokens spent**, no `GraphRunWorkflow` child started, no gate evaluation.
- **MISS_NEUTRAL**: When `extractOwningNode` returns `miss` (empty diff in practice — meta-test invariant prevents unregistered-node leakage), workflow posts a neutral `Check Run` summarizing "no recognizable scope" and exits.
- **RIDE_ALONG_RESPECTED**: A PR with `nodes/poly/...` + `pnpm-lock.yaml` (or `work/items/**`) routes to poly per the resolver's `rideAlongApplied` carve-out — not flagged as conflict. Covered transitively via the parity test in `task.0382`; one passthrough fixture in the activity test is sufficient here.
- **OBSERVABILITY**: `fetchPrContextActivity` emits a Pino structured log `review.routed` with `{ owningNodeKind, owningNodeId, owningNodePath, changedFileCount, prNumber, headSha }`. Activity-side (not workflow-side) — Pino in workflow code is non-deterministic. Loki query in Validation block matches this shape.
- **SPEC_PARITY**: Diagnostic comment text matches `docs/spec/node-ci-cd-contract.md § Single-Domain Scope > Diagnostic contract` — names conflicting domains, names operator-territory paths when operator is involved, suggests the split, links the spec section.

## Allowed Changes

- `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — new routing step + branching on `OwningNode.kind`; no `nodeBasePath` parameter on existing activities (path is resolved inside `fetchPrContextActivity` and applied there)
- `packages/temporal-workflows/src/activity-types.ts` — extend `fetchPrContextActivity` return shape with `changedFiles: string[]` and `owningNode: OwningNode`; add `postCrossDomainRefusalActivity` activity type
- `packages/temporal-workflows/src/domain/review.ts` (NEW or existing) — pure helper formatting the diagnostic comment body from a `conflict`-kind `OwningNode`
- `services/scheduler-worker/src/activities/review.ts` — call `extractOwningNode` inside `fetchPrContextActivity`; emit `review.routed`; switch the rule-file fetch path to `<owningNode.path>/.cogni/rules/...` for non-operator singles; add `postCrossDomainRefusalActivity` (also calls `postCrossDomainCheckRun` + `postCrossDomainComment` — or extends existing `postReviewResultActivity` with a "diagnostic" mode)
- Tests:
  - `tests/unit/packages/temporal-workflows/workflows/pr-review.workflow.test.ts` — three branches (single / conflict / miss)
  - `tests/unit/packages/temporal-workflows/domain/review.test.ts` — diagnostic-comment formatter (snapshot OK)
  - `services/scheduler-worker/tests/unit/activities/review.test.ts` (or sibling) — `fetchPrContextActivity` returns `owningNode`, fetches rules from per-node path for non-operator singles, fetches from root for operator
- `work/items/_index.md` — auto-regenerated
- `work/projects/proj.vcs-integration.md` — already updated

**Out of scope** (separate tasks):

- `createReviewAdapterDeps` factory in `nodes/<x>/app/src/bootstrap/` — verified to have **zero production callers** (live path is 100% Temporal). Pruning is a separate cleanup task, not a routing-feature task.
- Per-node `repo-spec.yaml` and per-rule modelRef — owned by **task.0407** (filed alongside PR #1067).
- Thin-CLI wrapper letting `task.0381`'s bash gate consume `extractOwningNode` — separate task.
- Per-node `.cogni/rules/` content authoring — only the routing mechanism here.

## Plan

- [ ] **Step 1 — Read the canonical spec**: `docs/spec/node-ci-cd-contract.md § Single-Domain Scope > Diagnostic contract` to lock the comment wording (already read during /review-design — points 1-4: name conflicting domains, name operator-territory paths, suggest the split, link the spec section).
- [ ] **Step 2 — Extend activity return**: in `services/scheduler-worker/src/activities/review.ts`, `fetchPrContextActivity` already calls `octokit.pulls.listFiles`. Add `changedFiles: string[]` (filenames from that response) and `owningNode: OwningNode` (via `extractOwningNode(parsedRootSpec, changedFiles)`) to `FetchPrContextOutput`. Update `ReviewActivities` interface in `activity-types.ts` to match.
- [ ] **Step 3 — Per-node rule path**: when `owningNode.kind === "single"` and `owningNode.path !== "nodes/operator"`, change the `fetchRepoFile(..., \`.cogni/rules/${ruleFile}\`, ...)` call (line ~294) to `\`${owningNode.path}/.cogni/rules/${ruleFile}\``. Operator domain keeps the root path (its rules already live at root).
- [ ] **Step 4 — Diagnostic comment formatter**: pure function `formatCrossDomainRefusal(owningNode: OwningNode & { kind: "conflict" }, changedFiles: string[]): string` in `packages/temporal-workflows/src/domain/review.ts`. Output matches spec's diagnostic-contract: lists conflicting domains, calls out operator-territory paths if operator is one, suggests the split, links spec section.
- [ ] **Step 5 — New activity**: `postCrossDomainRefusalActivity({ owner, repo, prNumber, headSha, installationId, checkRunId, owningNode, changedFiles })` in `services/scheduler-worker/src/activities/review.ts`. Calls the formatter, posts the comment, completes the check run as `neutral` with the same summary. (Alternatively: extend `postReviewResultActivity` with a `diagnostic: { kind: "conflict" | "miss", ... }` mode — implementer's call. Single activity preferred for fewer top-level surfaces.)
- [ ] **Step 6 — Workflow branching**: in `pr-review.workflow.ts`, after `fetchPrContextActivity`, switch on `context.owningNode.kind`:
  - `single` → existing flow (rule-file path is already correct because activity resolved it)
  - `conflict` → `postCrossDomainRefusalActivity(...)`, return
  - `miss` → same activity with miss-shaped input (or a tiny separate activity), return
- [ ] **Step 7 — Structured log**: in `fetchPrContextActivity`, after computing `owningNode`, emit `logger.info({ msg: "review.routed", owningNodeKind, owningNodeId, owningNodePath, changedFileCount, prNumber, headSha }, "review.routed")`. This is the line the deploy_verified Loki query will match.
- [ ] **Step 8 — Tests**: workflow tests mock activities and assert branch taken; activity tests use a fake Octokit and assert (a) `owningNode` shape, (b) per-node rule fetch path for non-operator singles, (c) root rule fetch path for operator, (d) `review.routed` log emitted; domain test snapshots the formatter for one each of `conflict-with-operator` and `conflict-without-operator`.
- [ ] **Step 9 — `pnpm check` clean**, then `/closeout` flow.

**PR #1067 coordination**: PR #1067 (currently open) renames `model: string` → `modelRef: { providerKey, modelId, connectionId? }` in the same three files I'm editing (activity-types.ts, pr-review.workflow.ts, scheduler-worker/activities/review.ts). Whichever lands second rebases. My changes are additive on different lines, so the merge is mechanical. If #1067 lands first, my code uses `modelRef` shape unchanged. If mine lands first, #1067 rebases its rename on top. No design-level conflict.

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
  # review.routed is emitted by fetchPrContextActivity in scheduler-worker (NOT operator pod).
  scripts/loki-query.sh '{namespace="cogni-candidate-a", pod=~"scheduler-worker-.*"} | json | msg="review.routed"' 10 50 \
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
