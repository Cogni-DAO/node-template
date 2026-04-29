// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/db/doltgres/client`
 * Purpose: Lazy operator-Doltgres `Database` singleton — typed drizzle client over `knowledge_operator`.
 * Scope: Wraps `buildDoltgresClient` (postgres.js) + `drizzle()` with the operator-doltgres-schema. Mirrors `drizzle.client.ts` shape.
 * Invariants: Single connection per process; lazy initialization; throws `DoltgresNotConfiguredError` when `DOLTGRES_URL` is unset.
 * Side-effects: IO (database connection on first access).
 * Links: docs/spec/work-items-port.md, work/items/task.0423.doltgres-work-items-source-of-truth.md
 * @internal
 */

import { buildDoltgresClient } from "@cogni/knowledge-store/adapters/doltgres";
import * as schema from "@cogni/operator-doltgres-schema";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { serverEnv } from "@/shared/env";

import { DoltgresOperatorWorkItemAdapter } from "./work-items-adapter";

export type DoltgresDb = PostgresJsDatabase<typeof schema>;

export class DoltgresNotConfiguredError extends Error {
  constructor() {
    super(
      "Doltgres is not configured for this runtime. Set DOLTGRES_URL to enable the operator work-items API."
    );
    this.name = "DoltgresNotConfiguredError";
  }
}

let _db: DoltgresDb | null = null;
let _adapter: DoltgresOperatorWorkItemAdapter | null = null;

function createDb(): DoltgresDb {
  const env = serverEnv();
  if (!env.DOLTGRES_URL) {
    throw new DoltgresNotConfiguredError();
  }
  const sql = buildDoltgresClient({
    connectionString: env.DOLTGRES_URL,
    applicationName: `cogni_work_items_${env.SERVICE_NAME ?? "app"}`,
  });
  return drizzle(sql, { schema });
}

export function getDoltgresDb(): DoltgresDb {
  if (!_db) _db = createDb();
  return _db;
}

export function getDoltgresWorkItemsAdapter(): DoltgresOperatorWorkItemAdapter {
  if (!_adapter)
    _adapter = new DoltgresOperatorWorkItemAdapter(getDoltgresDb());
  return _adapter;
}
