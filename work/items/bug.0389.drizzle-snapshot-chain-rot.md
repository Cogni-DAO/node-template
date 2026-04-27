---
id: bug.0389
type: bug
title: drizzle snapshot chain rot — `db:generate:poly` broken on main; wire `drizzle-kit check` per node
status: needs_implement
priority: 1
rank: 1
estimate: 1
branch: bug/0389-drizzle-chain-lint
summary: "On `main` today, `pnpm db:generate:poly` fails with `meta/0027_snapshot.json` self-referential `prevId` colliding with `0028_snapshot.json`. Root cause: PR #930 hand-stitched 0027 with `id == prevId` after the chain had already lost intermediate snapshots. Hand-authored RLS/trigger migrations across all three nodes have been committing `.sql` without matching snapshots. `drizzle-kit check` (upstream) detects this exact failure mode but is not wired into CI — so PR #930 merged without complaint."
outcome: "After this bug closes: (1) `pnpm db:check` runs `drizzle-kit check` against every node's drizzle config (operator + resy + poly Postgres + poly Doltgres) and is wired into the same CI rung that runs `check:docs`; (2) on `main` today, `db:check` fails on poly Postgres exactly as `db:generate:poly` does — making the rot a CI gate, not a silent-merge waiting to happen; (3) `docs/spec/databases.md` documents the hand-authored-migration recipe so the next RLS/trigger migration doesn't widen the gap. Restoring the broken poly chain itself is out of scope and tracked separately — this PR adds the gate that surfaces it."
spec_refs:
  - databases-spec
assignees: []
credit:
project: proj.database-ops
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [db, drizzle, infra, ci, multi-node]
external_refs:
---

# drizzle snapshot chain rot — wire `drizzle-kit check` per node

## Reproduction

```sh
git checkout main && pnpm install --frozen-lockfile
DATABASE_URL=postgres://x:x@localhost/x pnpm db:generate:poly
# Error: [meta/0027_snapshot.json, meta/0028_snapshot.json] are pointing to a parent
# snapshot: meta/0027_snapshot.json/snapshot.json which is a collision.

DATABASE_URL=postgres://x:x@localhost/x \
  npx drizzle-kit check --config=nodes/poly/drizzle.config.ts
# Same error — drizzle-kit's upstream `check` subcommand catches it.
```

`drizzle-kit check` on operator + resy passes today. So the gate is cheap to land and would have rejected PR #930 at PR-time.

## Evidence

| Node     | Journal entries | Snapshots present                                      | `drizzle-kit check` |
| -------- | --------------- | ------------------------------------------------------ | ------------------- |
| operator | 28              | 0000–0010, 0012–0014, 0016–0023, 0027                  | ✅ pass             |
| resy     | 28              | 0000–0010, 0012–0014, 0016–0023                        | ✅ pass             |
| poly     | 33              | 0000–0010, 0012–0014, 0016–0023, **0027 broken**, 0028 | ❌ collision        |

Pattern across all three: every missing snapshot maps to a hand-authored RLS / trigger / policy migration (`0011_triggers_and_backfill`, `0015_rls_identity_profile`, `0024_graph_runs_rls_requested_by`, `0029_poly_copy_trade_multitenant`, `0030_poly_wallet_connections`, `0031_poly_wallet_grants`, `0032_poly_wallet_trading_approvals`). Drizzle-kit can't model these in `generate`, devs hand-write the SQL, and skip the snapshot. `drizzle-kit check` tolerates missing intermediate snapshots — it only fails when the chain _head_ becomes inconsistent (as on poly).

Introduced by `1a27f7564` — _feat(poly): sync-truth ledger cache + release-surface cleanup (task.0328) (#930)_. That PR shipped `meta/0027_snapshot.json` with `id == prevId` (a manual stitch attempt to bypass a "no parent found" error caused by missing 0024–0026 snapshots).

## Why this matters

- Today: any poly schema change requires hand-authored SQL (task.0388 already doing this). The "drizzle-kit is the source of truth" intent of the codebase is silently broken for this node.
- Tomorrow: as `proj.database-ops` brings in new nodes (canary `ai-only`, etc.) and as more RLS work lands, the rot will repeat unless CI catches it.
- This is **not** the long-term fix tracked by [task.0325 — Atlas + GitOps migrations](task.0325.atlas-gitops-migrations.md). Atlas replaces drizzle-kit when scale warrants. This bug closes the integrity gap in the meantime.

## Scope (this PR)

### Phase 1 — MVP required cleanup

Goal: stop the bleed. Land a CI gate that fails on chain rot. Wire the upstream tool, don't reinvent it.

1. **`package.json` scripts** — mirror the existing `db:generate:*` shape:
   ```jsonc
   "db:check:operator":     "dotenv -e .env.local -- tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/operator/drizzle.config.ts",
   "db:check:resy":         "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_RESY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/resy/drizzle.config.ts'",
   "db:check:poly":         "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_POLY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/poly/drizzle.config.ts'",
   "db:check:poly:doltgres":"dotenv -e .env.local -- bash -c 'DATABASE_URL=$DOLTGRES_URL_POLY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/poly/drizzle.doltgres.config.ts'",
   "db:check": "pnpm db:check:operator && pnpm db:check:resy && pnpm db:check:poly && pnpm db:check:poly:doltgres",
   ```
   `drizzle-kit check` does not connect to the DB — `DATABASE_URL` only has to satisfy the config's required-env assertion. The dotenv prefix matches the equivalent `db:generate:*` scripts so a fresh `.env.local` is enough.
2. **CI wiring (partial)** — add a peer of `check:docs` in `scripts/check-all.sh` and `scripts/check-fast.sh` that invokes `db:check:operator && db:check:resy && db:check:poly:doltgres`. **`db:check:poly` is intentionally excluded** until the chain-restoration follow-up lands (otherwise `pnpm check` and the pre-push hook go red on every fresh checkout, violating the "main is holy clean" invariant for everyone working on poly-unrelated branches). The exclusion is single-line, explicitly comment-flagged, and the follow-up's diff is "remove the exclusion comment + extend the run_check command".
3. **Local proof** — `pnpm db:check:operator` + `pnpm db:check:resy` + `pnpm db:check:poly:doltgres` pass; `pnpm db:check:poly` fails with the documented collision (this is the _correct_ state of `main` today).

### Phase 2 — Spec guidance

Goal: make the right thing the easy thing for the next RLS/trigger migration.

4. **`docs/spec/databases.md` § "Hand-authored migrations"** — short recipe:
   - When to hand-author: drizzle-kit can't model RLS policies, triggers, `ALTER POLICY`, ARRAY DEFAULTs, custom functions, etc.
   - How to keep the snapshot chain whole: copy `meta/(N-1)_snapshot.json` to `meta/NNNN_snapshot.json`, regenerate `id` (any new UUID), set `prevId` to the prior snapshot's `id`, edit the `tables` block to reflect the DDL deltas your `.sql` applies, commit both files in the same commit.
   - Hard rule: never edit a _previously committed_ snapshot's `prevId` to "fix" a broken chain. That's how PR #930 happened. If `drizzle-kit check` fails, file a chain-restoration bug — don't paper over it.
   - One-line: `pnpm db:check` is the gate; if it goes red, fix the chain, not the script.

## Out of scope (separate followup)

Restoring poly's broken chain (regenerating snapshots for journal entries 0011, 0015, 0024–0026, 0027 (fix self-reference), 0029–0032). This bug intentionally lands the gate _while_ poly is red — the red state is documented, expected, and bounds the follow-up's blast radius.

Track as a separate `task — restore poly drizzle snapshot chain` (est 3) under `proj.database-ops` once the in-flight cluster (task.0387/0388) lands.

## Validation

```yaml
exercise: |
  cd <fresh worktree off this branch>
  pnpm install --frozen-lockfile
  pnpm db:check:operator           # passes
  pnpm db:check:resy               # passes
  pnpm db:check:poly:doltgres      # passes
  pnpm db:check:poly               # fails with "0027/0028 collision" — documents main's current rot
observability: none — pure CI/static check, no runtime emission
```

## Notes for the next agent

- This PR is intentionally tiny: ~6 lines in `package.json`, one CI hook line, one docs section. It is _not_ the chain-restoration PR.
- After merge, `pnpm db:check:poly` is RED on main. That is the point. The next PR up that branch is the chain-restoration task that turns it green.
