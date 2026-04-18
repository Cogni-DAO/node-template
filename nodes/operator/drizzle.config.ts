// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `drizzle.operator.config`
 * Purpose: Per-node drizzle-kit config for operator — generates/migrates against cogni_template_dev using the core schema package only.
 * Scope: Operator-node drizzle-kit CLI boundary. Does not handle runtime DB I/O.
 * Invariants: Schema glob covers only @cogni/db-schema core tables; no poly-local paths. Migrations dir is operator-owned.
 * Side-effects: IO (filesystem reads; drizzle-kit writes to ./nodes/operator/app/src/adapters/server/db/migrations)
 * Notes: Created by task.0322 — per-node DB schema independence.
 * Links: work/items/task.0322.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

import {
  buildDatabaseUrl,
  type DbEnvInput,
} from "./nodes/operator/app/src/shared/db/db-url";

function getDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) {
    try {
      new URL(direct);
      return direct;
    } catch {
      // fall back
    }
  }
  return buildDatabaseUrl(process.env as DbEnvInput);
}

export default defineConfig({
  schema: "./packages/db-schema/src/**/*.ts",
  out: "./nodes/operator/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: getDatabaseUrl() },
  verbose: true,
  strict: true,
});
