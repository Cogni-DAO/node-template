---
id: task.0333
type: task
title: "Wallet analyst agent — AI qualitative judgments, Dolt-stored, DAO-funded"
status: needs_design
priority: 2
rank: 5
estimate: 5
created: 2026-04-20
updated: 2026-04-20
summary: "Click a wallet, trigger an AI analyst run funded by the DAO system account. The graph writes a qualitative judgment (edge hypothesis, category specialty, risk flags) with a confidence score into a Dolt-backed poly_wallet_analyses table. Future runs refine the entry via Dolt diffs. Deterministic number slices (WR/ROI/DD) stay cache-only — no Postgres snapshot table."
outcome: "/research/w/[addr] has an Analyze button. Clicking it spends DAO credits to run poly-brain's wallet-analyst graph. The resulting record lands as a Dolt row visible in the page's EdgeHypothesis + risk-flag molecules. Re-runs land as new Dolt rows and the UI surfaces the diff + authorship. Checkpoint B's Postgres snapshot table is deleted from scope."
spec_refs:
  - docs/design/wallet-analysis-components.md
  - docs/spec/databases.md
  - docs/spec/knowledge-data-plane.md
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0329]
deploy_verified: false
labels: [poly, wallet-analysis, ai, dolt, agent, copy-trading]
---

# task.0333 — Wallet Analyst Agent + Dolt Store

## Problem

task.0329 shipped the `WalletAnalysisView` component surface and the design for Checkpoint B called for a `poly_wallet_screen_snapshots` Postgres table seeded from a JSON fixture. That's wrong:

- **Numbers (WR / ROI / DD / trades-per-day / median hold) are deterministic** — pure functions of `{ user trades, resolution outcomes }` pulled from the public Polymarket Data-API + CLOB. Persisting them in Postgres duplicates work the network can do; the right caching layer is in-process TTL.
- **Analysis (edge hypothesis, category-specialty label, risk flags, copy-tradeability verdict) is analyst judgment** — non-deterministic, authorship-relevant, refinable over time. That's exactly Dolt's domain: versioned rows, commit history, blame, diffs.
- Hand-authored BeefSlayer prose inlined in `view.tsx` doesn't scale past one wallet. Every subsequent wallet needs an equivalent judgment; users won't author those by hand.

## Approach

Two parallel tracks; one PR if they fit, two if not.

### Track 1 — Drop the Postgres snapshot; compute + cache numbers

- Delete the `poly_wallet_screen_snapshots` DDL + seed-script sections from the Checkpoint B scope on task.0329 / `docs/design/wallet-analysis-components.md`.
- `GET /api/v1/poly/wallets/[addr]?include=snapshot` is now a **compute** endpoint, not a DB read:
  - Fetch `/trades?user=` via `PolymarketDataApiClient`.
  - Fetch resolved markets via CLOB `/markets/{conditionId}` (shared disk-cache keyed by cid; resolution is immutable once `closed=true`).
  - Compute WR / realized ROI / round-trip PnL / max-DD / median-duration — the same math already implemented in `scripts/experiments/wallet-screen-resolved.ts`, extracted into a package function under `packages/market-provider/src/analysis/`.
  - Cache the resulting snapshot object in a module-scoped `Map` (30 s TTL for the numbers, since upstream trades refresh at that cadence; the market-resolution cache is per-cid and immutable-TTL).
- Fixture JSON (`docs/research/fixtures/poly-wallet-screen-v3-*.json`) remains **documentation + research artifact**, not a DB seed.

### Track 2 — Dolt-backed qualitative analysis

- New Dolt table **`poly_wallet_analyses`** (per-node DB; co-located with other poly Dolt tables per `docs/spec/databases.md`):

  | column              | type         | notes                                                |
  | ------------------- | ------------ | ---------------------------------------------------- |
  | `wallet`            | text         | lowercased 0x address — NOT PK alone                 |
  | `author`            | text         | `agent:wallet-analyst:v1` \| `user:<uid>`            |
  | `created_at`        | timestamptz  | row insert time                                      |
  | `category`          | text NULL    | detected specialty (weather, esports, NBA, tech, …)  |
  | `verdict`           | text         | `roster` \| `watchlist` \| `avoid` \| `unknown`      |
  | `hypothesis_md`     | text NULL    | markdown prose                                       |
  | `flags`             | jsonb        | `{harvard_flagged: bool, bot_likelihood: 0..1, …}`   |
  | `confidence`        | numeric(3,2) | 0.00–1.00; agent self-reports                        |
  | `input_sha`         | text         | sha256 of the input trades + resolutions; dedupe key |
  | `credit_receipt_id` | text NULL    | pointer to the billing row for this run              |

  PK: `(wallet, created_at, author)`. Dolt commit per insert. Latest-wins for UI read; history visible on demand.

- New graph **`poly-brain::wallet-analyst`** — a specialized variant of poly-brain with tools narrowed to: `polymarket_trades`, `polymarket_positions`, `polymarket_resolution`, and `knowledge_search` (Harvard-flagged-dataset lookup if/when it lands). System prompt is a structured scorecard template that outputs into the table shape above.
- Graph funded from the **DAO system account** — the operator credit pool, not the per-user credit balance. This is a "free-at-point-of-use, DAO-underwritten" action for v0; a per-user rate limit protects the pool.
- **API surface:**
  - `POST /api/v1/poly/wallets/{addr}/analyses` — trigger a new analyst run; returns `{ runId }` streaming status. Idempotent on `input_sha` (no cost if inputs unchanged from the last row for the same `author`).
  - `GET /api/v1/poly/wallets/{addr}/analyses` — returns the latest row + count + history pointer. Zod contract in `src/contracts/http/poly.wallet-analysis.v1.contract.ts` (extend Checkpoint B's contract).
- **UI wiring** (lands on the existing `WalletAnalysisView` molecules, no new components):
  - `EdgeHypothesis` renders `latest.hypothesis_md` when present; falls back to an "Analyze this wallet" CTA (uses the `CopyTradeCTA` slot in the design but is its own button).
  - New `AnalystFlagRow` molecule surfaces the `flags` jsonb (harvard-flagged pill, bot-likelihood bar, etc.) with the confidence score and commit-author chip.
  - "Refine analysis" CTA visible when the latest row's `input_sha` diverges from the current compute (i.e., new trades have arrived since the last analyst run).

### What Dolt gives us that Postgres wouldn't

- **Authorship + history** — every analysis row is a commit; `git blame`-equivalent shows who said what, when.
- **Diffs across refinements** — when an agent re-analyses a wallet, the UI can render "what changed" — new flags, verdict flipped, confidence moved.
- **Branching for experiments** — a new graph version can write to its own branch; A/B comparisons are cheap.
- **Cheap retroactive backfill** — a structured prompt improvement can re-run over all prior wallets into a new branch, compared against the main branch, then merged (or not).

## Validation

- [ ] `poly_wallet_screen_snapshots` is **not** a Postgres table in any migration. Numbers are computed + cached per Track 1.
- [ ] `poly_wallet_analyses` Dolt table exists; schema matches; a test inserts a row, Dolt commits, latest-read returns it.
- [ ] `POST /api/v1/poly/wallets/{addr}/analyses` runs the graph end-to-end and lands one new row with a credit_receipt linked to the DAO system account.
- [ ] Idempotent on `input_sha`: a second POST with unchanged inputs returns the existing row + spends zero credits.
- [ ] `/research/w/[addr]` on an unanalysed wallet shows the CTA. Click → spinner → row lands → `EdgeHypothesis` + `AnalystFlagRow` render.
- [ ] For BeefSlayer specifically: seed Dolt with the hand-authored hypothesis + Harvard-flagged-false flag as the v1 manual entry (`author: user:derekg1729`). UI shows it without requiring an agent run.
- [ ] `/research` BeefSlayer hero renders the same hypothesis via the same Dolt read path — the inline fallback prop from task.0329 is deleted.
- [ ] Per-user rate limit on `POST .../analyses` (e.g., 20/hour) protects the DAO credit pool.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs` clean.

## Open questions

1. **Which Dolt branch for v0?** Recommend `main` for the manual BeefSlayer seed; open a `agent/wallet-analyst` branch on first AI run and merge-on-validate. Decide in implementation.
2. **Confidence calibration** — the agent self-reports `0..1`. Calibrate against hand-ranked examples before trusting UI affordances keyed on confidence thresholds.
3. **Per-user rate limit storage** — simplest path: reuse the existing credit ledger's rate-limit middleware if it exists; else a Redis-free in-memory rolling window keyed by user_id.

## Out of Scope

- Copy-trade CTA (still vNext, still blocked on Harvard-flagged storage + admin-role decisions).
- Autonomous re-analysis on a schedule. v0 is user-initiated only.
- Cross-wallet analysis ("compare these three wallets") — separate work.
- Surfacing Dolt diffs in the UI. v0 shows latest-wins; diff viewer is follow-up.
