---
id: task.0429
type: task
title: "Poly auto-wrap consent loop — one click, perpetual cash recycling"
status: needs_implement
priority: 1
rank: 5
estimate: 5
created: 2026-04-29
updated: 2026-04-29
summary: "User clicks 'Enable auto-wrap' once on the Money page. From then on, the poly node autonomously wraps idle USDC.e at the funder address into spendable pUSD whenever the balance crosses a floor — closing the deposit / V1-redeem / direct-transfer loops without further user clicks. Adds `auto_wrap_consent_at` + `auto_wrap_floor_usdce_6dp` to `poly_wallet_connections`, exposes `wrap()` on `PolyTraderWalletPort`, runs a single-flight bootstrap job modeled on `order-reconciler.job.ts`, and ships a Money-page toggle."
outcome: "A user with a provisioned trading wallet flips the auto-wrap toggle on `/credits` once. After that, any USDC.e that lands at their funder address — from a fresh deposit, a V1 CTF redeem, or a manual transfer — is wrapped to pUSD within one tick of the auto-wrap job. The user never touches the trading wallet UI again to keep cash spendable; the agent's BUY orders no longer fail with `INSUFFICIENT_BALANCE` for predictable reasons."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - nodes/poly/packages/db-schema/src/wallet-connections.ts
assignees: []
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by: [bug.0428]
labels: [poly, wallet, wrap, consent, autonomy, ui, schema, job]
---

# task.0429 — Poly auto-wrap consent loop

## Problem

Today, on Polymarket, only **pUSD** can fund a CLOB BUY. USDC.e cannot. The conversion goes through `COLLATERAL_ONRAMP_POLYGON.wrap(USDC.e, funder, amount)` (`privy-poly-trader-wallet.adapter.ts:1308`). The wrap call is **embedded inside `ensureTradingApprovals`** — a 6-step ceremony the user runs once at provisioning time.

That ceremony is one-shot. It does not re-fire when fresh USDC.e arrives. So every time cash returns to the funder address through any of these channels, it stops being spendable until the user manually re-runs the approval flow:

| Channel | Token landed | Spendable today? |
|---|---|---|
| User funds wallet via `task.0352` Money-page flow | USDC.e | ❌ stuck until re-wrap |
| V1 CTF position redeems (legacy markets) | USDC.e (hardcoded `redeem-worker.ts:261`) | ❌ stuck until re-wrap |
| V2 CTF position redeems (post-`bug.0428`) | pUSD | ✅ spendable |
| External transfer to funder | USDC.e | ❌ stuck until re-wrap |

So three of four cash-return channels strand the funds. From the agent's perspective, BUY orders fail with `INSUFFICIENT_BALANCE` even though "the user has money" — the money is just on the wrong side of the wrap. The user has to notice, log in, and re-click the approval ceremony. That defeats the autonomous-trader product.

The fix is **a single user-granted consent** ("yes, please keep my idle USDC.e wrapped to pUSD automatically") plus a background job that honors it.

## Visual lifecycle — existing vs. proposed

### Existing (one-shot wrap; cash leaks back to USDC.e)

```
┌──────────┐  fund   ┌──────────────────┐
│  User's  │ ──────▶ │  funder_address  │  USDC.e
│  EOA     │         │  (Privy wallet)  │
└──────────┘         └────────┬─────────┘
                              │ ensureTradingApprovals (one-shot, USER CLICK)
                              ▼
                     ┌──────────────────┐
                     │  funder_address  │  pUSD
                     │  (post-wrap)     │
                     └────────┬─────────┘
                              │ CLOB BUY
                              ▼
                     ┌──────────────────┐
                     │  CTF positions   │
                     └────────┬─────────┘
                              │ market resolves → redeemPositions
                              ▼
                     ┌──────────────────┐  ◀── V1: USDC.e (stuck) ❌
                     │  funder_address  │  ◀── V2: pUSD (spendable) ✅  (after bug.0428)
                     └──────────────────┘                    ▲
                              │                              │
                              │ user must MANUALLY re-click  │
                              │ ensureTradingApprovals       │
                              ▼                              │
                          [stuck cash; agent BUYs fail] ─────┘
```

### Proposed (one consent; perpetual loop)

```
┌──────────┐  fund   ┌──────────────────┐
│  User's  │ ──────▶ │  funder_address  │  USDC.e
│  EOA     │         │  (Privy wallet)  │ ◀──────────────────┐
└──────────┘         └────────┬─────────┘                    │
                              │                              │
   ┌──────────────────────────┘                              │
   │  ┌─────────────────────────────────────────────────┐    │
   │  │  AUTO-WRAP JOB  (60s tick, single-flight)       │    │
   │  │  for each wallet WHERE auto_wrap_consent_at     │    │
   │  │    AND revoked_at IS NULL                       │    │
   │  │    AND USDC.e_balance ≥ auto_wrap_floor:        │    │
   │  │       call COLLATERAL_ONRAMP.wrap(...)          │    │
   │  └────────────────────────┬────────────────────────┘    │
   │                           ▼                             │
   │                  ┌──────────────────┐                   │
   └─────────────────▶│  funder_address  │  pUSD             │
                      └────────┬─────────┘                   │
                               │ CLOB BUY                    │
                               ▼                             │
                      ┌──────────────────┐                   │
                      │  CTF positions   │                   │
                      └────────┬─────────┘                   │
                               │ resolves → redeemPositions  │
                               ▼                             │
                      ┌──────────────────┐                   │
                      │  funder_address  │  USDC.e (V1)  ────┘  loop
                      │  (cash returns)  │  pUSD (V2)    ──────▶ already spendable
                      └──────────────────┘
```

**Invariant:** the loop is a **read-then-act** scan, not an event subscription. Every tick re-derives whether to wrap from current on-chain balance + current DB consent. There is no in-memory state to drift; no webhook to miss. This matches `order-reconciler.job.ts`.

## Scope

In:

1. **Schema migration** on `poly_wallet_connections`:
   - `auto_wrap_consent_at TIMESTAMPTZ NULL` — the consent grant moment. NULL = no consent.
   - `auto_wrap_consent_actor_kind`, `auto_wrap_consent_actor_id` — mirrors `custodial_consent_*` shape.
   - `auto_wrap_floor_usdce_6dp BIGINT NOT NULL DEFAULT 1000000` — minimum USDC.e (in 6-dp base units; default 1.00 USDC.e). Below this, skip the wrap to avoid gas-on-dust.
   - `auto_wrap_revoked_at TIMESTAMPTZ NULL` — explicit revoke marker independent of `revoked_at` (which kills the whole connection).

2. **Port surface** — add to `PolyTraderWalletPort`:
   - `wrapIdleUsdcE(billingAccountId): Promise<{ txHash, amountWrapped6dp } | { skipped: 'below_floor' | 'no_consent' | 'no_balance' }>`
   - `setAutoWrapConsent(billingAccountId, { actorKind, actorId, floor6dp? }): Promise<void>`
   - `revokeAutoWrapConsent(billingAccountId, { actorKind, actorId }): Promise<void>`
   - Adapter implementation extracts the wrap step out of `ensureTradingApprovals` into a reusable internal helper; `ensureTradingApprovals` calls the same helper to avoid drift.

3. **Background job** `auto-wrap.job.ts` in `nodes/poly/app/src/bootstrap/jobs/`:
   - Pattern: `setInterval` wrapping a pure `runAutoWrapTick(deps)`, exactly like `order-reconciler.job.ts:283-349`.
   - Single-flight: pod singleton + `POLY_ROLE=trader` + `replicas=1` (same gates as copy-trade-mirror).
   - Cadence: 60s. (Tunable via env; same as reconciler.)
   - Idempotent: the wrap call itself is naturally idempotent at the consent + floor + balance check; if a tx is already in-flight from a prior tick, the next tick sees lowered USDC.e and skips. No locking table needed for v0.
   - Tick body: `SELECT … FROM poly_wallet_connections WHERE auto_wrap_consent_at IS NOT NULL AND auto_wrap_revoked_at IS NULL AND revoked_at IS NULL`. For each, call `wrapIdleUsdcE`. Per-row errors caught + metered. Tick-level errors logged + countered, never escape the interval.

4. **REST + Zod contract** on the existing wallet-control surface:
   - `POST /api/v1/poly/wallet/auto-wrap/consent` — sets consent (body: `{ floor6dp? }`; defaults to schema default).
   - `DELETE /api/v1/poly/wallet/auto-wrap/consent` — revokes.
   - Both routes `auth: SIWE-bound to billing account`; both write through the port.
   - Contract file: `src/contracts/poly-wallet-auto-wrap.contract.ts` (Zod-first per CLAUDE.md).

5. **UI** — Money page (`/credits`) trading-wallet panel:
   - Toggle: "Auto-wrap idle USDC.e to pUSD". Off by default. Reads consent state from `getConnectionSummary` (extend its return shape).
   - Inline copy explains: "Polymarket can only spend pUSD. When this is on, we'll automatically convert any USDC.e that lands here — from deposits, market settlements, or transfers — into pUSD on a 1-minute schedule. You can turn this off any time."
   - Optional advanced: floor-amount input (default 1.00 USDC.e). v0 ships with floor hidden; expose only if a user asks.

6. **Observability**:
   - Log line `poly.auto_wrap.tick.completed` per tick: `{ scanned, wrapped, skipped_below_floor, skipped_no_balance, errors }`.
   - Per-wrap log `poly.auto_wrap.tx.submitted`: `{ billing_account_id, amount_6dp, tx_hash }`.
   - Per-wrap log `poly.auto_wrap.tx.confirmed` on receipt.
   - Counter `poly_auto_wrap_total{outcome}` (`wrapped|skipped|errored`).
   - Reuse existing `poly.ctf.*` log envelope shape.

Out of scope for this PR:

- **Auto-redeem** of resolved CTF positions to cash (separate concern; lives in the redeem worker).
- **Auto-bridge** Base USDC → Polygon USDC.e (no bridging in any current path; user-driven).
- **pUSD → USDC.e unwrap** (withdrawal flow lives in `task.0351`).
- **Any change to `ensureTradingApprovals` user-facing flow.** The auto-wrap job uses the same underlying contract call but does not re-run approvals — those are sticky on-chain.
- **bug.0428's redeem-token fix.** That ships in dev1's PR A first; this PR rebases on it.

## Dependencies

- **Hard:** bug.0428 must merge first. Without it, V2 redeems still land USDC.e, which means the auto-wrap job has to handle the V2 redeem path too — wasteful gas + worse UX (user briefly sees pUSD, then USDC.e, then pUSD again). With bug.0428 in, the auto-wrap job only services deposits + V1 redeems + ad-hoc transfers, which is the correct steady state.

## Validation

- **exercise:**
  1. On candidate-a, sign in as a user with a provisioned trading wallet and existing approvals.
  2. `POST /api/v1/poly/wallet/auto-wrap/consent` — expect 200 + consent timestamp echoed.
  3. Send 5 USDC.e to the funder address from an external wallet (Polygonscan tx).
  4. Wait ≤ 90s (one tick + slack).
  5. `GET /api/v1/poly/wallet/balance` — expect USDC.e ≈ 0, pUSD ↑ by ~5.
  6. `DELETE /api/v1/poly/wallet/auto-wrap/consent` — expect 204.
  7. Send another 5 USDC.e. Wait 120s. `GET /balance` — USDC.e still ≈ 5 (no auto-wrap; consent revoked).
- **observability:** `{job="poly-node-app", sha="<deployed_sha>"} |~ "poly.auto_wrap.tx.submitted"` — exactly one line at the deployed SHA whose `billing_account_id` matches mine, with `amount_6dp ≈ 5_000_000`. Followed by a `poly.auto_wrap.tx.confirmed` line. After revoke, no further `submitted` lines for me at the deployed SHA.

## Design

### Outcome

A user with a provisioned poly trading wallet flips one toggle and never has to re-run the wrap ceremony again — idle USDC.e at the funder address (from deposits, V1 redeems, transfers) is autonomously converted to spendable pUSD on a 60-second cycle. Closes the loop between **task.0352** (deposit), **task.0355** (one-shot approvals), **task.0357 / bug.0428** (redemption), and the agent's BUY path.

### Approach

**Solution**: extract the existing `submitCollateralWrap` helper out of `ensureTradingApprovals` into a port method `wrapIdleUsdcE`. Add `auto_wrap_consent_at` + `auto_wrap_floor_usdce_6dp` columns to `poly_wallet_connections`. Add a 60-second `auto-wrap.job.ts` modeled on `order-reconciler.job.ts` that scans consenting wallets, checks USDC.e balance against floor, and wraps. Add two REST routes (consent / revoke) on the existing `/api/v1/poly/wallet/*` surface with a Zod contract. Add a Money-page toggle.

**Reuses**:

- `COLLATERAL_ONRAMP_POLYGON.wrap(...)` call already present at `privy-poly-trader-wallet.adapter.ts:1308-1330` — extract and reuse, do not duplicate.
- `setInterval` + pure-tick + pod-singleton + `POLY_ROLE=trader` job pattern from `order-reconciler.job.ts:283-349` and `copy-trade-mirror.job.ts`.
- `custodial_consent_*` column trio shape from `poly_wallet_connections` for the new `auto_wrap_consent_*` columns — same actor_kind / actor_id / timestamp triple, no new pattern.
- AEAD envelope, RLS contract, port wiring, container, and connection lookup paths from `task.0318` — no new infra primitives.
- `getConnectionSummary` return shape — extend with `autoWrapConsentAt` so the existing UI fetcher already covers reads.

**Rejected**:

- _Event-driven (subscribe to USDC.e Transfer logs at the funder address)_: introduces an RPC-websocket / log-indexer dependency for ~zero latency win on a 60s product cycle. Adds a new failure surface (websocket reconnect, log-replay). Scan-based read-then-act is the simpler primitive and matches `order-reconciler.job.ts`.
- _Bundle into `ensureTradingApprovals` re-runs (just fire the whole 6-step ceremony every minute)_: re-runs all 6 transactions (5 are no-ops on-chain, 1 is the wrap) — wastes gas on approval-state reads, adds 5x the failure surface, and conflates "first-time setup" with "ongoing housekeeping". The wrap is the only step that has a recurring trigger; isolate it.
- _Sweep-job that consumes a `poly_auto_wrap_jobs` queue table_: adds a row-allocator + claim/lifecycle complexity. The job is naturally idempotent (next tick re-derives from on-chain balance), so a queue is over-engineering. Skip per **REJECT_COMPLEXITY**.
- _New shared package_: the auto-wrap job is node-local runtime wiring, depends on `@cogni/poly-db-schema` + `@cogni/db-client`, and has only one runtime (the poly node app). Per `packages-architecture.md` boundary placement, it stays in `nodes/poly/app/src/`. The new port methods (`wrapIdleUsdcE`, `setAutoWrapConsent`, `revokeAutoWrapConsent`) extend the existing `PolyTraderWalletPort` in `packages/poly-wallet/` — not a new port.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] APPROVAL_TARGETS_PINNED — `wrapIdleUsdcE` calls only the pinned `COLLATERAL_ONRAMP_POLYGON` address; no caller-supplied targets. (spec: `poly-trader-wallet-port.md`)
- [ ] NO_GENERIC_SIGNING — the new port method emits exactly the same single pinned `wrap(...)` call already in `submitCollateralWrap`; not a general signer. (spec: `poly-trader-wallet-port.md`)
- [ ] VENDOR_CONTAINMENT — Privy SDK access stays inside `PrivyPolyTraderWalletAdapter`; the job, route, and UI talk through the port only. (spec: `poly-trader-wallet-port.md`)
- [ ] CONTRACTS_FIRST — `src/contracts/poly-wallet-auto-wrap.contract.ts` defines request/response shapes; routes use `z.infer<>`. (spec: `CLAUDE.md`)
- [ ] HEXAGONAL_BOUNDARIES — port additions in `packages/poly-wallet/`; adapter impl in `nodes/poly/app/src/adapters/server/wallet/`; job in `nodes/poly/app/src/bootstrap/jobs/`. (spec: `architecture.md`, `packages-architecture.md`)
- [ ] SINGLE_FLIGHT_JOB — the job runs only when `POLY_ROLE=trader` and pod singleton claim succeeds, mirroring `copy-trade-mirror.job.ts`. (spec: `poly-copy-trading` skill)
- [ ] DUST_GUARD — wrap only when `usdcE_balance >= auto_wrap_floor_usdce_6dp` (default 1.00 USDC.e). Prevents gas-on-dust drain. (spec: this work item, `## Scope`)
- [ ] CONSENT_REVOCABLE — `auto_wrap_revoked_at` independent of connection-level `revoked_at`; revoke is a single SQL UPDATE; honored by the next tick. (spec: this work item, `## Scope`)
- [ ] SIMPLE_SOLUTION — the auto-wrap helper is a pure refactor of existing code + one 60-second `setInterval`. No new infra dependencies, no new tables, no event subscriptions.
- [ ] ARCHITECTURE_ALIGNMENT — port-adapter pattern, contracts-first, hexagonal layering, RLS-via-`app_user`, AEAD reuse — every primitive already exists. (spec: `architecture.md`)

### Files

<!-- High-level scope -->

- **Modify** `nodes/poly/packages/db-schema/src/wallet-connections.ts` — add `auto_wrap_consent_at`, `auto_wrap_consent_actor_kind`, `auto_wrap_consent_actor_id`, `auto_wrap_floor_usdce_6dp` (NOT NULL DEFAULT 1000000), `auto_wrap_revoked_at` columns.
- **Create** new SQL migration in the poly migrator package — `ALTER TABLE poly_wallet_connections ADD COLUMN ...` for the five columns.
- **Modify** `packages/poly-wallet/src/port/poly-trader-wallet.port.ts` — add `wrapIdleUsdcE`, `setAutoWrapConsent`, `revokeAutoWrapConsent` to `PolyTraderWalletPort`. Extend `getConnectionSummary` return type with `autoWrapConsentAt`.
- **Modify** `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — extract `submitCollateralWrap` (lines ~1308-1330) into a private helper `_wrapUsdcEToPusd(amount6dp)`. Implement the three new port methods. `ensureTradingApprovals` calls the same helper to avoid drift.
- **Create** `nodes/poly/app/src/bootstrap/jobs/auto-wrap.job.ts` — pure `runAutoWrapTick(deps)` + `setInterval(60_000)` wrapper. Returns `{ stop }`. Mirrors `order-reconciler.job.ts`.
- **Modify** `nodes/poly/app/src/bootstrap/container.ts` — register the job behind `POLY_ROLE=trader` + pod-singleton gate.
- **Create** `src/contracts/poly-wallet-auto-wrap.contract.ts` — Zod schemas for consent set / revoke / status responses.
- **Create** `nodes/poly/app/src/app/api/v1/poly/wallet/auto-wrap/consent/route.ts` — `POST` (set) + `DELETE` (revoke), SIWE-bound to billing account, writes through port.
- **Modify** Money-page trading-wallet panel (likely `nodes/poly/app/src/app/(app)/credits/...` or similar) — add toggle component bound to `getConnectionSummary().autoWrapConsentAt`. Calls the two new routes.
- **Test** `nodes/poly/app/tests/component/db/poly-wallet-connections-auto-wrap.int.test.ts` — schema migration + consent set/revoke round-trip.
- **Test** `nodes/poly/app/tests/unit/auto-wrap.tick.test.ts` — pure `runAutoWrapTick` against fake port: consenting + above floor → wrap called; consenting + below floor → skipped; no consent → skipped; revoked → skipped.
- **Test** `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts` — extend with `wrapIdleUsdcE` paths (existing test file likely covers `ensureTradingApprovals` already).

## Notes for implementer

- Extract the wrap helper out of `privy-poly-trader-wallet.adapter.ts:1308-1330` first as a pure refactor (no behavior change), then call it from both `ensureTradingApprovals` and the new `wrapIdleUsdcE`. Saves a future drift bug.
- `auto_wrap_floor_usdce_6dp` exists explicitly to prevent gas-on-dust attacks: a malicious actor sending 1 wei USDC.e per minute should not be able to drain the funder's POL via auto-wrap gas.
- The job loop is a scan, not an event. Do not subscribe to USDC.e Transfer events for v0 — that adds a new infra dependency (RPC websockets / log indexer) for ~zero latency win on a 60s product cycle.
- Consent is per-connection, not per-user. If a user revokes and re-grants, the consent timestamp moves forward; no audit trail beyond `created_at` / `consent_at` / `revoked_at` for v0.
