// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/check-generate-clean`
 * Purpose: Fail-loud CI guard proving `drizzle-kit generate` produces no drift.
 * Scope: Runs drizzle-kit generate for the repo-root node template schema; does not connect to a DB or apply migrations.
 * Invariants: leaves no generated artifacts behind; passes only when schema TS matches the committed snapshot baseline.
 * Side-effects: IO (spawns drizzle-kit, transient migration files, git restore).
 */

// biome-ignore-all lint/suspicious/noConsole: validator script
// biome-ignore-all lint/style/noProcessEnv: script entry point

import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";

const CONFIG = "drizzle.config.ts";
const MIG = "app/src/adapters/server/db/migrations";

function snapshotDir() {
  return {
    sql: new Set(readdirSync(MIG).filter((f) => f.endsWith(".sql"))),
    meta: new Set(
      readdirSync(`${MIG}/meta`).filter(
        (f) => f.endsWith(".json") && f !== "_journal.json"
      )
    ),
  };
}

function restore(newSql, newMeta) {
  for (const f of newSql) rmSync(`${MIG}/${f}`, { force: true });
  for (const f of newMeta) rmSync(`${MIG}/meta/${f}`, { force: true });
  try {
    execSync(`git checkout -- ${MIG}/meta/_journal.json`, { stdio: "ignore" });
  } catch {
    /* journal unchanged */
  }
}

const before = snapshotDir();
let exitZero = true;
let output = "";
try {
  output = execFileSync(
    "tsx",
    ["node_modules/drizzle-kit/bin.cjs", "generate", `--config=${CONFIG}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: "postgres://check@localhost:0/check",
      },
      encoding: "utf8",
    }
  );
} catch (err) {
  exitZero = false;
  output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
}

const after = snapshotDir();
const newSql = [...after.sql].filter((f) => !before.sql.has(f));
const newMeta = [...after.meta].filter((f) => !before.meta.has(f));
const clean =
  exitZero &&
  newSql.length === 0 &&
  newMeta.length === 0 &&
  /No schema changes/.test(output);

if (clean) {
  console.log(
    "✓ check-generate-clean: db:generate produces no drift -- schema TS matches the snapshot baseline."
  );
  process.exit(0);
}

console.error(
  "✗ check-generate-clean: db:generate is NOT clean -- schema TS has drifted from the committed snapshot baseline."
);
for (const f of newSql) {
  console.error(`\n--- drizzle would generate ${f} ---`);
  try {
    console.error(readFileSync(`${MIG}/${f}`, "utf8"));
  } catch {
    /* already gone */
  }
}
if (!exitZero && newSql.length === 0) {
  console.error(
    "\ndrizzle-kit generate exited non-zero. Output:\n" + output.slice(-2000)
  );
}
restore(newSql, newMeta);
console.error(
  "\nFix: run `pnpm db:generate`, review the migration, and commit it (.sql + snapshot + journal)."
);
process.exit(1);
