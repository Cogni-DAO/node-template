---
id: task.0354
type: task
title: "Poly trading hardening — post-B3 cleanup + executor cache + cap-source robustness"
status: needs_triage
priority: 2
rank: 25
estimate: 3
created: 2026-04-22
updated: 2026-04-22
summary: "Consolidated hardening bucket for the per-tenant Polymarket trade-execution path shipped in task.0318 Phase B3 (PR #990). Fixes two latent correctness bugs (executor-cache retains revoked signer creds; daily cap reads `attributes->>'size_usdc'` JSON with silent-zero fallback), removes dormant prototype residue (`OperatorWalletCard`, `readLockedNotional` stub, org-level `POLY_PROTO_*` / `POLY_CLOB_*` secrets), closes stale code comments in `mirror-pipeline.ts` / `target-source.ts` / `order-reconciler.job.ts` / `connect/route.ts`, tightens one unchecked `token_id` cast, and re-enables the agent tool surface (`core__poly_{place_trade,list_orders,cancel_order}`) under per-tenant identity."
outcome: "No latent bug can let a revoked tenant sign with cached creds, no cap check can silently pass because a fill row was missing `size_usdc`, and every stale artifact from the single-operator prototype (code, comments, GitHub Actions secrets) is deleted. Agents that previously placed trades through `core__poly_place_trade` can again — now scoped to the calling tenant's grant."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - docs/spec/poly-multi-tenant-auth.md
assignees: []
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by:
labels: [poly, hardening, trade-execution, cleanup, security, tech-debt]
---

# task.0354 — Poly trading hardening follow-ups

## Problem

[task.0318 Phase B3](./task.0318.poly-wallet-multi-tenant-auth.md) (PR #990) landed the per-tenant trade-execution path and purged the single-operator prototype. The implementation review (`/review-implementation` on PR #990) surfaced a set of non-blocking hardening items that should be fixed in one focused follow-up before the path carries meaningful capital. The core security primitives are right (fail-closed `authorizeIntent`, branded `AuthorizedSigningContext`, RLS on `poly_wallet_{connections,grants}`); what remains is residue and sharp edges.

## Scope

In:

**Correctness — latent bugs:**

- **Executor-cache invalidation on revoke / re-provision.** `PolyTradeExecutorFactory.getFor(billingAccountId)` (`nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`) lazy-builds + caches a `PolyTradeExecutor` per tenant, which internally caches a `PolymarketClobAdapter` bound to the tenant's Privy signer + CLOB creds at build time. If the tenant runs `POST /api/v1/poly/wallet/connect` → `revoke` → re-provision, the cached executor keeps the _old_ signer + creds until pod restart — a revoked connection can still sign until the cache miss. Fix options (choose one): (a) `PolyTraderWalletPort.revoke()` publishes an invalidation that the factory listens to; (b) TTL the cache entry (≤5 min); (c) key the cache on `(billing_account_id, connection_id)` and hash-verify the connection_id on every `getFor()` call. Invariant the fix must satisfy: **EXECUTOR_FRESHNESS — a cached executor never outlives the connection it was built for.**
- **Daily-cap fragile source.** `PrivyPolyTraderWalletAdapter.authorizeIntent` computes `daily_usdc_used` via `SUM((attributes->>'size_usdc')::numeric)` on `poly_copy_trade_fills`. `attributes` is `jsonb` — if `size_usdc` is missing, malformed, or stored as a string without the right shape, the coalesce path returns 0 and the cap silently passes. Promote `size_usdc_atomic` to a typed `numeric` column on `poly_copy_trade_fills` (new migration), backfill from existing `attributes->>'size_usdc'`, add a `NOT NULL` CHECK after backfill, and update `authorizeIntent` + the copy-trade writers to read/write the typed column. Invariant: **CAP_SOURCE_IS_TYPED — no cap window reads JSON attributes for numbers that enforce live-money limits.**

**Cleanup — dormant prototype residue:**

- **Delete `OperatorWalletCard`** (`nodes/poly/app/src/app/(app)/dashboard/_components/OperatorWalletCard.tsx`). The single-operator dashboard card has been dormant since Stage 4 CP4 of task.0318; the Money page (`task.0353`, merged via #988) now owns the per-tenant trading-wallet surface. Remove the component, its imports, and its render sites; follow-up any remaining references in `docs/design/wallet-analysis-components.md`.
- **Delete `readLockedNotional` stub** (`nodes/poly/app/src/app/_lib/poly/operator-extras.ts` equivalent). The prototype-era helper returns `null` + `poly_capability_unconfigured` everywhere it's called; remove the stub and every caller, or replace the one UI site that reads it (`dashboard/_components/*`) with a per-tenant read backed by `PolyTradeExecutor.listOrders(tenant)`.
- **Delete GitHub org-level `POLY_PROTO_*` + `POLY_CLOB_*` secrets.** Runtime code, scripts, and workflows no longer reference them (verified in the Stage 4 CP4 commit `00237c0`). List in `scripts/setup-secrets.ts` and `.github/workflows/*.yml` one more time to confirm zero grep hits, then delete from the org settings. Capture the deletion in the work item's `## Validation` block.
- **Retire `PolyWalletBalanceOutput` (singular) contract + route tombstone.** `/api/v1/poly/wallet/balance` returns a stable tombstone today (`operator_wallet_removed_use_money_page`). Once the Money page v0 ship is out of the 48h rollback window, delete `packages/node-contracts/src/poly.wallet.balance.v1.contract.ts`, the route, and the contract export. `poly.wallet.balances.v1` (plural) is the canonical replacement.

**Cleanup — stale comments + type tightening (all in `nodes/poly/app/src`):**

- `features/copy-trade/mirror-pipeline.ts` around L383-384: the `const boundClose = deps.closePosition; if (!boundClose) return;` guard is unreachable — `deps.closePosition` is non-null by the time control reaches that block. Remove the dead lines OR replace with a non-null assertion + comment explaining why the early guard is load-bearing.
- `features/copy-trade/mirror-pipeline.ts` around L387: `tokenId: intent.attributes?.token_id as string` can produce the literal string `"undefined"` if `attributes.token_id` is missing. Replace with the already-bound `tokenId` from the outer closure (known non-null at this call site).
- `features/copy-trade/target-source.ts` around L169-176: the comment documents `wallet_connections (status='active')` semantics but the code uses `isNull(revokedAt)`. Update the comment to match the code (or drop it — the query is self-documenting).
- `bootstrap/jobs/order-reconciler.job.ts` around L110-113: comment still references `mirror-coordinator.ts` (renamed to `mirror-pipeline.ts` in Stage 3 of task.0318). Update.
- `app/api/v1/poly/wallet/connect/route.ts` around L10-11: header `Scope` still claims "no grant issuance here" despite `provisionWithGrant` being the only call. Rewrite the scope line to reflect the shipped atomic provision + default-grant write.

**Capability — agent tool surface re-enable:**

- `core__poly_place_trade`, `core__poly_list_orders`, `core__poly_cancel_order` are currently stubbed ("not configured") since Stage 4 CP3 — re-enabling them was an accepted v0 regression because tool invocation didn't carry actor identity. Plumb `billing_account_id` (derived from the calling actor's user → billing account mapping) into the tool binding so each tool call routes through `PolyTradeExecutorFactory.getFor(billing_account_id)` + `authorizeIntent`. Scope restriction: tool calls consume the tenant's `poly:trade:*` grant exactly like mirror-pipeline placements. If the design drifts large (e.g., introduces a new actor→billing-account resolver), split into a dedicated task and keep this one to cleanup only.

Out:

- Per-tenant shared-poller refactor ([task.0332](./task.0332.poly-mirror-shared-poller.md)).
- Per-tenant preferences / sizing config ([task.0347](./task.0347.poly-wallet-preferences-sizing-config.md)).
- Trading-wallet withdrawal / fund flow ([task.0351](./task.0351.poly-trading-wallet-withdrawal.md), [task.0352](./task.0352.poly-trading-wallet-fund-flow.md)).
- Signing-backend swap (Safe+4337) — tracked as a Phase 3 design decision, out of scope here.

## Validation

- **exercise:** on candidate-a, against the same tenant used for task.0318 Phase B3 flight: (1) provision a wallet → place a mirror trade (observe `poly.trade.authorize.ok` at SHA for this branch) → revoke the connection → re-provision without a pod restart → place another mirror trade → observe the new placement uses the _new_ connection's signer (log `connection_id` differs from pre-revoke placements); (2) manually insert a `poly_copy_trade_fills` row with `size_usdc_atomic = null` on a dev tenant → observe `authorizeIntent` rejects with `cap_source_missing` rather than passing through zero; (3) `gh secret list --org Cogni-DAO | grep -E 'POLY_PROTO_|POLY_CLOB_'` returns empty; (4) `core__poly_place_trade` invoked from an agent session for the tenant lands a placement under the calling user's `billing_account_id`.
- **observability:** `{service="poly-node-app", env="candidate-a"} |= "poly.trade.authorize" | json | connection_id_pre_revoke != connection_id_post_revoke` confirms cache freshness at the deployed SHA; `|= "cap_source_missing"` confirms the typed-column enforcement; `|= "poly.agent.tool.place"` at the deployed SHA shows the agent-invoked placement with `billing_account_id`.

## Out of Scope

Per-tenant shared-poller, preferences/sizing config, withdraw/fund flow, signing-backend swap (see "Out" above).

## Notes

- **Source review.** Every item in this bucket comes from the `/review-implementation` pass on PR #990 — see the PR review comment for the full walkthrough. This task is the single landing spot for that review's non-blocking follow-ups so we don't fragment them across five tiny PRs.
- **Order of operations.** The two correctness fixes (executor cache, cap-source column) should land first and land together in one commit — they touch the same hot path and the migration wants the cache invalidation plumbing already in place. Cleanup items can go in a second commit on the same branch. Agent-tool re-enable should be last — it's the largest surface and the most likely to need its own design slice; if it does, split it out at review time.
- **Related drive-bys.** Deletion of `OperatorWalletCard` may surface `docs/design/wallet-analysis-components.md` references that are now stale; fix inline.
