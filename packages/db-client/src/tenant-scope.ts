// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/tenant-scope`
 * Purpose: Transaction helpers that set PostgreSQL RLS tenant context via SET LOCAL.
 * Scope: Generic over any Drizzle PostgresJsDatabase schema type. Does not handle role switching or connection pooling.
 * Invariants:
 * - userId must be a valid UUID v4 (validated before interpolation into SQL)
 * - SET LOCAL scopes the setting to the current transaction only (no cross-request leakage)
 * - If userId is invalid, throws immediately (never reaches SQL)
 * Side-effects: IO (database transaction)
 * Notes: SET LOCAL does not accept parameterized $1 placeholders in PostgreSQL.
 *        We use sql.raw() after UUID format validation. This is safe because:
 *        1. The regex strictly limits the value to hex digits and hyphens
 *        2. The value comes from server-side JWT sessions, never from request body
 * Links: docs/DATABASE_RLS_SPEC.md
 * @public
 */

import { type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a Drizzle transaction with `app.current_user_id` set for RLS.
 *
 * Every query inside `fn` sees only rows belonging to `userId` per the
 * RLS policies defined in migration 0004_enable_rls.sql.
 *
 * Generic over any PostgresJsDatabase schema type — callers pass their
 * concrete `db` instance and TypeScript infers the schema.
 *
 * @throws {Error} If userId is not a valid UUID v4
 */
export async function withTenantScope<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: PostgresJsDatabase<TSchema>,
  userId: string,
  fn: (
    tx: Parameters<Parameters<PostgresJsDatabase<TSchema>["transaction"]>[0]>[0]
  ) => Promise<T>
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new Error(
      `withTenantScope: invalid userId format (expected UUID v4): ${userId}`
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_user_id = '${sql.raw(userId)}'`);
    return fn(tx);
  });
}

/**
 * Set tenant context inside an existing transaction.
 *
 * Use this when the caller already has a transaction (e.g., adapter methods
 * that use `db.transaction()` for atomicity). Call as the first statement.
 *
 * Accepts any Drizzle transaction-like object with an `execute` method,
 * so it works with any schema type.
 *
 * @throws {Error} If userId is not a valid UUID v4
 */
export async function setTenantContext(
  tx: { execute(query: SQL): Promise<unknown> },
  userId: string
): Promise<void> {
  if (!UUID_RE.test(userId)) {
    throw new Error(
      `setTenantContext: invalid userId format (expected UUID v4): ${userId}`
    );
  }

  await tx.execute(sql`SET LOCAL app.current_user_id = '${sql.raw(userId)}'`);
}
