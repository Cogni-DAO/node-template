---
id: task.0368
type: task
title: "Poly agent wallet research v0 — Data-API tools + poly-research graph"
status: needs_implement
priority: 1
rank: 4
estimate: 3
summary: "Empower the deployed poly agent to autonomously research, profile, and score Polymarket wallets beyond the top-500 leaderboard. Ships 8 hand-rolled Data-API tools + a new `poly-research` LangGraph peer graph that composes them into a structured ranking report for copy-trade target selection."
outcome: "Running `POST /api/v1/agent/execute` with `graph=poly-research` returns a typed `PolyResearchReport` containing candidate wallets (proxyWallet, stats, reasoning, evidenceUrls) ranked by consistency. Discovery strategy uses per-market `/holders` + `/trades` harvesting to surface hidden-gem wallets the top-500 leaderboard misses."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-24
updated: 2026-04-24
labels:
  [poly, ai, langgraph, ai-tools, data-api, wallet-research, copy-trade-targets]
external_refs:
---

# task.0368 — Poly agent wallet research v0

## Why hand-roll (not MCP, not autogen)

Logged here so the next agent doesn't re-litigate:

- **Rejected upstream Polymarket MCP** (PR #997 closed 2026-04-24): all 25 tools are market-centric; zero wallet-profile / leaderboard / handle-resolution tools. The core reason we wanted it.
- **Rejected OpenAPI autogen** (LangChain `OpenAPIToolkit`, Speakeasy, `mcp-openapi-proxy`): Polymarket has no official OpenAPI spec. Even if it did, tool-per-endpoint dumps lose the curation (tuned descriptions, pagination conventions, Zod envelopes) that are the actual value.
- **Rejected LangChain `RequestsToolkit`**: too raw. Agent hallucinates URLs; no stable context envelope against schema drift.
- **Rejected Composio / Arcade / Toolhouse**: no Polymarket coverage; SaaS dependency.

For a **core-domain** API with ~8 endpoints we iterate on, hand-rolled thin wrappers win: ~1 day of work yields Zod envelopes, tuned descriptions, pagination conventions, billing/metering via `ai-tools` patterns.

## Architecture decision (per `third-party-integrator` skill matrix)

- **App Capability** pattern. Not Port/Adapter (no business logic, no test isolation burden — it's public read-only HTTP). Not MCP (graph-internal tools).
- Extends **existing** `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts` (don't duplicate). Add Zod schemas + new methods; all responses routed through `.safeParse()` at the adapter boundary (stable context envelope per skill §4).
- Extends **existing** `walletCapability` on `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — one capability keeps related Data-API methods co-located (aligns with `task.0346` which also extends it).
- `PolyTraderWalletPort` stays untouched. That's signing/trading (business-critical, must fake in CI). This is research (advisory, read-only).

## Graph topology — peer subgraph, not poly-brain extension

New `poly-research` LangGraph graph as a **peer** to poly-brain, not as 8 new tools bolted onto poly-brain.

Why:

- Research is long-horizon (many tool calls, iterate-paginate-aggregate). Burns poly-brain's trading context with non-trading tokens.
- Research produces a **cacheable artifact** (structured report) → clean subgraph boundary; task.0334 later persists it to Dolt.
- Different system prompts. Research = patient + skeptical + loves tables. Trading = decisive + risk-aware.
- In v1, poly-brain invokes `poly-research` via a single `core__poly_research` tool call and gets back the digest — never re-does the discovery work.

## Tool surface — CLI-flavored primitives (per Karpathy/Steinberger research)

Raw JSON out. Paginated small. **No `analyze_wallet` / `find_profitable_traders` fat verbs** — those bake our hypothesis into code and rob the agent of agency.

| Tool ID (new)                      | Wraps (`data-api.polymarket.com`)                          |
| ---------------------------------- | ---------------------------------------------------------- |
| `core__poly_data_positions`        | `/positions?user=&market=&sizeThreshold=` (limit/offset)   |
| `core__poly_data_activity`         | `/activity?user=&type=&start=&end=` (limit/offset)         |
| `core__poly_data_value`            | `/value?user=` — cheap filter before heavier calls         |
| `core__poly_data_holders`          | `/holders?market=` — hidden-gem discovery core             |
| `core__poly_data_trades_market`    | `/trades?market=&takerOnly=` — counterparty harvesting     |
| `core__poly_data_traded_events`    | `/traded-events?user=` — category-specialization analysis  |
| `core__poly_data_resolve_username` | Gamma `/public-search?profile=true` — handle → proxyWallet |
| `core__poly_data_help`             | Meta-tool: endpoint catalog + example discovery sequences  |

Existing `core__wallet_top_traders` (wraps `/leaderboard`) is reused as-is — it joins the `poly-research` toolset.

## Discovery strategy (prompt-only in v0)

Encoded in the `poly-research` system prompt, not a planner node:

1. Seed by category via existing `core__market_list` / Gamma `/events?tag_slug=sports|politics|crypto`.
2. Harvest `/holders` on 50–200 markets in the category; union wallets; count cross-market appearances.
3. Also harvest `/trades` counterparties on high-volume markets.
4. Cheap-filter with `/value?user=` to drop sub-$1k wallets.
5. Profile survivors: `/positions` (unrealized) + `/activity` (realized-PnL reconstruction).
6. Rank by consistency: ≥N resolved markets, win-rate ≥60%, positive PnL across ≥3 events. Filters lucky one-shotters.
7. Cross-check against `/leaderboard?orderBy=PNL&offset=0..1000` — if absent, genuine hidden gem.

A planner-node split is v1 (see Out of Scope).

## Output contract — `PolyResearchReport` Zod

Lives at `packages/node-contracts/src/poly.research-report.v1.contract.ts`:

```ts
const PolyResearchReport = z.object({
  query: z.string(),
  methodology: z.string(),
  candidates: z.array(
    z.object({
      proxyWallet: PolyAddressSchema,
      userName: z.string().nullable(),
      rank: z.number().int().positive(),
      confidence: z.enum(["low", "medium", "high"]),
      stats: z.object({
        totalPnl: z.number(),
        winRate: z.number().nullable(),
        sampleSize: z.number().int().nonnegative(),
        categoryFocus: z.array(z.string()).optional(),
      }),
      reasoning: z.string(),
      evidenceUrls: z.array(z.string().url()),
    })
  ),
  caveats: z.array(z.string()),
  recommendation: z
    .enum(["mirror-high-confidence", "monitor", "reject"])
    .nullable(),
});
```

Graph emits via LangGraph structured output on the final message.

## Rate-limit & gotchas (capture in `core__poly_data_help` + client JSDoc)

- Data API is Cloudflare-throttled ~60 rpm per IP (throttled silently, not 429'd). V0 accepts the limit and observes; no client-side token bucket.
- `user` param must be **proxyWallet (Safe)**, NOT signing EOA — top cause of empty `/positions`. Document in every tool's description.
- `/leaderboard` is capped at offset=1000 — this is the core reason we need holders-based discovery.
- Gamma `/public-search?profile=true` is the handle → address resolver (different host from Data API).
- Sources referenced: `docs.polymarket.com`, shaunlebron data-api gist, `polymarket-apis` PyPI lib.

## Requirements

- **TOOL_ID_NAMESPACED** (existing invariant): each tool ID is `core__poly_data_*`.
- **EFFECT_TYPED**: all 8 new tools have `effect: "read_only"` in their contract.
- **ZOD_ENVELOPE_AT_BOUNDARY**: every new `polymarket.data-api.client.ts` method parses raw fetch response through `.safeParse()` before returning. Unexpected shapes throw a typed `VALIDATION_FAILED`-style error with structured log.
- **NO_NEW_PORT**: research capability methods live on the existing `walletCapability`; no new port file.
- **NO_LANGCHAIN_IMPORT_IN_TOOLS**: matches existing `ai-tools/tools/` pattern.
- **SINGLE_CONTRACT_SOURCE**: tool I/O types come from the contract file, never re-declared in the tool module.
- **GRAPH_PEER_NOT_NESTED**: `poly-research` is registered as a peer graph, not a subgraph invoked from poly-brain. v1 wires poly-brain → poly-research as a tool; not v0.
- **NO_DB_WRITE**: v0 is ephemeral — no Postgres / Doltgres writes. Report returned in HTTP response only.

## Allowed Changes

- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts` — **extend**, not replace
- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` — new Zod response schemas
- `packages/ai-tools/src/tools/poly-data-*.ts` — **8 new tool files**
- `packages/ai-tools/src/tools/index.ts` — re-exports
- `packages/ai-tools/tests/poly-data-*.test.ts` — unit tests per tool
- `packages/node-contracts/src/poly.research-report.v1.contract.ts` — output contract
- `packages/node-contracts/src/index.ts` — re-export
- `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — extend `walletCapability` with new methods
- `nodes/poly/app/src/bootstrap/container.ts` — wire Data-API client into extended capability (if not already)
- `nodes/poly/graphs/src/graphs/poly-research/` — new dir: `graph.ts`, `prompts.ts`, `tools.ts`, `output-schema.ts`
- `nodes/poly/graphs/src/graphs/index.ts` (or equivalent registry) — register `poly-research`

**Out of bounds:** `PolyTraderWalletPort`, copy-trade tables, mirror-coordinator, anything under `nodes/poly/app/src/adapters/server/poly-trader/`, poly-brain's tool bundle (v1 job).

## Plan

- [ ] **Contract first** — write `poly.research-report.v1.contract.ts` + new Zod response schemas in `polymarket.data-api.types.ts` before touching client.
- [ ] Extend `polymarket.data-api.client.ts` with new methods: `getHolders`, `listMarketTrades`, `listTradedEvents`, `resolveUsername`, plus any missing of {`getPositions`, `listActivity`, `getValue`}. All routed through Zod `.safeParse()` at boundary; structured log at start/ok/error with `durationMs`.
- [ ] Extend `walletCapability` on `bootstrap/capabilities/wallet.ts` with corresponding research methods (interface + impl). Keep `listTopTraders` untouched.
- [ ] Write 8 new tools in `packages/ai-tools/src/tools/poly-data-*.ts` following the `wallet-top-traders.ts` pattern. Each tool's description explicitly documents the proxyWallet-vs-EOA gotcha when `user` is an input.
- [ ] Write `core__poly_data_help` meta-tool: returns static endpoint catalog + 2–3 example discovery sequences as structured markdown.
- [ ] Unit tests per tool: happy path (mocked client), Zod validation failure path, pagination.
- [ ] Create `poly-research` graph: ReAct agent with the 8 new tools + `core__wallet_top_traders` + `core__market_list` + `core__web_search`. System prompt encodes the discovery strategy. Structured output via `PolyResearchReport` on final message.
- [ ] Register `poly-research` in the graph registry so agent API can execute it.
- [ ] Integration test (component-level, not stack): invoke the graph with a canned prompt against a recorded `nock`/VCR fixture of Data-API responses; assert output parses as `PolyResearchReport` with ≥1 candidate.
- [ ] `pnpm check:fast` clean, `pnpm check:docs` clean.
- [ ] `/closeout` — validation block verbatim in PR body; PR targeting main.

## Validation

**exercise:**

```bash
# Against deployed candidate-a after flight:
curl -X POST https://poly-test.cognidao.org/api/v1/agent/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "graph": "poly-research",
    "input": "Research the top consistently-profitable sports-betting wallets on Polymarket with >60% win rate over the last 30d. Focus on wallets NOT in the global top-500 leaderboard."
  }'
```

**Expected:** HTTP 200 with a `PolyResearchReport`:

- ≥3 `candidates[]`
- Every `proxyWallet` is a valid 0x… address
- `methodology` references the holders+trades harvesting strategy
- `evidenceUrls[]` resolve on polymarket.com (at least one profile URL per candidate)
- `caveats[]` is non-empty

**observability:**

```
{service="poly-node-app", buildSha="<flighted-sha>"}
  |~ "core__poly_data_holders|core__poly_data_activity"
  | json
```

**Expected:** Loki returns ≥5 tool-invocation log lines from that single agent run at the deployed SHA, proving the discovery strategy ran against real Data-API endpoints.

Then flip `deploy_verified: true` via PR comment per AGENTS.md.

## Out of Scope (v1/v2 — file separate tasks after v0 validates)

**v1:**

- `fields` projection on tools (optional allowlist param for token-cost tuning).
- poly-brain invokes `poly-research` as a `core__poly_research` tool.
- In-memory 5-min cache on capability methods.
- Planner-node split inside `poly-research` (replace prompt-only strategy).

**v2 (largely covered by [task.0334](task.0334.poly-niche-research-engine.md)):**

- Dolt persistence: `poly_wallet_research` / `poly_niche_research` tables.
- Scheduled scout cron + rolling re-rank.
- EDO events feed + Brier-calibrated confidence.
- Auto-promote high-confidence candidates to `poly_copy_trade_targets` (with human gate).
- Subgraph backend for wallets with >10k fills.

## Related work

- **Replaces:** PR #997 (closed — upstream Polymarket MCP, wrong tool subset).
- **Unblocks:** [task.0334](task.0334.poly-niche-research-engine.md) — its required tools (`polymarket_top_traders_by_category`, `polymarket_wallet_trades`, etc.) are this task's `core__poly_data_*` family renamed.
- **Complements:** [task.0346](task.0346.poly-wallet-stats-data-api-first.md) — same client, different consumer (UI vs agent). Coordinate on any shared schema changes in `polymarket.data-api.types.ts`.
- **Downstream consumer:** [proj.poly-copy-trading](../projects/proj.poly-copy-trading.md) — research output feeds copy-trade target selection.

## Review Checklist

- [ ] **Work Item:** `task.0368` linked in PR body
- [ ] **Spec:** N/A (no new spec invariants; extension of existing client + capability patterns)
- [ ] **Tests:** unit per tool + one component-level graph test with fixtured Data-API responses
- [ ] **Reviewer:** assigned and approved
- [ ] **Rate-limit discipline:** agent does not hammer Data API in test fixtures; `/holders` harvesting capped at ≤200 markets per run by prompt instruction
- [ ] **Security:** no credentials / keys in tool output; all fetches read-only; no mutations

## PR / Links

-

## Attribution

-
