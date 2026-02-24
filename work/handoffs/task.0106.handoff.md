---
id: task.0106.handoff
type: handoff
work_item_id: task.0106
status: active
created: 2026-02-24
updated: 2026-02-24
branch: feat/ledger-ui
last_commit: 6f9e7553
---

# Handoff: Governance Epoch UI + Dev Seed — UI Refinement Pass

## Context

- The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) renders epoch contribution data from real ledger API endpoints
- A dev seed script (`pnpm db:seed`) populates 3 epochs (2 finalized, 1 open) with realistic GitHub activity from `Cogni-DAO/node-template`
- `pnpm dev:setup` is the single onboarding command: `db:setup` + `db:setup:test` + `governance:schedules:sync`
- PR #472 is open against `staging` — all checks pass, ready for UI refinement before merge
- The next developer focuses on **UI polish and eliminating hardcoded values** across the governance pages and components

## Current State

- **Done:** 3 governance pages render against seeded or live data, tab navigation, countdown timer, contributor ranking, holdings aggregation
- **Done:** Seed script uses `computeEpochWindowV1()` for Monday-aligned UTC windows matching the scheduler grid
- **Done:** Dead mock data removed from hooks (USE_MOCK flags, mock file deleted)
- **Needs work:** UI is MVP quality — hardcoded colors, placeholder avatars, magic numbers, no responsive polish
- **Needs work:** No user profile system — contributor display names come from seed data or platform logins
- **Needs work:** No loading skeletons tuned to actual content shapes

## Decisions Made

- Epoch windows use `computeEpochWindowV1()` everywhere (seed + scheduler) — [epoch-window.ts](../../packages/ledger-core/src/epoch-window.ts)
- View models composed client-side from flat API responses — [compose-epoch.ts](../../src/features/governance/lib/compose-epoch.ts), [compose-holdings.ts](../../src/features/governance/lib/compose-holdings.ts)
- Hooks fetch directly from ledger API, no mock fallback — [useCurrentEpoch.ts](../../src/features/governance/hooks/useCurrentEpoch.ts)
- Components are presentational only — data fetching stays in hooks, composition in `lib/`

## Next Actions

- [ ] Audit hardcoded values in components: color arrays in `ContributorCard`, magic number `/1000` divisor in `view.tsx` files, hardcoded pool credit amounts
- [ ] Replace placeholder avatars with real GitHub avatars (available via `platformLogin` → `github.com/{login}.png`)
- [ ] Extract repeated `fetchJson<T>()` helper from hooks into a shared utility
- [ ] Add proper empty/error states for each page (current ones are minimal)
- [ ] Review responsive layout — tab nav overflows on mobile, cards lack breakpoint adjustments
- [ ] Consider extracting weight config display names from a shared constant instead of hardcoding event type labels in `ContributionRow.tsx`
- [ ] Evaluate whether `EpochCountdown` timer interval (60s) is appropriate or should be configurable
- [ ] Verify accessibility: tab navigation a11y, color contrast on contributor cards, screen reader support for countdown

## Risks / Gotchas

- `activity_events` table has an append-only trigger (`ledger_reject_mutation`) — cannot DELETE to re-seed; must drop/recreate DB
- `ONE_OPEN_EPOCH` constraint: seed aborts if an open epoch exists; to re-seed, finalize or drop existing epochs
- `ContributorCard` uses a hardcoded HSL color palette (6 colors) — will repeat for >6 contributors
- Event type → label mapping in `ContributionRow.tsx` is hardcoded — new event types render as raw strings
- Credit math uses BigInt server-side but `Number()` conversion for display — safe for current scale but check if pool sizes grow

## Pointers

| File / Resource                                          | Why it matters                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/features/governance/AGENTS.md`                      | Full public surface: hooks, components, lib, types, routes                   |
| `src/features/governance/components/ContributorCard.tsx` | Hardcoded color palette, `/1000` divisor, placeholder avatar                 |
| `src/features/governance/components/ContributionRow.tsx` | Hardcoded event type → label/icon mapping                                    |
| `src/features/governance/components/EpochCountdown.tsx`  | 60s timer interval, status badge labels                                      |
| `src/features/governance/lib/compose-epoch.ts`           | View model composition — where display names/avatars would be enriched       |
| `src/features/governance/types.ts`                       | All view model types — `avatar` and `color` fields exist but are placeholder |
| `src/app/(app)/gov/epoch/view.tsx`                       | Magic number `/ 1000` for score display                                      |
| `scripts/db/seed.mts`                                    | Seed data: hardcoded contributor names, deterministic UUIDs                  |
| `packages/ledger-core/src/epoch-window.ts`               | `computeEpochWindowV1()` — shared by seed + scheduler                        |
| `work/items/task.0106.ledger-dev-seed.md`                | Full requirements and data shape reference                                   |
