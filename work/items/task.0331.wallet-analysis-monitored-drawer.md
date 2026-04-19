---
id: task.0331
type: task
title: "Wallet analysis Part 3 — Monitored Wallets row → drawer with prefetch"
status: needs_design
priority: 2
rank: 5
estimate: 2
created: 2026-04-19
updated: 2026-04-19
summary: "Click a Monitored Wallets row to open a Sheet drawer rendering WalletAnalysisView in drawer variant. Prefetch on pointer-enter / focus / touch-start. Deep-link via ?w=0x… query param."
outcome: "From /dashboard, clicking any roster row opens a slide-over with identity + stats + balance + last 5 trades for that wallet. Prefetched rows open in ≤ 200 ms (desktop) / ≤ 400 ms (touch + simulated 3G)."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0330]
deploy_verified: false
labels: [poly, wallet-analysis, ui]
---

# task.0331 — Wallet Analysis: Monitored-Wallets Drawer (Part 3)

## Problem

The data plane and components exist (tasks 0329 + 0330). Now wire selection: clicking a row in the Monitored Wallets table on `/dashboard` should open a drawer rendering the analysis for that wallet, fast.

## Scope

In:

- Add `drawer` variant to `WalletAnalysisView`: identity + stats + balance + RecentTradesTable (last 5)
- `TopWalletsCard` row `onClick` → opens shadcn `Sheet` (already vendored at `components/vendor/shadcn/sheet.tsx`)
- Row `onPointerEnter` + `onFocus` + `onTouchStart` (debounced 50 ms) → `queryClient.prefetchQuery` for snapshot + trades slices
- `?w=0x…` query param: opens drawer on mount; closing drawer clears the param
- Drawer header has "Open in page →" link to `/research/w/[addr]`
- Component test: prefetch fires on each input modality

Out:

- `compact` variant (no caller yet)
- vNext copy-trade CTA
- Mobile-narrow-viewport sheet-vs-modal call (decide in implementation; not a design surface)

## Validation

- [ ] Row click opens the drawer.
- [ ] Pointer-enter / focus / touch-start each fire one prefetch (debounced).
- [ ] Prefetched row opens drawer interactive in ≤ 200 ms on desktop.
- [ ] Touch + simulated 3G: ≤ 400 ms.
- [ ] `?w=0x331b…` deep-link opens drawer on initial render.
- [ ] Closing drawer (Esc / click-out / X) clears `?w=` from URL.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs` all clean.

## Out of Scope

Anything not enumerated above. vNext copy-trade-CTA filed when its blockers (Harvard-dataset storage decision; admin-role definition) resolve.
