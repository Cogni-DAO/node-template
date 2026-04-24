// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
//
// Programmatic drizzle migrator for operator. Invoked as the migrator image CMD
// (Argo PreSync hook Job pod). Uses drizzle-orm + postgres (both production deps
// already resident in the runtime image via next.config.ts serverExternalPackages)
// so the migrator image can be `FROM runner` and share 99.9% of layers with
// the runtime image k3s already cached. See bug.0368 / task.0370.
//
// Usage: node migrate.mjs <migrations-dir>
//   argv[2] — absolute path to migrations dir (passed by Dockerfile CMD)
//   DATABASE_URL — required env
//
// Idempotent: reads drizzle.__drizzle_migrations journal, applies only new rows.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const NODE = "resy";

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

let sql;
try {
  sql = postgres(url, { max: 1, onnotice: () => {} });
  const t0 = Date.now();
  await migrate(drizzle(sql), { migrationsFolder });
  console.log(`✅ ${NODE} migrations applied in ${Date.now() - t0}ms (folder: ${migrationsFolder})`);
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
