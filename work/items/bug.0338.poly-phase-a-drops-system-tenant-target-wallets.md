---
id: bug.0338
type: bug
title: Phase A migration seeds system-tenant config but no tracked-wallet rows — pre-flight mirror targets dropped
status: needs_triage
priority: 1
rank: 20
estimate: 1
summary: task.0318 Phase A migration 0029_poly_copy_trade_multitenant.sql seeded `poly_copy_trade_config` for the system tenant (`enabled=true`) but did NOT seed any `poly_copy_trade_targets` rows. Before PR #944, candidate-a's mirror poll was driven by `COPY_TRADE_TARGET_WALLETS` env with BeefSlayer (`0x204f72f35326db932158cba6adff0b9a1da95e14`) + test wallet (`0x50f4748f1096Dcf792eF80f954eE30204Ee3c42B`). After the flight the env var is gone AND the DB has zero target rows — new pod logs `poly.mirror.poll.skipped {target_count:0}`. Mirror is running but placing nothing.
outcome: System-tenant's previously-tracked wallets are present in `poly_copy_trade_targets` on candidate-a; mirror poll resumes placing $1 copies of the target wallets' BUYs. No env regression.
spec_refs:
  - poly-multi-tenant-auth
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [poly, polymarket, copy-trading, regression, migration, candidate-a]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
---

# Phase A drops system-tenant target wallets on migration

> Surfaced immediately after PR #944 flight to candidate-a (SHA `be051abcc5`, 2026-04-20 ~09:12 UTC).

## Observation

New pod `poly-node-app-647bc98466-bx47x` at deployed SHA logs:

```json
{
  "event": "poly.mirror.poll.skipped",
  "has_bundle": true,
  "target_count": 0,
  "msg": "mirror poll not started (no active targets across any tenant)"
}
```

Pre-flight, the same mirror was tracking two wallets via the `COPY_TRADE_TARGET_WALLETS` env var:

- `0x204f72f35326db932158cba6adff0b9a1da95e14` (BeefSlayer — high-volume test target)
- `0x50f4748f1096Dcf792eF80f954eE30204Ee3c42B` (test wallet — PolymarketLedger test)

PR #944 CP A7 removed the env var. Migration 0029 was supposed to seed a replacement row in `poly_copy_trade_targets` for the system tenant to preserve behavior; it seeded only the `poly_copy_trade_config` row.

## Root cause

`nodes/poly/app/src/adapters/server/db/migrations/0029_poly_copy_trade_multitenant.sql:165-177` seeds:

```sql
INSERT INTO "poly_copy_trade_config" (...) VALUES (SYSTEM_BILLING, SYSTEM_USER, true, 'migration:0029');
```

but no corresponding `INSERT INTO poly_copy_trade_targets`. The work-item plan (A1 checkpoint) said "plus one optional `poly_copy_trade_targets` row preserving the existing single-operator candidate-a flight"; that seed was dropped during implementation.

## Impact

- **candidate-a:** mirror pod running but not placing. Demo is live but inert until targets are seeded.
- **preview / production:** no impact (they were not pre-seeded with `COPY_TRADE_TARGET_WALLETS` either).

## Fix plan

Preferred: **migration 0030 that seeds the two canonical target wallets for the system tenant**, making the state reproducible across fresh DBs.

```sql
-- 0030_seed_system_tenant_bootstrap_targets.sql
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-000000000001', true);
--> statement-breakpoint
INSERT INTO "poly_copy_trade_targets"
  ("billing_account_id", "created_by_user_id", "target_wallet")
VALUES
  ('00000000-0000-4000-b000-000000000000', '00000000-0000-4000-a000-000000000001',
   '0x204f72f35326db932158cba6adff0b9a1da95e14'),
  ('00000000-0000-4000-b000-000000000000', '00000000-0000-4000-a000-000000000001',
   '0x50f4748f1096Dcf792eF80f954eE30204Ee3c42B')
ON CONFLICT DO NOTHING;
```

Alternate: manual INSERT against candidate-a DB via `psql` then backport as a script — but this fails the "if it isn't in git, it didn't happen" axiom, so migration is preferred.

## Not in scope

- Per-user wallet custody (Phase B).
- Removing the system-tenant bootstrap — this is the intended fallback until per-user wallets ship.

## Validation

- exercise: apply migration 0030 on candidate-a → watch `poly.mirror.poll.singleton_claim` in Loki for both wallets → confirm `poly.mirror.decision` events fire on real fills.
- observability: Loki query `{namespace="cogni-candidate-a", service_name="app"} |~ "poly.mirror.poll.singleton_claim"` returns ≥2 rows (one per wallet) at the post-fix SHA.
