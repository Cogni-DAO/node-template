---
id: task.0315
type: task
title: "Polymarket Data-API read methods — leaderboard, activity, positions"
status: needs_implement
priority: 2
estimate: 1
rank: 5
summary: "Extend the existing PolymarketAdapter with three read-only methods — listTopTraders, listUserActivity, listUserPositions — against the public Polymarket Data API. Also carries the cross-cutting OSS-integration decision for the whole follow-a-wallet pipeline: TS-only, no Python deps, no OctoBot; port patterns from Polymarket/agents + GiordanoSouza, don't import them."
outcome: "PolymarketAdapter exposes leaderboard, per-user activity, and per-user position queries. Contract tests prove response parsing. Rate-limit handling matches the existing adapter's pattern. Integration decision recorded so downstream tasks (0316, 0317, 0319) share one path. No ingestion or persistence in this task."
spec_refs:
  - monitoring-engine
  - architecture
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-16
updated: 2026-04-17
labels: [poly, polymarket, follow-wallet, data-api]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Polymarket Data-API Read Methods

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [spike.0314](./spike.0314.poly-copy-trading-wallets.md)

## Context

Research spike.0314 identified the Polymarket Data API as the right first-hop source for wallet discovery and live tracking. The existing `@cogni/market-provider/adapters/polymarket` only hits the Gamma market-listing endpoints. This task adds the three read-only Data-API endpoints we need, and nothing else.

## Design

### Outcome

`poly-brain` can answer "who are the top Polymarket traders right now and what are they doing?" using three new adapter methods, without any new ports, packages, or non-TS runtimes. This is the keel on which `task.0316` (ranking batch), `task.0317` (live poller), and `task.0319` (LangGraph tool wiring) all sit.

### Cross-cutting decision — OSS integration path

Our stack is TS + Next.js App Router + LangGraph-TS + the existing `@cogni/market-provider` capability. The three candidate OSS repos are all **Python**. Importing any of them means IPC, a second runtime in our image, a second rate-limit budget, and a second set of deploy artifacts — all rejected by `SIMPLICITY_WINS`.

**Decision:** port patterns, not code.

| Candidate                                                                                                                 | Role in our design                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@polymarket/clob-client`](https://www.npmjs.com/package/@polymarket/clob-client) (TS, MIT, first-party)                 | **Only real dependency.** Added later for Phase-3 execution. Not needed by this task.                                                                                                                                                                                                  |
| [`Polymarket/agents`](https://github.com/Polymarket/agents) (Python, MIT)                                                 | Reference for module shape (Gamma client / order builder / order signer separated). We mirror that layout in TS. Their LangChain hooks → we translate to LangGraph-native tool bindings (`core__*`).                                                                                   |
| [`GiordanoSouza/polymarket-copy-trading-bot`](https://github.com/GiordanoSouza/polymarket-copy-trading-bot) (Python, MIT) | Reference for the _pipeline_ — `Data API poll → historic_trades table → constraints → order maker`. Our equivalent: `Data API poll → ObservationEvent → poly-synth → (future) OrderExecutionPort`. Their Supabase-realtime dedupe maps to our `(wallet, fill_id)` unique-index dedupe. |
| [`Drakkar-Software/OctoBot-Prediction-Market`](https://github.com/Drakkar-Software/OctoBot-Prediction-Market)             | **Rejected.** GPL-3.0 is viral; copy-trading path is marked 🚧; UI-heavy Python framework; wrong runtime.                                                                                                                                                                              |

### Approach (this task's concrete deliverable)

Extend `packages/market-provider/src/adapters/polymarket` with three read-only methods that hit the public Polymarket Data API. No new port surface — they are adapter-local helpers. The `WalletCapability` + `core__wallet_*` tools that bind them to `poly-brain` are `task.0319`.

- `listTopTraders(opts: { window: '7d'|'30d'|'all', limit?: number })`
- `listUserActivity(wallet: string, opts?: { sinceTs?: number, limit?: number })`
- `listUserPositions(wallet: string)`

**Reuses:**

- Existing `PolymarketAdapter` HTTP client + retry/backoff pattern from the shipped Gamma methods.
- Existing adapter rate-limit budget (one pool across all endpoints on the same host).
- Existing `src/contracts/*.contract.ts` Zod convention.
- Architecture of `Polymarket/agents`' client split (module per surface: markets / users / leaderboards).
- `GiordanoSouza`'s response-shape observations for `/activity` and `/positions` (their code documents field names we'd otherwise have to rediscover).

**Rejected:**

- Importing any Python OSS — two runtimes, viral licenses, deploy sprawl.
- Building a new `WalletProviderPort` — premature abstraction; only one provider exists (Polymarket) and activity is plausibly part of the existing `MarketProvider` surface.
- Goldsky subgraph for this task — Data API already covers leaderboard/activity/positions at seconds latency; subgraph is a Tier-1-discovery backfill concern handled in `task.0316`.
- CLOB WebSocket — belongs to the top-0.1% tier in the research doc, well behind basic fills-only signal.

### Files

- **Create:** `packages/market-provider/src/adapters/polymarket/data-api-client.ts` — thin HTTP client for the Data API, reusing the adapter's existing fetch/retry helpers. Module shape mirrors `Polymarket/agents` (one file per surface).
- **Create:** `packages/market-provider/src/contracts/polymarket-data-api.contract.ts` — Zod schemas for `TopTrader`, `UserActivity`, `UserPosition`.
- **Modify:** `packages/market-provider/src/adapters/polymarket/index.ts` — surface the three methods on the adapter.
- **Modify:** `packages/market-provider/src/port.ts` — **no change** (no new port methods).
- **Test:** `packages/market-provider/tests/polymarket-data-api.contract.test.ts` — fixture-based tests for schema happy path + malformed response.
- **Test:** `packages/market-provider/tests/polymarket-data-api.external.test.ts` — gated on `RUN_EXTERNAL=1`, hits the live API for one wallet to prove shape stability.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] READ_ONLY: no write, no order-placing code added in this task
- [ ] CONTRACT_IS_SOT: return shapes defined as Zod schemas and consumed via `z.infer` (spec: architecture)
- [ ] RATE_LIMIT_SHARED: new methods share the existing adapter rate-limit budget, not a parallel one
- [ ] NO_NEW_PORT: no new port surface — adapter-local methods only
- [ ] TS_ONLY_RUNTIME: no Python, no IPC, no second runtime introduced
- [ ] OSS_PATTERN_PORTED_NOT_IMPORTED: no Python OSS imported; patterns from `Polymarket/agents` + `GiordanoSouza` are referenced, not vendored
- [ ] SIMPLE_SOLUTION: leverages existing adapter + Zod contracts (spec: architecture)
- [ ] ARCHITECTURE_ALIGNMENT: follows hexagonal pattern — adapter-local, no cross-package deps (spec: architecture)

## Validation

- [ ] Contract tests cover each new method's happy path + schema-mismatch failure
- [ ] Hits the live Data API in at least one smoke test (gated behind external-tests lane)
- [ ] Rate-limit budget still respected under added call volume
- [ ] `pnpm check` passes

## Out of Scope

- Persistence, scheduling, observation events (belongs to tasks 0316, 0317).
- `WalletCapability` + `core__wallet_*` LangGraph tool wiring (→ task.0319).
- CLOB WebSocket or chain-event listener.
- Any writeback to knowledge or awareness planes.
- `@polymarket/clob-client` dependency — added only when Phase-3 execution opens.
