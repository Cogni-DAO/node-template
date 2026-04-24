---
id: task.0363
type: task
title: "Operator dashboard: Active Pull Requests + CI/flight/deploy_verified loop"
status: needs_implement
revision: 1
priority: 1
rank: 1
estimate: 2
summary: "Mount an Active Pull Requests card on /dashboard — the operator's PR → CI → flight → deploy_verified loop, which is the real core of the operator home view. Types import `PrSummary` + `CiStatusResult` from `@cogni/ai-tools` (the contracts established by PR #1021); CI-vs-flight grouping lives in a client-side presenter, not the wire shape. Phase 1: frontend + typed mock fetcher. Phase 2: operator route composing `VcsCapability.listPrs` + `getCiStatus` + flight state."
outcome: "On /dashboard, above the existing Runs/Work grid, an Active Pull Requests card lists open PRs with an overall status dot (passing/running/failed/pending), labels, and an expand chevron. Expanded row shows a CI Pipeline check group and, when flighted, a Flight (candidate-a) group derived from the flat `CiStatusResult.checks[]` by naming convention. Flighted rows surface `deploy_verified`. All colors use semantic tokens (success/destructive/info/muted) — no per-label hue."
spec_refs:
  - ci-cd
assignees: []
project:
pr:
created: 2026-04-24
updated: 2026-04-24
labels: [frontend, operator, dashboard]
external_refs:
  - PR #1021 feat(vcs) add vcs/flight endpoint — CI-gated candidate-a flight
  - PR #849 feat(streams) recover vcs webhook stream publish
  - PR #850 feat(dashboard) recover grouped ci dashboard
  - PR #811 merged — feat(dashboard) live VCS activity feed from node stream
---

# task.0363 — Operator dashboard PR loop

Built on top of PR #1021 (vcs/flight endpoint). Two phases; Phase 1 ships in this PR, Phase 2 is the backend wire-up.

## Phase 1 — Frontend + mock (this PR)

**Scope**

- Panel mounted on `/dashboard` (no new route, no new nav entry). The operator home IS the GitOps view.
- Types **import** `PrSummary` + `CiStatusResult` + `CheckInfo` from `@cogni/ai-tools` — no redeclaration. Operator-side extension is a thin `PrPanelEntry = { pr, ci, flight?, htmlUrl }`.
- CI-vs-flight grouping is a client-side presenter (`group-checks.ts`) over the flat `CiStatusResult.checks[]`. The wire shape stays flat.
- `overallStatus()` folds CI + flight + `deploy_verified` into the row's outer status dot, so merged-and-flighted-but-not-yet-verified is visibly distinct from verified ("receiving credit").
- Mock fetcher returns data shaped after the real contracts so Phase 2 is a pure server-side swap.

**Files**

```
nodes/operator/app/src/app/(app)/dashboard/
  _api/fetchActivePrs.ts                 — mock; returns PrPanelListResponse
  _components/pr-panel/
    pr-panel.types.ts                    — PrPanelEntry/FlightInfo (extends @cogni/ai-tools)
    group-checks.ts                      — groupChecks() + overallStatus() presenter
    StatusDot.tsx
    CheckPill.tsx
    CheckGroupCard.tsx
    PrPanelRow.tsx                       — expandable row
    ActivePullRequestsPanel.tsx          — card with summary counts
  view.tsx                               — mounts the panel above the Runs/Work grid
```

**Visual standards**

- Semantic tokens only: `success` / `destructive` / `info` / `muted-foreground`. Labels render as `Badge intent="outline"`.
- Check-name → group classification: prefixes `candidate-flight`, `flight-`, `verify-buildsha`, `argo`, `deploy-` → Flight group; everything else → CI group.

## Phase 2 — Real data (followup, NOT in this PR)

1. Operator route `GET /api/v1/vcs/active-prs` that composes:
   - `VcsCapability.listPrs({ state: "open" })`
   - For each PR: `VcsCapability.getCiStatus({ prNumber })`
   - Flight state: last `DispatchCandidateFlightResult` per PR + `/version.buildSha` match signal for `deploy_verified`
2. Zod contract for the response shape in `packages/node-contracts` (`vcs.active-prs.v1.contract`)
3. Live updates: subscribe to the node-stream `vcs.*` events already recovered by PR #849/#811
4. Replace `fetchActivePrs()` body; signature unchanged.

## Validation

- exercise: visit `/dashboard` on candidate-a; the Active Pull Requests panel renders above the Runs/Work grid. Expand a row; CI Pipeline and (when present) Flight (candidate-a) group cards render with correct semantic dot colors. A row with `deploy_verified: true` shows the success checkmark + "Deploy Verified" badge.
- observability: Loki query `{app="operator"} |= "dashboard-active-prs"` at the deployed SHA (React Query cache key appears in request telemetry).

## Review Feedback (revision 1)

From `/review-implementation` on 2026-04-24. Four blocking items:

1. **Nested interactive elements in `PrPanelRow.tsx:83–141`** — outer `<button>` wraps an inner `<Link>` (`<a>`). HTML-invalid; triggers React `validateDOMNesting` warning. Refactor to non-nested structure (e.g., `<div role="button" tabIndex={0}>` + `onKeyDown`, or lift the external link out of the clickable region).
2. **Duplicate React keys in `CheckGroupCard.tsx:47–48`** — `key={check.name}` collides when GitHub reruns a check-run (real data has multiple rows per name). Use `${check.name}-${idx}` or thread the GitHub check-run id through `CheckInfo` via the adapter.
3. **`mergeable ?? true` masks `null` state** in `fetchActivePrs.ts:195, 209` — the contract's `boolean | null` has semantic meaning (`null` = not-yet-computed by GitHub); `??` collapses it to `true`. Default to `null`.
4. **No unit tests on `group-checks.ts`** — pure logic (`normalize` status×conclusion matrix, `isFlight` prefix classification, `rollup` empties, `overallStatus` fold) needs coverage before Phase 2 swaps server-side data onto it. Add vitest for all three.

Non-blocking but worth folding in while the PR is open:

- Deduplicate `rowOverall` (in `ActivePullRequestsPanel.tsx`) and the in-row computation — extract `computeEntryStatus(entry)` into `group-checks.ts`.
- Tighten the `"argo"` flight prefix to `"argo-"` to match the delimited convention of other prefixes (`candidate-flight`, `flight-`, `deploy-`).
- Move mock timestamp generation into `fetchActivePrs()` so the "Live" chip isn't lying at refetch time.
- PR #1241 mock has `ci.allGreen: true` but candidate-flight checks are `in_progress`/`queued` — internally inconsistent fixture.
- Add a loading skeleton for the panel in `view.tsx` so the layout doesn't jump when data arrives (sibling sections already do this).
- `ActivePullRequestsPanel` prop → `readonly PrPanelEntry[]`.
- `statusLabel` in `PrPanelRow.tsx:58–65` returns `"Queued"` as a catch-all for overall="pending" — misleading for empty-checks PRs; consider "Waiting".
