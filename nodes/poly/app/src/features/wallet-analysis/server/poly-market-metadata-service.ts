// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/poly-market-metadata-service`
 * Purpose: Refresh `poly_market_metadata` rows by projecting already-persisted
 *   JSONB into typed columns. Pulls market_title / market_slug / event_slug /
 *   end_date from `poly_trader_current_positions.raw` (the `/positions`
 *   payload), and event_title from `poly_trader_fills.raw->'attributes'->'event_title'`
 *   (the `/trades` payload — `/positions` doesn't carry eventTitle, see bug.5018).
 *   Owns the only writes to `poly_market_metadata`; readers JOIN on `condition_id`.
 * Scope: Pure server service. Caller owns DB + logger; this module runs a
 *   single SQL upsert per tick.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: one canonical typed row per `condition_id`.
 *   - NO_NEW_HTTP: the projection runs entirely off data we already polled
 *     via `/positions` and `/trades` — zero new Polymarket calls. The Gamma
 *     `/markets?condition_ids=…` endpoint silently ignores its filter and
 *     was removed; readers fall back via COALESCE to the position raw when
 *     metadata rows haven't materialized yet.
 *   - LAST_OBSERVED_WINS: when multiple traders hold the same market, the
 *     row sourced from the most recently observed position wins
 *     (DISTINCT ON + ORDER BY last_observed_at DESC). Market-level fields
 *     are stable across traders, so this is deterministic in practice.
 * Side-effects: DB write (`poly_market_metadata`).
 * Links: nodes/poly/packages/db-schema/src/trader-activity.ts (table),
 *   nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.normalize-fill.ts
 *   (`event_title` is read from `trade.eventTitle` and persisted under
 *   `attributes.event_title` on the normalized fill).
 * @internal
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

type LoggerPort = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type RefreshMarketMetadataResult = {
  /** Distinct condition_ids the projection covered. */
  scanned: number;
  /** Rows upserted into `poly_market_metadata`. */
  written: number;
};

/**
 * Refresh `poly_market_metadata` by projecting position-raw JSONB into typed
 * columns. Single-statement upsert; idempotent modulo the `fetched_at`
 * timestamp.
 */
export async function refreshMarketMetadata(deps: {
  db: Db;
  logger: LoggerPort;
}): Promise<RefreshMarketMetadataResult> {
  let written = 0;
  try {
    // bug.5018: /positions JSONB lacks `eventTitle`, so projecting it here
    // always wrote NULL. `event_title` is carried on the /trades payload
    // (persisted on `poly_trader_fills.raw.attributes.event_title` via
    // normalize-fill); pull from there as the authoritative source. Project
    // one event_title per condition_id from the most recent fill that has
    // it set — market-level field, stable across fills, deterministic enough.
    const result = await deps.db.execute<{ condition_id: string }>(sql`
      WITH event_titles_from_fills AS (
        SELECT DISTINCT ON (condition_id)
          condition_id,
          NULLIF(raw->'attributes'->>'event_title', '') AS event_title
        FROM poly_trader_fills
        WHERE raw IS NOT NULL
          AND condition_id <> ''
          AND NULLIF(raw->'attributes'->>'event_title', '') IS NOT NULL
        ORDER BY condition_id, observed_at DESC
      )
      INSERT INTO poly_market_metadata (
        condition_id,
        market_title,
        market_slug,
        event_title,
        event_slug,
        end_date,
        raw,
        fetched_at
      )
      SELECT DISTINCT ON (cp.condition_id)
        cp.condition_id,
        NULLIF(cp.raw->>'title', '')                          AS market_title,
        NULLIF(cp.raw->>'slug', '')                           AS market_slug,
        COALESCE(NULLIF(cp.raw->>'eventTitle', ''), etf.event_title) AS event_title,
        NULLIF(cp.raw->>'eventSlug', '')                      AS event_slug,
        NULLIF(cp.raw->>'endDate', '')::timestamptz           AS end_date,
        cp.raw,
        now()                                                 AS fetched_at
      FROM poly_trader_current_positions cp
      LEFT JOIN event_titles_from_fills etf
        ON etf.condition_id = cp.condition_id
      WHERE cp.active = true
        AND cp.raw IS NOT NULL
        AND cp.condition_id <> ''
      ORDER BY cp.condition_id, cp.last_observed_at DESC
      ON CONFLICT (condition_id) DO UPDATE SET
        market_title = EXCLUDED.market_title,
        market_slug  = EXCLUDED.market_slug,
        event_title  = EXCLUDED.event_title,
        event_slug   = EXCLUDED.event_slug,
        end_date     = EXCLUDED.end_date,
        raw          = EXCLUDED.raw,
        fetched_at   = EXCLUDED.fetched_at
      RETURNING condition_id
    `);
    written = extractRowCount(result);
  } catch (err: unknown) {
    deps.logger.warn(
      {
        event: "poly.market_metadata.refresh",
        phase: "projection_error",
        err: err instanceof Error ? err.message : String(err),
      },
      "market metadata projection failed"
    );
    return { scanned: 0, written: 0 };
  }
  deps.logger.info(
    {
      event: "poly.market_metadata.refresh",
      phase: "tick_ok",
      scanned: written,
      written,
    },
    "market metadata refresh complete"
  );
  return { scanned: written, written };
}

/**
 * `db.execute` returns different shapes across the two drizzle drivers
 * (`postgres-js` returns an array-like; `node-postgres` returns a `QueryResult`
 * with `.rows`). Both are RETURNING-aware — we count the returned rows.
 */
function extractRowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
    const rowCount = (result as { rowCount?: unknown }).rowCount;
    if (typeof rowCount === "number") return rowCount;
  }
  return 0;
}
