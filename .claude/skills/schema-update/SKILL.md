---
name: schema-update
description: Use any time you are about to add, change, or migrate a Postgres or Doltgres table in this node — editing schema TS under `packages/db-schema/src` or `packages/doltgres-schema/src`, running `drizzle-kit generate`, writing a migration `.sql`, touching `meta/_journal.json` / `*_snapshot.json`, or debugging a migration that didn't apply on candidate. Mandatory before any schema edit.
---

# schema-update

The minimal procedure for changing a table in this node. Follow it; don't improvise.

This node is a single repo (no monorepo `nodes/<node>/` tree). Two data planes:

| Plane    | Schema source                  | Migrations out                                   | Purpose                                    |
| -------- | ------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| Postgres | `packages/db-schema/src/`      | `app/src/adapters/server/db/migrations`          | Operational data                           |
| Doltgres | `packages/doltgres-schema/src/`| `app/src/adapters/server/db/doltgres-migrations` | AI-written knowledge (`knowledge_*` tables) |

drizzle-kit reads these via `drizzle.config.ts` (Postgres) and `drizzle.doltgres.config.ts` (Doltgres). Both require `DATABASE_URL` in the environment.

## Postgres — the only path

1. **Edit the schema TS** under `packages/db-schema/src/` (e.g. `ai.ts`, `auth.ts`, `identity.ts`; barrel `index.ts`). Never put schema under `app/src/...` — the drizzle config globs only `packages/db-schema/src/**/*.ts`, so it won't see it and `generate` produces no diff.
2. **Generate.** `DATABASE_URL=<dsn> pnpm drizzle-kit generate --config=drizzle.config.ts`. drizzle-kit emits `NNNN_<tag>.sql`, the `meta/_journal.json` entry, and `meta/NNNN_snapshot.json` together. **Inspect the `.sql`** — drop any unintended `DROP TABLE` it proposes for orphaned/out-of-tree tables.
3. **Validate the chain.** The snapshot `prevId` chain and journal `when` values must be intact. Journal `when` must be **strictly increasing**: a new entry whose `when` lands before a prior entry's `when` will silently no-op on deploy (see failure mode #1). If the auto-gen `Date.now()` produced a non-monotonic `when`, bump the new entry's `when` past the prior max.
4. Commit `NNNN_*.sql` + `meta/_journal.json` + `meta/NNNN_snapshot.json` **together, in one commit**. Never `--no-verify` a schema PR.
5. **Post-flight:** the migrator (`scripts/db/migrate.mjs`, run in the node's migrate initContainer) must log your tag as applied. If it didn't run, your column won't exist at runtime.

## Hand-authored fallback — only if drizzle-kit literally can't emit it

Valid triggers: RLS policies, `ALTER POLICY`, triggers, custom Postgres functions, ARRAY DEFAULTs the TS schema can't express. This repo already ships one (`0004_enable_rls.sql`). **Plain `ADD COLUMN`, CHECK, partial index, FK — auto-gen handles all of this.** When in doubt, try `generate` first.

Recipe (steps 1–4 atomic in one commit):

1. Write `NNNN_<tag>.sql`.
2. Append the journal entry; **`when` > max(prior `when`)**.
3. `cp meta/(N-1)_snapshot.json meta/NNNN_snapshot.json`; regenerate `id`, set `prevId` to the prior snapshot's `id`, edit `tables` to reflect your deltas.
4. Confirm the snapshot/`prevId` chain is unbroken.

Never edit a previously committed snapshot's `prevId` to silence a chain error. If the chain is broken, fix it forward.

## Doltgres — same shape, parallel pipeline

Doltgres is for AI-written knowledge (the `knowledge` table + companions); Postgres is for operational data. **Default for any AI-edited content: a new row in `knowledge` with a different `domain` + `tags`, NOT a new table.**

When you do need a new Doltgres table:

1. Edit `packages/doltgres-schema/src/`.
2. `DATABASE_URL=<doltgres-dsn> pnpm drizzle-kit generate --config=drizzle.doltgres.config.ts` (DSN points at the Doltgres knowledge DB, not Postgres).
3. Same `when` monotonicity check on the Doltgres journal.
4. Confirm the snapshot/`prevId` chain.
5. Adapter writes use `sql.unsafe()` + try-INSERT / catch-duplicate (extended-protocol params + `ON CONFLICT EXCLUDED` are broken on the Doltgres version in use). Don't "modernize" them — see `scripts/db/migrate-doltgres.mjs`, which narrows on the exact DDL-collision shapes drizzle-kit emits.
6. The Doltgres migrator (`scripts/db/migrate-doltgres.mjs`) chains a trailing `SELECT dolt_commit('-Am', '...')` to capture DDL into `dolt_log`. Keep it.

`scripts/db/verify-doltgres-schema.mjs` compares the latest snapshot against the live DB and throws `SCHEMA_DRIFT` if anything is missing — run/trust it post-migrate.

## Common failure modes (rank-ordered)

1. **Future-dated / non-monotonic `when`** silently no-ops your migration on candidate. The app pod has the schema code; the DB doesn't have the column. Symptom: `PostgresError: column "X" does not exist` shortly into deploy.
2. **Hand-authored when auto-gen would have worked** — broke the snapshot chain, missed the journal entry, or both.
3. **Schema edited under `app/src/...`** instead of `packages/*-schema/src/` — drizzle config doesn't see it; `generate` produces no diff.
4. **Unintended `DROP TABLE` committed unread** — orphan/out-of-tree tables vanish on next migrate.
5. **Pushed with `--no-verify`** — skipped validation, shipped a broken chain.

## Quick reference

```bash
# Postgres
DATABASE_URL=<pg-dsn>  pnpm drizzle-kit generate --config=drizzle.config.ts
node scripts/db/migrate.mjs                      # apply (also runs in migrate initContainer)

# Doltgres (AI knowledge plane)
DATABASE_URL=<dg-dsn>  pnpm drizzle-kit generate --config=drizzle.doltgres.config.ts
node scripts/db/migrate-doltgres.mjs             # apply + dolt_commit
node scripts/db/verify-doltgres-schema.mjs       # drift check
```

Layout:

```
packages/db-schema/src/                              Postgres schema (operational)
packages/doltgres-schema/src/                        Doltgres schema (AI knowledge)
drizzle.config.ts / drizzle.doltgres.config.ts       drizzle-kit CLI boundary (need DATABASE_URL)
app/src/adapters/server/db/migrations/               Postgres history (.sql + meta/)
app/src/adapters/server/db/doltgres-migrations/      Doltgres history (.sql + meta/)
scripts/db/migrate.mjs / migrate-doltgres.mjs        runtime migrators
```

## When to escalate

- Choosing Postgres vs Doltgres for a new table → keep AI content in `knowledge` rows; only add operational tables to Postgres.
- Migrator initContainer not firing or crash-looping → that's a deploy/image-wiring problem, not a schema one.
