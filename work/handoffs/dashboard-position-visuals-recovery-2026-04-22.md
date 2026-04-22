# Dashboard Position Visuals Recovery

Recovered on 2026-04-22 from the crashed Codex run that worked on `feat/dashboard-position-visuals`.

## Pointers

- Worktree: `/Users/derek/dev/cogni-template-worktrees/feat-dashboard-position-visuals`
- Branch: `feat/dashboard-position-visuals`
- Head: `ffa0c325c844dce51b64451a314fc5cd1325edd2`
- Draft PR: `#985`
- Codex session with the redesign pass: `/Users/derek/.codex/sessions/2026/04/22/rollout-2026-04-22T00-50-21-019db386-6115-7e93-83c0-c4fa75c8e4aa.jsonl`

## Recovered Thinking

These points are directly supported by the crashed session's agent messages and command traces:

- The existing row timeline was acknowledged as structurally wrong for open positions. `positions` gives current open state and pricing, but not lifecycle. A green close marker on open rows is incorrect.
- The chart model needs two upstream sources:
  - Data API `positions` plus `trades` for lifecycle semantics: entry, adds, exits, open vs closed vs redeemed.
  - CLOB public `prices-history` for the actual curve between those lifecycle events.
- The intended fixture architecture was:
  - Raw Data API/CLOB snapshots on disk.
  - One pure mapper that turns those snapshots into a chart-ready `WalletPosition`.
  - A dumb chart component that only renders the mapped shape.
- Market links should not be guessed from title text. The recovered plan was to resolve `eventSlug` from public Data API position/trade payloads and build the real Polymarket `/event/...` URL from that.
- The chosen representative fixture set was:
  - `open_trump_2028_yes`
  - `closed_aston_villa_yes_roundtrip`
  - `resolved_trail_blazers_spurs_total_over`

## Recovered Fixtures

Recovered fixture targets were replayed and written to:

- `docs/research/fixtures/poly-dashboard-position-timelines/open_trump_2028_yes.json`
- `docs/research/fixtures/poly-dashboard-position-timelines/closed_aston_villa_yes_roundtrip.json`
- `docs/research/fixtures/poly-dashboard-position-timelines/resolved_trail_blazers_spurs_total_over.json`
- `docs/research/fixtures/poly-dashboard-position-timelines/manifest.json`

`manifest.json` records the regenerated timestamps and summary counts.

## Important Caveat

The session JSONL preserved the agent's reasoning and command inputs, but the largest fixture stdout dump was truncated in-chat. Because of that, the raw JSON fixture files above were regenerated from the exact recovered sample IDs, wallets, assets, and endpoints from the crashed session.

One nuance from the replay: `closed_aston_villa_yes_roundtrip` still has the intended buy/sell trade history and `eventSlug`, but `closed-positions` no longer returns a matching snapshot row, so that fixture currently has `closedPosition: null`. Treat it as a valid round-trip trade fixture, not a full closed-position snapshot.

## Suggested Next Step

Resume from fixtures first, not live UI wiring:

1. Add a pure mapper from these raw fixture files to a first-class chart model.
2. Define explicit visual rules for `open`, `closed`, and `redeemed` rows.
3. Replace the inline sparkline with an interactive chart that uses the mapped lifecycle plus CLOB history and only renders a close marker when the position is actually closed.
