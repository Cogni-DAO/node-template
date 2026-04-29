---
id: task.0425
type: task
title: "Reusable 'Send to Cogni' widget across chat, poly trading, and every error surface"
status: needs_design
priority: 1
rank: 5
estimate: 3
summary: "Implement the reusable error-feedback widget recommended by spike.0424. Two concrete v1 surfaces: (1) operator's `ChatErrorBubble` gets an inline 'Send to Cogni' action so an LLM/tool failure can be reported in-conversation; (2) poly trading's close-order error path gets the same widget in its toast/inline error UI. Same Zod payload (`error-report.v1.contract`), same hook, just different variants. v0-of-v0's full-page button on `error.tsx` boundaries stays — this adds the inline + toast variants beside it."
outcome: "A user hitting any of the three surfaces — full-page error boundary, chat error bubble, or poly trade close-order failure — gets a consistent 'Send to Cogni' affordance using a single shared component + hook. The payload shape is identical across surfaces (one row in `error_reports` looks the same regardless of where the click came from). Bespoke per-surface report buttons are explicitly out — if a new surface needs the widget, it imports the component, picks a variant, passes the error, done."
spec_refs:
  - docs/spec/observability.md
assignees: derekg1729
credit:
project: proj.observability-hardening
branch:
pr:
reviewer:
revision: 0
blocked_by: [spike.0424, task.0423]
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [frontend, ux, observability, error-handling]
external_refs:
  - work/items/spike.0424.error-feedback-widget-research.md
  - work/items/task.0423.send-to-cogni-error-intake-v0.md
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx
---

# Reusable error-feedback widget — chat, poly trading, and beyond

## Problem

`task.0423` shipped a full-page button that's wrong for the surfaces
that actually matter:

- **Operator chat** (`ChatErrorBubble`) — full-page reset is hostile.
- **Poly trading close-order failures** — error shows in toast or
  inline form, not a route boundary.

`spike.0424` will research how top teams (Sentry, Linear, Notion,
Vercel, Chrome, GitHub) ship the inline / toast / modal variants of
this widget and recommend a single reusable abstraction. This task
implements that recommendation.

**Anti-pattern this task explicitly rejects:** a bespoke "report"
button per surface, with slightly different payloads, slightly
different submission paths, slightly different telemetry. Drift like
that is exactly what story.0417 was created to prevent.

## Scope

**In:**

- The shared widget (component + hook + variants) per `spike.0424`'s
  recommendation.
- Wire it into operator's `ChatErrorBubble`.
- Wire it into poly's close-order error UI (exact location TBD —
  spike.0424 surveys it).
- Update operator's `(app)/error.tsx` and `(public)/error.tsx` to
  use the shared widget instead of the inline component shipped in
  task.0423.
- Delete `nodes/operator/app/src/components/SendToCogniButton.tsx`
  (the v0-of-v0 component) once the new shared one fully replaces it.
- Same Zod payload (`error-report.v1.contract.ts`); no breaking change.

**Out:**

- Cross-node port to resy / node-template. Tracked in story.0417.
- Backend changes (Temporal, `loki_window` pull). Tracked in
  task.0420.
- A new `packages/ui-*` package (unless `spike.0424` recommends it).

## Allowed Changes

- New shared widget files at the path `spike.0424` picks (likely
  `nodes/operator/app/src/components/error-feedback/` or, if the
  spike recommends extraction, a new `packages/ui-*`).
- `nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx`
  — render the widget.
- `nodes/poly/app/src/...` — poly's close-order error UI (exact files
  TBD by spike).
- Deletes: `nodes/operator/app/src/components/SendToCogniButton.tsx`
  - the imports in both `error.tsx` files.
- AGENTS.md updates in touched dirs.
- Component tests for each variant.

## Plan

Detailed plan filled in by `/design` once spike.0424 lands. Skeleton:

- [ ] Re-read spike.0424 recommendation.
- [ ] Implement shared widget (component + hook).
- [ ] Replace task.0423's `SendToCogniButton` with the new component
      in `(app)/error.tsx` + `(public)/error.tsx`. Delete the old
      file.
- [ ] Wire into `ChatErrorBubble`.
- [ ] Wire into poly close-order error UI.
- [ ] Component tests per variant; visual smoke on candidate-a per
      surface.

## Validation

**Pre-merge:**

- Component tests render all variants and exercise the submission
  hook (mocked fetch).
- `pnpm check` green.

**On candidate-a:**

- `exercise:` Force errors on three surfaces:
  1. `/dev/boom` (full-page, regression check vs task.0423).
  2. Operator chat: send a request that triggers an `ai.tool_call`
     failure (use a known-bad model id or graph name).
  3. Poly trading: attempt to close a non-existent / already-closed
     order.
- Click "Send to Cogni" on each. Capture all 3 trackingIds.
- `observability:` Loki query for
  `{node=~"operator|poly"} | json | event="error_report.intake"`
  returns 3 lines, one per click, all at the deployed SHA. DB shows
  3 rows in `error_reports`, payload shape identical across rows.

`deploy_verified: true` only after all 3 surfaces produce identical-
shaped reports on candidate-a.

## Review Checklist

- [ ] **Work Item:** `task.0425` linked
- [ ] **Spec:** spike.0424 recommendation followed verbatim (no
      drift); `docs/spec/observability.md` updated to remove
      "v0-of-v0 ships only the full-page button" caveat
- [ ] **Tests:** component tests per variant; cross-surface
      candidate-a validation evidence in PR comment
- [ ] **No bespoke:** `SendToCogniButton.tsx` deleted; no
      surface-specific report buttons added
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
- Spike: spike.0424
- v0-of-v0: task.0423
