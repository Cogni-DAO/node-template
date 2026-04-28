---
id: task.0410
type: task
title: "PrReviewWorkflowInput Zod schema + contract test — fix modelRef-shape regression class"
status: needs_implement
priority: 0
rank: 1
estimate: 1
branch:
summary: "Workflow input contracts drift between dispatch and route — PR #1067 fixed the modelRef instance, but the regression class survives. Add a single Zod schema for `PrReviewWorkflowInput` in `packages/temporal-workflows/`; convert dispatch + activity types to `z.infer<>`; add a round-trip contract test. ~150 lines, lands independently of any other in-flight VCS work. Highest-value cleanup that does NOT gate on test:external."
outcome: "(1) `PrReviewWorkflowInputSchema` (Zod) is the single source of truth for the workflow input shape. (2) `dispatch.server.ts`, `pr-review.workflow.ts`, and `services/scheduler-worker/src/activities/review.ts` all consume the type via `z.infer<typeof PrReviewWorkflowInputSchema>`; no manual TS interfaces duplicating the shape. (3) A round-trip contract test in `tests/unit/packages/temporal-workflows/` parses a fixture through `z.parse()` and asserts the dispatch-side payload + the activity-side input both validate. Future drift between dispatch and activity will fail the test before it ships."
spec_refs:
  - vcs-integration
  - temporal-patterns
assignees: derekg1729
credit:
project: proj.vcs-integration
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, review, temporal, contracts, zod]
external_refs:
  - work/items/task.0409.multi-tenant-git-review-routing.md
  - work/items/task.0408.split-temporal-workflows-per-node.md
---

## Problem

PR #1067 fixed a real bug where `pr-review.workflow.ts:131` sent `model: "gpt-4o-mini"` (legacy string) but the graphs runs route required `modelRef: { providerKey, modelId }` (post-tightening of `route.ts:475`). The workflow→activity contract was a plain TS interface, so the drift was invisible to the type system across the wire.

Same regression class survives — every field on `PrReviewWorkflowInput` is currently a manual TS interface in `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` + a parallel definition in `nodes/operator/app/src/app/_facades/review/dispatch.server.ts`. Next time the input shape changes, we have ~80% chance of repeating the modelRef silent-drift bug.

## Approach

Add `PrReviewWorkflowInputSchema = z.object({...})` in `packages/temporal-workflows/`. Both producer (dispatch) and consumer (activity) use `z.infer<>`. Add a unit test that round-trips a fixture through `z.parse()` and asserts both call sites' payloads validate. The schema is the contract — TypeScript catches structural drift, the test catches semantic drift, and Zod runtime validation at the activity boundary catches anything that slipped through both.

## Files

- New: `packages/temporal-workflows/src/workflows/pr-review.schema.ts` — `PrReviewWorkflowInputSchema` (Zod) + exported type via `z.infer<>`.
- Modify: `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — consume the type, drop the manual TS interface.
- Modify: `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — consume the type via `z.infer<>` import; consider validating the args before `workflowClient.start(...)` for fail-fast at the dispatch boundary.
- Modify: `services/scheduler-worker/src/activities/review.ts` — activity input typed via `z.infer<>` (parses-or-throws on entry already by Temporal default; explicit `z.parse()` belt-and-suspenders).
- New: `tests/unit/packages/temporal-workflows/pr-review-input-contract.test.ts` — round-trip a fixture through the schema; assert dispatch payload + activity input both validate.

## Validation

- **exercise:** `pnpm vitest run tests/unit/packages/temporal-workflows/pr-review-input-contract.test.ts` — green. Then run `pnpm test:external:operator` to confirm the existing pr-review-e2e flow still passes against `derekg1729/test-repo` (or `Cogni-DAO/test-repo` after task.0409 lands).
- **observability:** No new Loki signal needed. The schema + test ARE the validation surface; CI green = invariant held.

## Dependencies & ordering

- **Lands BEFORE task.0409.** Per task.0409 review feedback: every PR that touches `PrReviewWorkflowInput` between now and 0410 is one more chance for the next modelRef-shape regression. Ship 0410 first.
- **Coordinates with task.0408.** If task.0408 (split temporal-workflows per-node) lands first, the schema lives in `nodes/operator/packages/temporal-workflows/`; otherwise it lives in shared `packages/temporal-workflows/`. Either way the implementation is mechanical — rebase target only.
