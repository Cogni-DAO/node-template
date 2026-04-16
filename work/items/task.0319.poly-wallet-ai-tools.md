---
id: task.0319
type: task
title: "Poly-brain wallet-watch AI tools — core__wallet_top_traders / activity / positions"
status: needs_implement
priority: 2
estimate: 1
rank: 5
summary: "Wire the Polymarket Data-API adapter methods (task.0315) into poly-brain as three new LangGraph tools — core__wallet_top_traders, core__wallet_activity, core__wallet_positions — via a new WalletCapability. Gives the chat agent immediate ability to answer 'who should we be watching and what did they just do?' without shipping any execution path."
outcome: "poly-brain can call three new tools at runtime, backed by the shipped Data-API methods. Capability is container-resolved, mirrors the existing MarketCapability pattern, and needs no adapter imports inside tool code. Zero new runtime dependencies."
spec_refs:
  - architecture
  - langgraph-patterns
assignees: derekg1729
project: proj.poly-prediction-bot
blocked_by: task.0315
created: 2026-04-17
updated: 2026-04-17
labels: [poly, polymarket, follow-wallet, langgraph, ai-tools]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Poly-brain Wallet-Watch AI Tools

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [task.0315](./task.0315.poly-data-api-wallet-reads.md)

## Context

Task.0315 ships the read methods on the Polymarket adapter. This task puts them in front of the AI. It is the minimum wiring that lets `poly-brain` answer wallet questions in chat — before any batch ranking (`task.0316`), polling (`task.0317`), or execution (Phase 3) exists. This is the "first demo" slice: hand-curate a list of wallets in conversation, ask the agent what they've been doing, let it reason over the response.

## Design

### Outcome

A user can ask `poly-brain` "what did `0xABC…` bet on this week?" or "who are the top sports traders right now?" and get a live, cited answer, with no new ports and no new runtimes.

### Approach

**Solution:** add one new capability (`WalletCapability`) and three new tools (`core__wallet_top_traders`, `core__wallet_activity`, `core__wallet_positions`) following the exact shape of the shipped `MarketCapability` + `core__market_list` (see `packages/ai-tools/src/tools/market-list.ts`). Bind the tools into `poly-brain` via `nodes/poly/graphs/src/graphs/poly-brain/tools.ts`. Resolve the capability at runtime in `nodes/poly/app/src/bootstrap/capabilities/` using the adapter methods from task.0315.

**Reuses:**

- `MarketCapability` / `core__market_list` as the template — the new tools are structural clones with different params.
- Adapter methods from task.0315 — no new HTTP code.
- Existing tool-binding path in `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts`.
- `packages/ai-tools` contract conventions (Zod schemas, `core__` prefix, `effect: read_only`, redaction allowlist).

**Rejected:**

- Inventing a new `WalletProviderPort` package — no second provider exists. Keep it a capability shape, not a port.
- Binding the tools directly to `poly-synth` — `poly-synth` is structured-reasoning, not tool-using. Analysis over wallet observations belongs to `task.0317`'s pipeline, not this task.
- Packaging the tools into a separate `@cogni/poly-tools` — premature; `packages/ai-tools` is where `core__*` tools live today.
- Shipping a `core__wallet_mirror_trade` execution tool now — crosses the Phase-3 line (execution + legal review).

### Files

- **Create:** `packages/ai-tools/src/tools/wallet-top-traders.ts` — tool definition + `WalletCapability.listTopTraders` interface slice.
- **Create:** `packages/ai-tools/src/tools/wallet-activity.ts` — tool definition + `WalletCapability.getActivity` slice.
- **Create:** `packages/ai-tools/src/tools/wallet-positions.ts` — tool definition + `WalletCapability.getPositions` slice.
- **Modify:** `packages/ai-tools/src/index.ts` — export the three tool IDs.
- **Create:** `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — runtime `WalletCapability` impl that delegates to the Polymarket adapter.
- **Modify:** `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — register the three new bindings alongside `MARKET_LIST_NAME` / `WEB_SEARCH_NAME`.
- **Modify:** `nodes/poly/graphs/src/graphs/poly-brain/tools.ts` — add the three tool IDs to `POLY_BRAIN_TOOL_IDS`.
- **Test:** `packages/ai-tools/tests/wallet-*.contract.test.ts` — per-tool input/output schema round-trip.
- **Test:** `nodes/poly/app/tests/.../wallet-capability.test.ts` — container resolution test.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TOOL_ID_NAMESPACED: tool IDs are `core__wallet_top_traders`, `core__wallet_activity`, `core__wallet_positions` (spec: architecture)
- [ ] EFFECT_TYPED: all three tools declare `effect: read_only` (spec: architecture)
- [ ] CAPABILITY_NOT_ADAPTER: tool code imports the capability interface, never the adapter (spec: architecture)
- [ ] NO_LANGCHAIN_IMPORTS: tool definitions stay framework-neutral; bindings happen at the graph boundary (spec: langgraph-patterns)
- [ ] NO_NEW_PORT: no new port package — capability is app-local, delegating to the existing `MarketProvider` adapter
- [ ] TS_ONLY_RUNTIME: no Python, no IPC
- [ ] REDACTION_REQUIRED: wallet-address output fields added to the redaction allowlist where needed (spec: architecture)
- [ ] SIMPLE_SOLUTION: clone the `MarketCapability` / `core__market_list` pattern exactly; no novel wiring (spec: architecture)

## Validation

- [ ] Contract tests pass for all three tools' input/output schemas
- [ ] `poly-brain` chat can successfully invoke each of the three tools end-to-end in a stack test
- [ ] Capability resolves from the container in dev + test environments
- [ ] `pnpm check` passes

## Out of Scope

- Batch ranking → task.0316
- Live wallet poller / `ObservationEvent` → task.0317
- Edge-validation measurement → spike.0318
- Any order-placing tool (Phase 3)
- Any Goldsky / chain-listener path
