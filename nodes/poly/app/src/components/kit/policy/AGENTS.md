# kit/policy · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Presentational UI for trading-policy controls — the user-facing surface over `polyWalletGrants` (per-trade / per-day caps) and `polyCopyTradeTargets` (per-target active flag). Composes into the Money page (editable global) and Research wallet detail (readonly caps + active toggle). No fetching, no DB awareness, no business logic — pure props in, callback out.

## Pointers

- [Root AGENTS.md](../../../../../../AGENTS.md)
- [task.0347 — Minimal policy UI](../../../../../../work/items/task.0347.poly-wallet-preferences-sizing-config.md)
- [proj.poly-bet-sizer](../../../../../../work/projects/proj.poly-bet-sizer.md)
- [Sketch + current state](../../../../../../docs/design/poly-policy-ui/)
- [UI Implementation Guide](../../../../../../docs/spec/ui-implementation.md)

## Boundaries

```json
{
  "layer": "components",
  "may_import": ["shared", "types"],
  "must_not_import": [
    "app",
    "features",
    "core",
    "ports",
    "adapters",
    "bootstrap"
  ]
}
```

## Public Surface

- **Exports:**
  - `PolicyControls` — two-row caps editor (`Per trade`, `Per day`). Editable mode owns draft state + validates `daily >= per_order`; readonly mode renders the values + `Edit on Money →` link.
  - `TargetActiveToggle` — single-row enable/disable button for one copy-trade target. `active` prop is the source of truth; `onToggle` Promise rejection silently reverts.

## Conventions

- Both components are pure-props/callback; never own fetch, never import from `app/` or `features/`.
- Numeric inputs use `inputMode="decimal"`, NOT `type="number"` — the spinner UI is wrong for cents-precision USDC values.
- Save/toggle promise rejection contracts are documented per-component in their TSDoc headers; parents translate route errors into typed reject reasons.
- Visual idiom matches the existing Money page balances row (`bg-muted/40 px-3 py-2`, mono uppercase labels, tabular-nums values) — see `app/(app)/credits/TradingWalletPanel.tsx` for the parent card style.

## Responsibilities

- Own the visual + interaction layer for the policy surface.
- Stay testable in isolation — render with fixture props, assert callback shape.
- NOT in scope: API routes, React Query wiring, RLS, schema. Those live in `app/(app)/credits/` (Money page) and `features/wallet-analysis/` (Research detail) per task.0347.

## Notes

- Caps editor uses numeric inputs, not sliders — caps have no natural anchor (range $0 → $∞). Sliders return for the v2 allocation-% surface where the range is implicitly 0-100%.
- The Input kit primitive is intentionally NOT used here: its CVA-only style contract conflicts with the bare borderless inline-edit treatment this surface needs. Raw `<input>` is fine within a single, audited kit family.
