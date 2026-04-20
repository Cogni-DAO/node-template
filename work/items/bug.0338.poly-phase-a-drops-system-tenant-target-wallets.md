---
id: bug.0338
type: bug
title: Phase A targets never copy-trade — POST doesn't upsert kill-switch config, enumerator is boot-time only
status: needs_closeout
priority: 1
rank: 20
estimate: 2
summary: PR #944 lands per-user tracked-wallet CRUD + RLS, and the routes work (POST/GET/DELETE round-trip validated on candidate-a at `be051abcc5`, 2026-04-20). But a user's POSTed wallet does not actually get copy-traded by the mirror pod. Two composing gaps. (1) POST route inserts into `poly_copy_trade_targets` but does NOT upsert a `poly_copy_trade_config` row for the calling tenant — so `dbTargetSource.listAllActive()` inner-joins the new target against zero config rows and drops it; POST response correctly shows `enabled: false`. (2) Container wires the mirror poll by calling `listAllActive()` **once at boot** in `container.ts:720`; mid-flight POSTs are invisible until pod restart. Proven live: two wallets POSTed at 09:29:50, zero `poly.mirror.poll.singleton_claim` events fired after, pod still on its 09:12:23 empty enumeration.
outcome: A user POSTs a wallet via the dashboard + button → within one poll tick (≤30s) `poly.mirror.poll.singleton_claim` fires for that target_wallet under the user's tenant → `poly.mirror.decision` events fire on real fills. No pod restart required. No system-tenant bootstrap.
spec_refs:
  - poly-multi-tenant-auth
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch: feat/task-0318-phase-a
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [poly, polymarket, copy-trading, candidate-a, phase-a-gap]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - work/items/task.0332.poly-mirror-shared-poller.md
---

# Phase A targets never copy-trade — two composing gaps

> Not a regression — env-driven polls were intentionally dropped. Two Phase-A completeness gaps prevent a freshly-POSTed tracked wallet from being mirrored. Surfaced immediately post-flight of PR #944 on candidate-a, SHA `be051abcc5`, 2026-04-20 ~09:30 UTC.

## Observation — live on candidate-a

Agent registered against `https://poly-test.cognidao.org` (user `2ef06b2d…`, billing `98c9fe83…`):

```
POST /api/v1/poly/copy-trade/targets {"target_wallet":"0x204f72…"} → 201
POST /api/v1/poly/copy-trade/targets {"target_wallet":"0x50f4748f…"} → 201
GET  /api/v1/poly/copy-trade/targets                                 → 2 rows, source:"db", enabled:false
```

Loki `{pod=~"poly-node-app-647bc98466.*"} |~ "singleton_claim|poll.skipped|create_success"` for the 20 minutes after:

- `09:12:23` — pod boot, `poly.mirror.poll.skipped {has_bundle:true, target_count:0}`
- `09:24:42` — POST + DELETE round-trip (validation) — no `singleton_claim` after
- `09:29:50` — POST both wallets succeeds (`create_success` events) — no `singleton_claim` after
- (rolling) — zero `poly.mirror.poll.*` events from the mirror job

The pod knows about the targets (POST wrote them). The mirror poll doesn't know anything changed.

## Gap 1 — POST doesn't create the tenant's kill-switch config row

`nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts:172-189` writes to `poly_copy_trade_targets` only. No matching upsert into `poly_copy_trade_config`. When the enumerator runs:

```sql
-- dbTargetSource.listAllActive (target-source.ts:140-170)
SELECT ...
FROM poly_copy_trade_targets
INNER JOIN poly_copy_trade_config
  ON config.billing_account_id = targets.billing_account_id
WHERE targets.disabled_at IS NULL AND config.enabled = true
```

A fresh tenant has NO row in `poly_copy_trade_config` → inner-join drops all their targets → `listAllActive()` returns []. The POST response surfaces this correctly: `enabled: false` (from `snapshotState`'s fail-closed default when the config row is missing).

**Fix:** POST route upserts `poly_copy_trade_config` for the tenant at creation time. Default behavior TBD:

- **(a)** `enabled = false` — user must explicitly enable (new endpoint `PATCH /api/v1/poly/copy-trade/config {enabled:true}`). Safer but requires more UI.
- **(b)** `enabled = true` — opt-out model; mirror starts as soon as any target is added. Matches the pre-flight env-driven behavior for the system tenant. Simpler demo path.

Preferred: **(a)**, with the dashboard adding a toggle next to the pooled-execution disclaimer. But **(b)** for system-tenant config (migration 0030) so candidate-a demo works without UI.

## Gap 2 — Enumerator runs once at container boot

`nodes/poly/app/src/bootstrap/container.ts:720-773`:

```ts
const enumerated = await copyTradeTargetSource.listAllActive();  // once
if (enumerated.length === 0) return;
for (const enumeratedTarget of enumerated) {
  startMirrorPoll({ target, source, ledger, ... });  // one setInterval per target
}
```

Adding a target mid-flight does not produce a new `setInterval`. The only way a new target starts polling is a pod restart — which re-runs this code and re-enumerates.

**Fix:** either (i) re-run `listAllActive()` every poll tick and diff against the current set of running polls, adding/removing `setInterval` handles, or (ii) the proper fix per [task.0332](./task.0332.poly-mirror-shared-poller.md) — one batched poller with a `TargetSubscriptionRouter` that subscribes/unsubscribes on add/remove.

Gap 2 is partially covered by task.0332 already. This bug tightens the scope: task.0332 is "batched poller" (scale); gap 2 specifically is "any reload, ever" (correctness).

## Design

### Outcome

A user POSTs a tracked wallet through their own account → within one mirror-poll cadence (≤30s) the pod begins copy-trading that wallet under the user's tenant → no pod restart, no system-tenant bootstrap, no ops intervention.

### Approach

**Fix 1 (Gap 1) — POST implicitly opts the tenant in.** `POST /api/v1/poly/copy-trade/targets` upserts `poly_copy_trade_config { enabled: true }` for the calling tenant inside the same `withTenantScope(appDb, actorId, ...)` block that inserts the target. Semantics: `ON CONFLICT (billing_account_id) DO NOTHING` — an existing row (including a user-disabled one) is left untouched. POSTing a tracked wallet IS the explicit opt-in intent — if the user didn't want mirroring, they wouldn't add the wallet. The DB default (`enabled=false`) stays as the fail-closed safety net for bare-migrated tenants that never expressed intent.

**Fix 2 (Gap 2) — Reconciler loop replaces boot-time enumeration.** `container.ts` swaps "`listAllActive()` once at boot + one `setInterval` per target" for a reconciler that ticks every 30s, diffs the current active set against a `Map<key, MirrorJobStopFn>`, starts new polls, and invokes stop handles for removed targets. Key is `${billingAccountId}:${targetWallet.toLowerCase()}` — a stable pair `listAllActive()` already returns. No Postgres `LISTEN/NOTIFY`, no schema change. The per-target `setInterval` shape from PR #932 is preserved (task.0332 is the scale upgrade, not this bug).

### Reuses

- `withTenantScope` — RLS-clamped writes on the config upsert.
- `CopyTradeTargetSource.listAllActive` — already returns `(billingAccountId, createdByUserId, targetWallet)` triples joined against `config.enabled=true`. Reconciler calls it every tick.
- `startMirrorPoll(deps) → MirrorJobStopFn` — the stop handle has been on the return type since P1 but unused. Reconciler invokes it on target removal.
- `poly_copy_trade_config` PK on `billing_account_id` + existing RLS policy — enables the upsert with zero schema churn.

### Rejected

- **System-tenant seed migration (bug.0338's pre-design option #1).** User explicitly rejects — they trade manually via their own account, not a system principal. Seeding would paper over the real Phase-A gaps.
- **Shipping task.0332 (shared batched poller) now.** 3-point scope. task.0332 solves a scale problem (N wallets → 1 Data-API request per tick) that a single user's 1-3 tracked wallets does not have. Correctness here needs ≤40 LOC; task.0332 stays queued for Phase 3.
- **Postgres `LISTEN/NOTIFY` on `poly_copy_trade_targets`.** Extra moving parts (notify channel, listener registration, reconnect behavior). The mirror-poll cadence is already 30s — `LISTEN` wouldn't meaningfully shorten the feedback loop and would add a second failure mode.
- **`PATCH /config { enabled }` endpoint + dashboard toggle.** Not required for the bug fix. Filed as a follow-up if "pause without delete" UX is wanted.
- **DELETE of last target disables config.** Keep targets and config state decoupled. A user re-adding a wallet shouldn't have to rediscover a toggle.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST** — POST `/targets` upserts `poly_copy_trade_config` with `enabled=true`, `ON CONFLICT (billing_account_id) DO NOTHING`. Never overwrites an existing row. (spec: poly-multi-tenant-auth)
- [ ] **POLL_RECONCILES_PER_TICK** — mirror poll enumerator runs on every tick (30s cadence), not once at boot. Target added mid-flight is reflected in ≤30s; soft-deleted target stops polling in ≤30s. No pod restart. (spec: poly-multi-tenant-auth)
- [ ] **TENANT_SCOPED_WRITES_INTACT** — the new config upsert runs inside `withTenantScope(appDb, actorId, ...)`. RLS enforces `created_by_user_id = app.current_user_id` at `WITH CHECK`. No new BYPASSRLS write paths. (spec: poly-multi-tenant-auth § TENANT_SCOPED_ROWS + TENANT_DEFENSE_IN_DEPTH)
- [ ] **NO_NEW_MIGRATION** — schema is unchanged. The fix is route behavior + container wiring only. (bug scope discipline)
- [ ] **SIMPLE_SOLUTION** — reconciler ≤40 LOC; POST upsert ≤10 LOC. Reuses existing ports and return types. No new schemas, no new contracts.
- [ ] **ARCHITECTURE_ALIGNMENT** — matches Phase A spec § "Tenant resolution & bootstrap" — RLS-scoped route writes + BYPASSRLS enumerate + per-tenant inner loop. task.0332 shared-poller upgrade path stays clean. (spec: architecture)

### Files

- Modify: `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts` — add the `poly_copy_trade_config` upsert inside the POST handler's tenant-scoped transaction. Update file header invariants list.
- Modify: `nodes/poly/app/src/bootstrap/container.ts` — replace the one-shot `listAllActive()` + `for` loop (~lines 711-770) with a reconciler (`setInterval` + handle map + diff).
- (Optional) Create: `nodes/poly/app/src/bootstrap/copy-trade-reconciler.ts` — extract reconciler logic if it crosses ~30 LOC, for unit-testability.
- Test: `nodes/poly/app/tests/component/copy-trade/targets-route.int.test.ts` — extend: (a) fresh tenant POST → assert config row exists with `enabled=true`; (b) pre-seeded config with `enabled=false` → POST target → assert config remains `enabled=false` (onConflictDoNothing honored).
- Test (new): `nodes/poly/app/tests/unit/bootstrap/copy-trade-reconciler.test.ts` — stubbed `CopyTradeTargetSource` yielding sequences `[] → [A] → [A,B] → [B]` produces start(A), start(B), stop(A) in order; reconciler stop cleans up all handles.
- Modify: `docs/spec/poly-multi-tenant-auth.md` — add `CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST` + `POLL_RECONCILES_PER_TICK` invariants; add one Decisions row; add an acceptance check for the new-user end-to-end flow.
- Modify: `work/items/_index.md` — reflect `needs_implement` status.

### Checkpoints (for /implement)

**Checkpoint 1 — POST implicitly enables tenant config** ✅

- Milestone: a freshly-registered tenant can POST a target and GET returns `enabled:true` without any ops action; a pre-disabled tenant's config is not overwritten.
- Invariants: `CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST`, `TENANT_SCOPED_WRITES_INTACT`, `NO_NEW_MIGRATION`.
- Todos:
  - [x] POST handler upserts `polyCopyTradeConfig {enabled:true}` (onConflictDoNothing) inside the same `withTenantScope` tx.
  - [x] POST route file header Invariants block updated.
  - [x] `targets-route.int.test.ts` extended: fresh-tenant POST asserts config row + enabled=true; pre-disabled tenant POST asserts row unchanged.
- Validation: 4 tests pass (`pnpm exec vitest run --config nodes/poly/app/vitest.component.config.mts nodes/poly/app/tests/component/copy-trade/targets-route.int.test.ts`).

**Checkpoint 2 — Mirror reconciler replaces boot-time enumerator** ✅

- Milestone: pod detects new/removed targets within one tick cadence without restart.
- Invariants: `POLL_RECONCILES_PER_TICK`, `SIMPLE_SOLUTION`, `ARCHITECTURE_ALIGNMENT`.
- Todos:
  - [x] New `nodes/poly/app/src/bootstrap/copy-trade-reconciler.ts` — first-tick-immediate + `setInterval(30_000)`, keys running polls by `` `${billingAccountId}:${targetWallet.toLowerCase()}` ``, starts/stops per diff. `KEY_STABILITY`, `FIRST_TICK_IMMEDIATE`, `SELF_HEALING` invariants in the module header.
  - [x] `container.ts` wires the reconciler, stores stop handle on `_targetsReconcilerStop`, cleaned up in `resetContainer()`. Ledger reconciler (`startOrderReconciler`) runs once at boot as before.
  - [x] New events (avoiding collision with existing ledger-reconciler names): `POLY_MIRROR_TARGETS_RECONCILE_TICK` = `poly.mirror.targets.reconcile.tick` (plus `_TICK_ERROR` + `_STOPPED`). Updates the spec invariant wording accordingly.
  - [x] Unit test `copy-trade-reconciler.test.ts` — 6 cases including `[] → [A] → [A,B] → [B] → []` sequence, key stability across ticks, wallet case-variance dedupe, `listAllActive` throw recovery, idempotent stop.
- Validation: `pnpm --filter @cogni/poly-app exec vitest run tests/unit/bootstrap/copy-trade-reconciler.test.ts` (6 passed). `pnpm check` clean (full gate, ~60s packages-build + all lint/typecheck/tests).

**Checkpoint 3 — Candidate-a live validation**

- Milestone: real end-user flow proven on candidate-a with Loki evidence, `deploy_verified: true`.
- Invariants: `CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST`, `POLL_RECONCILES_PER_TICK`.
- Todos:
  - [ ] `/closeout` → PR against `main` → flight to candidate-a.
  - [ ] As a registered agent (my tenant, not system tenant): POST a `target_wallet`.
  - [ ] Loki query `{namespace="cogni-candidate-a"} |~ "poly.mirror.poll.singleton_claim"` within 60s of POST — expect ≥1 hit for the POSTed wallet. No intervening pod boot event.
  - [ ] Append deployed-SHA + Loki query URL to this item's `## Validation` block.
  - [ ] Set `deploy_verified: true`.

## Validation

- **exercise**: As a registered agent (not system tenant), `POST /api/v1/poly/copy-trade/targets {"target_wallet":"0x…"}` → `201 Created` with `enabled:true` in the response → within ≤60s the mirror pod claims the wallet.
- **observability**: `{namespace="cogni-candidate-a"} |~ "poly.mirror.poll.singleton_claim"` at the deployed SHA returns ≥1 line for the POSTed wallet; the preceding pod-local log line is a prior `poly.mirror.targets.reconcile.tick` (or initial empty-set boot line), NOT a fresh pod boot. Separate query `{...} |~ "poly.mirror.targets.reconcile.tick"` shows a ~30s cadence.

## Not in scope

- Per-user wallet custody / signing backends (Phase B).
- Per-user caps (inherits operator-wide scaffolding for Phase A).
- `PATCH /config { enabled }` endpoint + dashboard toggle UI. Follow-up task if pause-without-delete UX is wanted.
- task.0332 shared batched poller. Stays as the Phase-3 scale upgrade.
- System-tenant bootstrap seed. Explicitly rejected.
