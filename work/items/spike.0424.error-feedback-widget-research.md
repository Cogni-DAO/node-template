---
id: spike.0424
type: spike
title: "Research: top-0.1% patterns for in-app error-feedback widgets"
status: needs_research
priority: 1
rank: 5
estimate: 1
summary: "Before building a reusable 'Send to Cogni' widget across operator chat, poly trading, and every other surface that surfaces errors, study how the top teams ship this — Sentry user-feedback, Linear/Notion/Vercel inline error reports, GitHub issue-from-error, Chrome DevTools, MUI/Chakra/Radix snackbar+action patterns. Recommend a single reusable abstraction (component shape, hook contract, presentation variants) that fits this codebase's hexagonal/contracts-first style. v0-of-v0 (task.0423) ships a full-page button — this spike picks the next abstraction so task.0425 doesn't ship bespoke."
outcome: "A short research doc under docs/research/ with: (1) a comparison matrix of how 4–6 top products surface 'something went wrong, tell us about it' inline (not full-page), (2) the common abstraction shape (state machine, hook + variant component, payload contract), (3) a recommended fit for this repo (matches existing ChatErrorBubble, poly trade error UI, Radix/shadcn primitives in use), (4) explicit rejection of bespoke per-surface implementations. Output is a clear `task.0425` brief — what component, what API, where it lives, what variants it supports."
spec_refs:
  - docs/spec/observability.md
assignees: derekg1729
credit:
project: proj.observability-hardening
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [research, frontend, ux, observability, error-handling]
external_refs:
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - work/items/task.0423.send-to-cogni-error-intake-v0.md
  - work/items/task.0425.error-feedback-widget-cross-surface.md
  - nodes/operator/app/src/features/ai/components/ChatErrorBubble.tsx
---

# Research: top-0.1% error-feedback widget patterns

## Problem

`task.0423` ships a v0-of-v0: a full-page "Send to Cogni" button inside
the Next.js `error.tsx` boundaries. That works for catastrophic
render-time errors but is wrong for the surfaces that matter most:

- **Operator chat** — when an LLM/tool call fails, the error surfaces
  inside the conversation (`ChatErrorBubble`). A full-page reset button
  is hostile UX. We need an inline affordance next to the bubble.
- **Poly trading** — when "close order" 422s, the error shows in a
  toast or an inline form error, not a route boundary. We need a
  variant that lives next to the failing element.
- **Every other surface that ever shows an error** — same story.

Before we build this, we need to study how the top 0.1% of teams have
already solved it. The risk of skipping research: bespoke
per-surface widgets, inconsistent UX, fragmented telemetry, n+1
implementations to rev when the contract changes.

## Research questions

1. **Prior art — what shape do leaders ship?**
   - **Sentry User Feedback** (the canonical "report this error"
     widget). Embedded vs modal modes; payload shape; how it threads
     `event_id` through.
   - **Linear** "Send feedback" button — small dialog, inline; how
     it composes with toast errors.
   - **Notion** error toasts with "Report" link.
   - **Vercel** dashboard error UI with copy-trace-id + report flow.
   - **Chrome DevTools** "Send feedback" + the `chrome://crashes`
     surfacing pattern.
   - **GitHub** "report a problem" footer link from error pages.
   - **MUI Snackbar with action**, **Radix Toast**,
     **shadcn Sonner** — the underlying primitive shape.

2. **What's the abstraction?**
   - One component with a `variant` prop (`page | inline | toast | modal`)?
   - A `useErrorReport()` hook + headless-component pattern (like Radix)?
   - Compound components (`<ErrorReport>`, `<ErrorReport.Trigger>`,
     `<ErrorReport.Dialog>`)?
   - A shared submission core (the hook) + per-surface UI
     consumers?

3. **What's the contract surface?**
   - One Zod payload (today: `error-report.v1.contract.ts`) shared by
     every variant? Or per-variant payload extensions?
   - How do `digest`-bearing failures (Next render errors) and
     non-`digest` failures (caught fetch/mutation errors with no
     server-side log line) coexist in the same payload?
   - Where does `errorContext` (the user-typed note) live?

4. **What fits this codebase?**
   - We use shadcn/Radix primitives + tailwind. `Sonner` for toasts.
     `Dialog`/`Popover` for modals.
   - Hexagonal/contracts-first style — the contract is already a
     port-shaped Zod schema, the UI consumes it via `z.infer`.
   - No shared `packages/ui-*` exists yet (story.0417 noted this).
     Should this widget be the first occupant of one, or live in
     `nodes/operator/app/src/components/` and be hand-ported per
     node until pain motivates extraction?

5. **What do we explicitly reject?**
   - Bespoke per-surface buttons that all submit slightly different
     payload shapes.
   - A "report" feature that lives only in the chat surface and not
     in the trade surface (or vice versa).
   - Reinventing what shadcn / Radix / Sonner already give us.

## Allowed Changes

- New `docs/research/error-feedback-widget-patterns.md` — the
  research doc. The only deliverable.
- May update `task.0425` with the recommendation in its `Plan` /
  `Design` section.

## Plan

- [ ] Read 4–6 production references (Sentry first, then Linear /
      Notion / Vercel / Chrome / GitHub). Capture screenshots /
      shape descriptions; note where they diverge.
- [ ] Survey shadcn / Radix / Sonner primitives in use here.
- [ ] Look at the existing `ChatErrorBubble` and the poly trade error
      surfaces — what props/state do they already carry that the
      widget can hang off?
- [ ] Write the comparison matrix + recommendation in
      `docs/research/error-feedback-widget-patterns.md`.
- [ ] Update `task.0425` with the picked design (component shape,
      variants, file path, hook contract).

## Validation

**Output:** `docs/research/error-feedback-widget-patterns.md` exists,
contains the matrix + recommendation, and is referenced from
`task.0425`'s Design section. `/triage` of `task.0425` flips it to
`needs_implement` once the research is in.

## Review Checklist

- [ ] **Work Item:** `spike.0424` linked
- [ ] **Reference quality:** ≥4 distinct prior-art products studied
      (not just one)
- [ ] **Recommendation:** unambiguous — names the component shape,
      the variants, the file path, the hook contract
- [ ] **Anti-bespoke:** explicitly rejects per-surface custom impls

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
- Triggered by: validate-candidate scorecard on PR #1121 — Derek
  flagged that the full-page button is unusable for chat / trade
  error surfaces.
