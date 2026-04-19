---
id: task.0329
type: task
title: "Wallet analysis Part 1 — extract reusable components from /research"
status: needs_design
priority: 2
rank: 5
estimate: 2
created: 2026-04-19
updated: 2026-04-19
summary: "Pull the BeefSlayer hero apart into 7 reusable molecules + a WalletAnalysisView organism with a single page variant. /research keeps rendering BeefSlayer, but via the new component fed by hardcoded props. No backend changes."
outcome: "WalletAnalysisView ships in src/features/wallet-analysis/. /research renders BeefSlayer via <WalletAnalysisView address=BEEF variant='page' size='hero' data={…} />. Playwright visual diff vs main ≤ 0.5% pixel delta."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, wallet-analysis, refactor, ui]
---

# task.0329 — Wallet Analysis: Component Extraction (Part 1)

## Problem

The BeefSlayer hero on `/research` is one bespoke 800-line client component. We want any roster wallet to render the same way. Step 1 is the static refactor — no backend, no new data sources.

## Scope

In:

- New feature directory `nodes/poly/app/src/features/wallet-analysis/`
- 7 molecule components per the design doc decomposition: `WalletIdentityHeader`, `StatGrid`, `BalanceBar`, `TradesPerDayChart`, `RecentTradesTable`, `TopMarketsList`, `EdgeHypothesis`
- One organism `WalletAnalysisView({ address, variant, size, data, isLoading })` accepting pure props
- `variant` accepts `"page"`; `size` accepts `"hero" | "default"`. Other variants land in later parts.
- `/research/view.tsx` refactor: BeefSlayer block becomes `<WalletAnalysisView ... />`. Hardcoded BEEF object stays in `view.tsx` for now.
- `AGENTS.md` for the new feature directory
- Component-level unit tests for each molecule (skeleton, populated, empty)

Out:

- API routes
- DB tables / migrations
- React Query hooks
- New variants beyond `page`
- Any change to `/dashboard`

## Validation

- [ ] `WalletAnalysisView` accepts `data` as a pure prop. No fetching.
- [ ] Each molecule renders its own skeleton when `isLoading`.
- [ ] `/research` renders BeefSlayer via the new component.
- [ ] Playwright visual diff between branch and main on `/research` is ≤ 0.5 % pixel delta.
- [ ] `pnpm typecheck:poly` clean.
- [ ] `pnpm --filter @cogni/poly-app lint` clean.
- [ ] `pnpm check:docs` clean.

## Out of Scope

Anything from task.0330 / task.0331 / vNext.
