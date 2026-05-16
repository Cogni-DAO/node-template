// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/migrate-doltgres`
 * Purpose: Doltgres migrator runner invoked as a Deployment initContainer. Forward-applying journal walker that reads drizzle-kit's meta/_journal.json and applies each missing migration via sql.unsafe (simple protocol — bypasses the Doltgres 0.56 extended-protocol Bind gap), records sha256 in drizzle.__drizzle_migrations, then trails dolt_commit so DDL lands in dolt_log.
 * Scope: Doltgres knowledge-plane migrations only. Does not migrate Postgres (sibling `migrate.mjs` handles that). Does not call drizzle-orm/postgres-js/migrator at runtime (Doltgres 0.56 rejects its parameterized tracking INSERT).
 * Invariants: DATABASE_URL from env; migrations folder from argv[2]; no tx wrapping; single-replica only.
 * Side-effects: IO (Doltgres connect, DDL apply, tracking-row insert, dolt_commit).
 * Notes: COPY'd into runtime image at /app/nodes/<node>/app/migrate-doltgres.mjs. Hash algo matches drizzle-orm tracking format.
 * Links: docs/spec/databases.md §2 Migration Strategy, https://docs.doltgres.com/, https://github.com/dolthub/doltgresql/issues/1990
 * @internal
 */

//
// WHY HAND-ROLLED INSTEAD OF drizzle-orm/postgres-js/migrator
//
// Doltgres is Postgres-compatible "in active development; many features
// missing" per upstream docs. The extended-protocol Bind path on the
// drizzle-kit tracking-row INSERT ("INSERT INTO drizzle.__drizzle_migrations
// VALUES ($1, $2)") is a known fragile surface — DoltHub's own blog flags
// it as "good enough for early customers, won't work in all cases":
//   https://www.dolthub.com/blog/2024-04-01-prepared-statements-postgres/
// Reported upstream:
//   - https://github.com/dolthub/doltgresql/issues/1990 (closed Nov 2025
//     via PR #1996 — "Unable to run subsequent drizzle migrations")
//   - https://github.com/dolthub/doltgresql/issues/2016 (open — drizzle push)
//   - https://github.com/dolthub/doltgresql/pull/2041 (prepared-statement fixes)
// Every general-purpose migrator (dbmate, golang-migrate, Flyway,
// node-pg-migrate) parameterizes the tracking-row INSERT the same way and
// hits the same Doltgres gap, so switching tools buys nothing. The minimal
// path that works today is sql.unsafe() throughout — postgres.js routes
// parameter-less queries via simple protocol, bypassing Bind.
//
// REMOVAL CONDITION
//
// When Doltgres ships a release where `INSERT INTO drizzle.__drizzle_migrations
// VALUES ($1, $2)` succeeds twice in a row (re: doltgresql#1990's fix
// landing in a stable tag we run), delete this script and switch back to
// drizzle-orm/postgres-js/migrator.migrate() — same call shape as
// scripts/db/migrate.mjs uses for Postgres. The hash algorithm here
// (sha256 of raw .sql text) matches drizzle-orm's tracking algorithm, so
// rows we write are forward-compatible with the official migrator.
//
// DDL AUTOCOMMIT
//
// Dolt DDL does not commit to the working set even inside a transaction
// (https://github.com/dolthub/dolt/issues/7485, closed via PR #8767). Two
// consequences:
//   1. We can apply statements one at a time without wrapping in BEGIN/COMMIT
//      — DDL takes effect immediately regardless.
//   2. Schema deltas don't land in dolt_log unless we explicitly call
//      `dolt_commit('-Am', …)` after. Trailing dolt_commit handles that.
//
// PARTIAL FAILURE SEMANTICS
//
// If statement N of migration M throws, earlier statements in M are already
// applied (DDL autocommit) but the __drizzle_migrations tracking row is
// never inserted. The script exits non-zero — initContainer crashloops with
// the real error. Next run will re-attempt migration M and likely hit
// "already exists" on the earlier statements. Acceptable for v0; the
// crashloop surfaces the real failure for human triage rather than
// silently masking partial state.
//
// CONCURRENCY
//
// No pg_try_advisory_lock — Doltgres advisory-lock support is unverified
// and we run replicas: 1. If we ever scale the app horizontally, this
// needs an app-level lease table.
//
// biome-ignore-all lint/suspicious/noConsole: initContainer CMD; stdout is the only log surface.
// biome-ignore-all lint/style/noProcessEnv: standalone script reads DATABASE_URL directly.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const NODE = process.env.MIGRATOR_LABEL?.trim() || "doltgres";
const STATEMENT_SEP = "--> statement-breakpoint";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(`FATAL(${NODE}): DATABASE_URL is required`);
  process.exit(2);
}

const migrationsFolder = process.argv[2];
if (!migrationsFolder) {
  console.error(`FATAL(${NODE}): argv[2] migrations dir is required`);
  process.exit(2);
}

function hashOfMigration(sqlText) {
  return createHash("sha256").update(sqlText).digest("hex");
}

function sqlEscape(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function splitStatements(sqlText) {
  return sqlText
    .split(STATEMENT_SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureTracking(sql) {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
  );
}

async function isApplied(sql, hash) {
  const rows = await sql.unsafe(
    `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${sqlEscape(hash)} LIMIT 1`
  );
  return rows.length > 0;
}

// True if the error indicates the statement's effect is already in the schema —
// safe to skip per-statement; the schema/data is what we'd have produced.
// Doltgres surfaces several distinct messages for "this thing is already
// there" (all errno 1105):
//   - "table with name X already exists"        (CREATE TABLE replay)
//   - "Duplicate key name 'idx_…'"               (CREATE INDEX replay)
//   - "Duplicate column name 'X'"                (ALTER ADD COLUMN replay)
//   - "Duplicate constraint name 'X'"            (FK / CHECK replay)
//   - "duplicate key value violates unique …"    (DML INSERT PK conflict on
//                                                  data-only migration replay)
// Postgres flavors ("already exists, skipping") match the first regex too.
function isAlreadyAppliedError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err?.cause instanceof Error ? err.cause.message : "";
  const combined = `${msg} ${cause}`;
  return (
    /already exists/i.test(combined) ||
    /duplicate (key (name|value)|column|constraint)/i.test(combined)
  );
}

// Apply each statement; tolerate "already exists" / "duplicate key value"
// per-statement so the walker is idempotent against partial-prior-state DBs
// (e.g. a fresh provision where a previous failed init left DDL applied but
// no tracking row). After all statements settle, stamp the tracking row so
// future runs skip via the hash check.
async function applyMigration(sql, entry, sqlText) {
  for (const stmt of splitStatements(sqlText)) {
    try {
      await sql.unsafe(stmt);
    } catch (err) {
      if (!isAlreadyAppliedError(err)) throw err;
      // Statement effect already present — log and continue.
      console.warn(
        `⚠  ${NODE} ${entry.tag}: skip statement (already-applied): ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`
      );
    }
  }
  await sql.unsafe(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${sqlEscape(hashOfMigration(sqlText))}, ${Number(entry.when)})`
  );
}

async function main() {
  const sql = postgres(url, {
    max: 1,
    onnotice: (n) => console.log(n.message),
  });
  const t0 = Date.now();
  let applied = 0;
  let skipped = 0;
  try {
    await ensureTracking(sql);
    const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    for (const entry of journal.entries ?? []) {
      const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
      const sqlText = await readFile(sqlPath, "utf8");
      if (await isApplied(sql, hashOfMigration(sqlText))) {
        skipped += 1;
        continue;
      }
      await applyMigration(sql, entry, sqlText);
      applied += 1;
    }
    await sql.unsafe(
      `SELECT dolt_commit('-Am', ${sqlEscape(`migrate(${NODE}): +${applied} new, ${skipped} already-applied`)})`
    );
    console.log(
      `✅ ${NODE}: +${applied} applied, ${skipped} already-applied in ${Date.now() - t0}ms`
    );
  } catch (err) {
    console.error(`FATAL(${NODE}): migrate failed:`, err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
