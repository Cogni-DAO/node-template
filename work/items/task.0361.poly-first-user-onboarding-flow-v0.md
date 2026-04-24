---
id: task.0361
type: task
title: "Poly — first-user onboarding flow v0 (sign-on → provision → fund → select targets)"
status: needs_implement
priority: 0
rank: 1
estimate: 3
created: 2026-04-23
updated: 2026-04-23
summary: "Stitch the disjoint poly pieces (sign-on, Privy wallet provisioning via task.0318, funding, Enable Trading approvals via task.0355, target selection via /research) into one continuous, scrappy end-to-end onboarding flow that an external aspiring user can walk through without Derek on the call. No new capabilities — only flow, routing, copy, empty states, and missing glue UI. Poly-specific; do NOT extract reusable primitives for other nodes yet (Node #2 consumer does not exist)."
outcome: "One real non-Derek user — the aspiring poly user Derek has lined up — completes the full flow unaided: signs in, provisions a Privy trading wallet, funds it with USDC.e + POL, enables trading (token approvals), selects at least one target wallet to copy-trade, and sees their first mirrored fill appear in their dashboard. Observed by Derek (concierge) for the first run, confirmed in Loki at the deployed candidate-a SHA. This is the project's MVP validation gate — the first time anything Cogni has built is used end-to-end by someone other than Derek."
spec_refs:
  - docs/spec/poly-multi-tenant-auth.md
  - docs/spec/poly-trader-wallet-port.md
assignees: []
credit:
project: proj.poly-copy-trading
branch: design/task-0361-poly-first-user-onboarding-v0
pr:
reviewer:
revision: 0
blocked_by: []
labels:
  [poly, onboarding, ui, mvp, first-user, deploy-verified, user-validation]
---

# task.0361 — Poly first-user onboarding flow v0

## Context

**This is the MVP validation gate for the entire Cogni project.** Per constraint evaluation 2026-04-23 (Eval #5c, `work/charters/CONSTRAINTS.md`), the binding constraint is M03 (zero validated end-to-end user flows). Derek has one aspiring poly user lined up. Until that person walks the full flow unaided, every other project investment is faith-based.

Almost every _capability_ needed already exists, landed across the last month's commits — but the **flow** does not. Today a real user hits disjoint pages, empty states, and dead-ends between steps. The job of this task is not to build new capabilities; it is to make the existing capabilities feel like one thing.

## Problem

An aspiring user arriving at candidate-a today cannot self-serve. Concretely, the flow breaks at the seams:

| Step                          | Capability shipped                                                  | Flow shipped?                                                              |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Sign on                    | ✅ existing auth                                                    | ✅ but no post-sign-on routing toward poly                                 |
| 2. Provision trading wallet   | ✅ task.0318 Phase B (`/api/v1/poly/wallet/connect`, Privy custody) | ❌ no visible call-to-action; buried on Money page                         |
| 3. Fund wallet (USDC.e + POL) | ✅ wallet address shown on Money page                               | ❌ no copy/instructions for a user who has never bridged to Polygon before |
| 4. Enable Trading (approvals) | 🟡 task.0355 (PR #992) in review                                    | 🟡 1-click modal exists but isn't wired into an onboarding sequence        |
| 5. Select target wallet(s)    | ✅ `/research` wallet browse + clickable rows                       | ❌ no link from onboarding; user has to discover `/research` themselves    |
| 6. See first mirrored fill    | ✅ per-tenant trade execution (task.0318 Phase B3)                  | ❌ no "you're live — watch here" confirmation state                        |

Every individual piece works. None of them point to the next one.

## Scope

**In (poly-specific, not reusable):**

- **Single `/onboarding` entry point** (Next.js route in `apps/operator/app/onboarding/` or wherever fits existing route structure): one page that renders the current step based on wallet state, with clear copy, a single CTA per step, and next/prev forward-only progression. No wizard framework — one component with 5 conditional blocks is fine.
- **Step state derived from real wallet state**, not a separate onboarding-progress table. Use existing `poly.wallet.status.v1` signal + `TradingApprovalsState` + tracked-wallet count to compute current step. No new DB tables.
- **Funding step copy + checklist.** Clear instructions: "Send USDC.e to `0x…` on Polygon. You also need ~0.2 POL for gas. Here's a Bridge link ([Polygon Portal](https://portal.polygon.technology/bridge)). We'll detect the funds and advance automatically." Include pasteable address + QR code. Poll wallet balance every 10s; auto-advance when USDC.e > $1 and POL > 0.1.
- **Enable Trading step** reuses task.0355 1-click modal verbatim.
- **Target selection step** is a thin wrapper around existing `/research` wallet browse: user picks ≥1 wallet, clicks "Copy these wallets", we register copy-trade targets, advance.
- **Confirmation step**: "You're live. Watch for your first fill on the [Dashboard](/dashboard)." Link directly to dashboard.
- **Dashboard empty state** update: when user has copy-targets but zero fills yet, show "Waiting for your first mirrored fill. Targets: [list]. This can take minutes to hours depending on target activity." — so the user isn't staring at a blank page.
- **Post-sign-on routing**: if user has no wallet connected, redirect to `/onboarding`. If wallet exists but not all steps complete, deep-link to the right step.
- **One-line copy/content pass** across all 5 steps so it reads as one voice, not disjoint page titles. Derek can sharpen the copy; this task's author should write a first pass.

**Explicitly OUT of scope:**

- Reusable onboarding components for other nodes (resy, ai-only canary). Wait for Node #2 consumer to exist (per `proj.ci-cd-reusable` Paused gate applied generally).
- Any polish beyond "a non-technical user can finish without assistance."
- Tracking/analytics instrumentation (deferred to post-first-user).
- Multi-user onboarding concurrency concerns.
- Password reset / account recovery / edge cases.
- New capabilities — if something doesn't work today, file a separate bug, don't fix it in this task.
- Funding UX that actually does the bridge (just pointer + polling is enough for v0).

## Validation

**This task's `deploy_verified: true` gate IS the MVP validation gate for the project.**

- `exercise:` Derek's aspiring poly user completes the full flow on candidate-a — signs in, provisions wallet, funds with real USDC.e + POL on Polygon mainnet, enables trading (approvals land on-chain), selects ≥1 target wallet from `/research`, and sees their first mirrored fill appear on the dashboard. Derek watches (screen-share or in-person) but does not touch keyboard.
- `observability:` Loki query confirms the user's request path at the deployed SHA: sign-on → `connect` → `enable-trading` → copy-trade target insert → first `mirror-fill` entry for their `billing_account_id`. Include the user's anonymized `billing_account_id` and the candidate-a SHA in the PR comment.

If anything breaks mid-flow for this user, the break is not a concierge-fix-and-move-on — it's a gating bug to be filed and resolved before this task closes. The whole point is "works unaided."

## Execution notes for the next dev

1. Read Derek's aspiring-user context first. What's their Polygon/crypto fluency level? That dictates the funding-step copy.
2. **Walk the current flow yourself as a new user** before touching code. Wipe your session, sign in from scratch on candidate-a, try to provision + fund + enable + copy. Write down exactly what you had to know-from-outside-the-UI to complete each step. That list is your scope.
3. Scrappy means scrappy: one route, one component, shadcn defaults, Tailwind classes inline. No design system extraction. No new packages.
4. Poll-based state detection (10s interval) is fine for funding + approvals steps; no websockets needed. Use TanStack Query with `refetchInterval`.
5. If you find yourself adding a new capability (new API route, new port method, new DB column) — STOP. That's out of scope. File a bug, land onboarding around the gap, ship.
6. Aim: land PR within 3-5 days of starting. Concierge user through it within 7.

## Design

### Outcome

One real non-Derek user walks sign-on → fund-and-trade on a single page (`/credits`) → pick targets on `/research` → first mirrored fill on `/dashboard`, unaided. No new route, no wizard, no new capabilities — just delete the dead-end bounce and let the Money page progressively reveal the steps as wallet state evolves.

### Approach

**Solution**: Collapse the flow onto existing pages. Make `/credits` the single page that hosts the entire wallet lifecycle (create → fund → enable → trade), and make `/dashboard` the post-sign-on landing hub that points users at `/credits` and `/research` when they haven't completed those steps.

Concretely:

1. **Move `TradingWalletConnectFlow` (create-wallet + caps sliders) from `/profile` into `credits/TradingWalletPanel`.** When `status.configured=true && !status.connected`, `TradingWalletPanel` renders the connect flow in place of today's "Create a wallet in Profile → [Profile]" dead-end button. On success, the same panel mounts balances + `TradingReadinessSection` + fund/withdraw stubs — no navigation. This is the heart of the task.

2. **Remove the trading-wallet row from `/profile` entirely.** Profile is identity (display name, avatar, OAuth, AI providers, ownership). Money lives on `/credits`. Leaving it in two places was the original bug. `/profile` loses ~100 lines; `TradingWalletConnectFlow` + `GrantCapSlider` move into `nodes/poly/app/src/app/(app)/credits/TradingWalletConnectFlow.tsx`.

3. **Tighten funding copy on `TradingWalletPanel`.** After connect, the USDC.e/POL balance row gets a one-line sub-caption with two external links: "Send USDC.e on Polygon (any wallet or [Polygon Portal bridge](https://portal.polygon.technology/bridge)). Needs ~0.2 POL for gas." Polls already in place (20s `refetchInterval`). No new API, no auto-advance logic — the CTAs on the page already gate correctly (Enable Trading needs POL ≥ 0.1; trade execution needs USDC.e; both enforced by existing components).

4. **Dashboard = hub.** Add a single `OnboardingHint` strip at the top of `DashboardView` that renders conditionally on the same `poly-wallet-status` + `poly-wallet-balances` + `dashboard-copy-targets` React Queries already in flight:
   - no wallet → "Set up your trading wallet →" → `/credits`
   - wallet but `!trading_ready` → "Enable trading →" → `/credits`
   - trading-ready but 0 copy-targets → "Pick a wallet to copy →" → `/research`
   - copy-targets but 0 fills → "Waiting on your first mirrored fill from [targets]…" (no link, informational)
   - otherwise: hide. One component, five branches, ~60 LOC. Sits above `TradingWalletCard` so it's the first thing a first-time user sees.

5. **No post-sign-on redirect.** Users land on `/dashboard` as today; the hint strip pulls them to the right page. Simpler than routing middleware; keeps the dashboard as the "home" affordance.

6. **No new `/onboarding` route, no wizard component, no onboarding-progress table, no poll-and-advance state machine.** Wallet state already IS the onboarding state; the UI just reads it.

**Reuses**:

- `TradingWalletConnectFlow` + `GrantCapSlider` (from `profile/view.tsx`, moved verbatim)
- `TradingReadinessSection` (already in `TradingWalletPanel`, task.0355)
- `poly.wallet.status.v1`, `poly.wallet.balances.v1`, `poly.wallet.enable-trading.v1` contracts
- Existing React Query keys `poly-wallet-status`, `poly-wallet-balances`, `dashboard-copy-targets`
- shadcn/ui + Tailwind inline — no new design system primitives

**Rejected**:

- **Dedicated `/onboarding` route with 5-step conditional render (the task's original scope).** Duplicates state the Money page already computes; adds a route and component shell for zero user-visible value. The whole point of MVP-scrappy is not building a second surface.
- **Wizard framework (e.g. `react-stepper`).** Two steps (create, enable) plus informational fund-waiting state. Not five. Not a wizard.
- **New `poly_onboarding_progress` table + server state machine.** Wallet state already answers "what step are you on?" via `status.v1` + `balances.v1` + copy-targets count. Adding a table re-derives state that already exists in the DB.
- **Post-sign-on redirect middleware** (`/dashboard` → `/credits` when no wallet). Pulls users away from the hub before they see the rest of the product; makes /dashboard feel gated. The hint strip is the softer, more legible nudge.
- **Reusable `<OnboardingChecklist />` primitive for other nodes.** Explicitly out of scope (Node #2 consumer does not exist; per project charter).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_NEW_CAPABILITIES — no new API routes, port methods, DB columns, or contracts (spec: task scope)
- [ ] NO_URL_RENAME — `/credits` route stays stable (spec: `credits/CreditsPage.client` invariant)
- [ ] ENABLE_TRADING_VISIBLE — `TradingReadinessSection` remains the primary above-the-fold CTA when connected && !trading_ready (spec: `TradingWalletPanel`)
- [ ] PROFILE_IS_IDENTITY_ONLY — `/profile` owns identity (name, OAuth, AI providers, ownership); wallet lifecycle lives on `/credits`
- [ ] STATE_DRIVEN_UI — step a user is "on" is derived from `poly.wallet.status.v1` + `balances.v1` + copy-target count; no onboarding-progress persistence
- [ ] POLY_SPECIFIC — no shared/extracted onboarding primitives (wait for Node #2)
- [ ] SIMPLE_SOLUTION — leverages existing components/queries over bespoke code (spec: architecture)
- [ ] ARCHITECTURE_ALIGNMENT — client components under `nodes/poly/app/src/app/(app)/…`; contracts via `@cogni/node-contracts` (spec: architecture)

### Files

- **Create**: `nodes/poly/app/src/app/(app)/credits/TradingWalletConnectFlow.tsx` — moved from `profile/view.tsx`; exports `TradingWalletConnectFlow` and its internal `GrantCapSlider`. ~130 LOC relocation, no logic change.
- **Modify**: `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx` — replace the `!connected` branch (currently a link to `/profile`) with an inline render of `TradingWalletConnectFlow`; on `onConnected`, invalidate `poly-wallet-status` so the panel flips to the balances/enable-trading view without a reload. Add funding sub-caption with Bridge + USDC.e links beneath the balance grid.
- **Modify**: `nodes/poly/app/src/app/(app)/profile/view.tsx` — delete `TradingWalletConnectFlow`, `GrantCapSlider`, the Polymarket Trading Wallet `SettingRow`, and all related `tradingWallet*` state + fetch. Profile drops to identity + OAuth + AI providers + ownership.
- **Create**: `nodes/poly/app/src/app/(app)/dashboard/_components/OnboardingHint.tsx` — single 5-branch strip reading wallet status + balances + copy-target count; renders one CTA or hides. ~60 LOC.
- **Modify**: `nodes/poly/app/src/app/(app)/dashboard/view.tsx` — mount `<OnboardingHint />` at the top of the flex column, above `TradingWalletCard`.
- **Modify**: `nodes/poly/app/src/app/(app)/dashboard/_components/CopyTradedWalletsCard.tsx` — if already has a "no copy-trades yet" empty state, tighten copy to "Waiting for your first mirrored fill. Targets: […]"; if not, add one. (Verify during implement — don't add duplicate state.)
- **Test**: `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.test.tsx` (component) — disconnected state renders the connect flow inline; after mocked `onConnected`, balances branch renders. Keep small; this is a smoke test, not a re-test of the moved component.
- **Test**: `nodes/poly/app/src/app/(app)/dashboard/_components/OnboardingHint.test.tsx` — five-state snapshot: no-wallet / not-trading-ready / no-targets / awaiting-first-fill / hidden.

Out-of-scope deletions (file on sight, don't fix here): funding auto-advance polling, bridge-UX inside app, target-selection wrapper on `/research` (the existing clickable rows on `/research` are good enough for v0 — user picks a wallet row, that adds a copy-target, they come back to `/dashboard`).

## Worktree

`/Users/derek/dev/cogni-template-task-0361-poly-onboarding-v0` (created 2026-04-23, branched off main).
