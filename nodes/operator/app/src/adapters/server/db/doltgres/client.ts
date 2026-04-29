// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/db/doltgres/client`
 * Purpose: Lazy operator-Doltgres `Sql` singleton + adapter wiring for the work_items API.
 * Scope: Builds a postgres.js client and a `DoltgresOperatorWorkItemAdapter`. Mirrors `drizzle.client.ts` shape.
 * Invariants: Single connection per process; lazy initialization; throws `DoltgresNotConfiguredError` when `DOLTGRES_URL` is unset.
 * Side-effects: IO (database connection on first access).
 * Links: docs/spec/work-items-port.md, work/items/task.0424.doltgres-work-items-source-of-truth.md
 * @internal
 */

import { buildDoltgresClient } from "@cogni/knowledge-store/adapters/doltgres";
import type { Sql } from "postgres";

import { serverEnv } from "@/shared/env";

import { DoltgresOperatorWorkItemAdapter } from "./work-items-adapter";

export class DoltgresNotConfiguredError extends Error {
  constructor() {
    super(
      "Doltgres is not configured for this runtime. Set DOLTGRES_URL to enable the operator work-items API."
    );
    this.name = "DoltgresNotConfiguredError";
  }
}

let _sql: Sql | null = null;
let _adapter: DoltgresOperatorWorkItemAdapter | null = null;

function createSql(): Sql {
  const env = serverEnv();
  if (!env.DOLTGRES_URL) {
    throw new DoltgresNotConfiguredError();
  }
  return buildDoltgresClient({
    connectionString: env.DOLTGRES_URL,
    applicationName: `cogni_work_items_${env.SERVICE_NAME ?? "app"}`,
  });
}

export function getDoltgresSql(): Sql {
  if (!_sql) _sql = createSql();
  return _sql;
}

export function getDoltgresWorkItemsAdapter(): DoltgresOperatorWorkItemAdapter {
  if (!_adapter)
    _adapter = new DoltgresOperatorWorkItemAdapter(getDoltgresSql());
  return _adapter;
}
