// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/poly-backfill/load`
 * Purpose: spike.5024 v0 — load NDJSON produced by `walk.ts` into a target
 *   `poly_trader_fills` table, idempotent on
 *   `(trader_wallet_id, source, native_id)`. Mirrors what the live tick
 *   `runTraderObservationTick` already writes: same source label
 *   (`'data-api'`), same native_id shape
 *   (`data-api:<tx>:<asset>:<side>:<unix_s>`), same `raw` payload structure.
 *   When CP2 (#1245) lands in main this should be refactored to call
 *   `appendFills()` directly.
 * Scope: NDJSON -> Postgres bulk insert. Does not call any Polymarket API.
 *   Does not write `poly_market_outcomes` (that's CP3 / `task.5018` territory;
 *   `gamma-fetch.ts` stages the data, the loader for it lands separately).
 *   Does not update `poly_trader_ingestion_cursors` — leave the live tick's
 *   forward watermark untouched (backfill is strictly historical, behind it).
 * Invariants: refuses to run without an explicit `--apply` flag pointing at a
 *   target DSN; idempotent on the `(trader_wallet_id, source, native_id)`
 *   unique index; batches at 500 rows per insert to stay well under any
 *   parameter limit; never updates existing rows (ON CONFLICT DO NOTHING).
 * Side-effects: IO (reads NDJSON from disk; postgres-js INSERT to a poly DB).
 * Links: docs/research/poly/backfill-spike-2026-05-05.md, work item spike.5024
 * @internal — experiment code, not shipped to production
 */

import { readFileSync } from "node:fs";

import postgres from "postgres";

const SOURCE_LABEL = "data-api";
const BATCH_SIZE = 500;

interface Args {
  inFile: string;
  walletAddress: string;
  apply: boolean;
  dsn: string | undefined;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const inFile = get("in");
  const walletAddress = get("wallet-address");
  const apply = argv.includes("--apply");
  const dsn = process.env.DATABASE_URL_POLY;
  if (!inFile || !walletAddress) {
    throw new Error(
      "usage: load --in <fills.ndjson> --wallet-address 0x... [--apply]\n" +
        "  set DATABASE_URL_POLY env var when --apply is passed"
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new Error(`invalid --wallet-address: ${walletAddress}`);
  }
  return { inFile, walletAddress, apply, dsn };
}

interface ActivityRow {
  proxyWallet?: string;
  conditionId?: string;
  asset?: string;
  side?: string;
  size?: number;
  usdcSize?: number;
  price?: number;
  timestamp?: number;
  transactionHash?: string;
  outcome?: string;
  title?: string;
  slug?: string;
  eventSlug?: string;
}

interface FillRow {
  trader_wallet_id: string;
  source: string;
  native_id: string;
  condition_id: string;
  token_id: string;
  side: "BUY" | "SELL";
  price: string;
  shares: string;
  size_usdc: string;
  tx_hash: string | null;
  observed_at: Date;
  raw: Record<string, unknown>;
}

function toFillRow(row: ActivityRow, traderWalletId: string): FillRow | null {
  const ts = row.timestamp;
  const tx = row.transactionHash;
  const asset = row.asset;
  const side = row.side;
  const conditionId = row.conditionId;
  const price = row.price;
  const size = row.size;
  const usdcSize = row.usdcSize;
  if (!ts || !tx || !asset || !side || !conditionId) return null;
  if (side !== "BUY" && side !== "SELL") return null;
  if (!price || price <= 0) return null;
  if (!size || size <= 0) return null;
  if (!usdcSize || usdcSize <= 0) return null;
  return {
    trader_wallet_id: traderWalletId,
    source: SOURCE_LABEL,
    native_id: `${SOURCE_LABEL}:${tx}:${asset}:${side}:${ts}`,
    condition_id: conditionId,
    token_id: asset,
    side,
    price: price.toFixed(8),
    shares: size.toFixed(8),
    size_usdc: usdcSize.toFixed(8),
    tx_hash: tx,
    observed_at: new Date(ts * 1000),
    raw: {
      side,
      price,
      source: SOURCE_LABEL,
      fill_id: `${SOURCE_LABEL}:${tx}:${asset}:${side}:${ts}`,
      outcome: row.outcome ?? "",
      market_id: `prediction-market:polymarket:${conditionId}`,
      size_usdc: usdcSize,
      attributes: {
        slug: row.slug ?? "",
        asset,
        title: row.title ?? "",
        event_slug: row.eventSlug ?? "",
        condition_id: conditionId,
        timestamp_unix: ts,
        transaction_hash: tx,
      },
      observed_at: new Date(ts * 1000).toISOString(),
      target_wallet: row.proxyWallet ?? "",
      backfill_source: "spike.5024",
    },
  };
}

function parseAndDedupe(
  inFile: string,
  traderWalletId: string
): { rows: FillRow[]; n: number; dropped: number } {
  const lines = readFileSync(inFile, "utf8").split("\n");
  const seen = new Set<string>();
  const rows: FillRow[] = [];
  let dropped = 0;
  let n = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    n++;
    const r = toFillRow(JSON.parse(line), traderWalletId);
    if (!r) {
      dropped++;
      continue;
    }
    if (seen.has(r.native_id)) {
      dropped++;
      continue;
    }
    seen.add(r.native_id);
    rows.push(r);
  }
  return { rows, n, dropped };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[load] in=${args.inFile} wallet=${args.walletAddress} apply=${args.apply}`);

  if (!args.apply) {
    const { rows, n, dropped } = parseAndDedupe(args.inFile, "00000000-0000-0000-0000-000000000000");
    console.log(`[load] dry-run: total=${n} kept=${rows.length} dropped=${dropped}`);
    console.log("  sample row[0]:", JSON.stringify(rows[0], null, 2));
    return;
  }

  if (!args.dsn) throw new Error("--apply requires DATABASE_URL_POLY env var");
  const sql = postgres(args.dsn, { ssl: false, idle_timeout: 10, max: 1 });
  try {
    const wallets = await sql`
      SELECT id::text AS id, label
      FROM poly_trader_wallets
      WHERE wallet_address = ${args.walletAddress.toLowerCase()}
      LIMIT 1
    `;
    if (wallets.length === 0) {
      throw new Error(`wallet not found in poly_trader_wallets: ${args.walletAddress}`);
    }
    const traderWalletId = wallets[0].id as string;
    const label = wallets[0].label as string;
    console.log(`[load] target wallet: ${label} (${traderWalletId})`);

    const { rows, n, dropped } = parseAndDedupe(args.inFile, traderWalletId);
    console.log(`[load] parsed: total=${n} kept=${rows.length} dropped=${dropped}`);

    let inserted = 0;
    let skipped = 0;
    const t0 = Date.now();
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE) as unknown as Record<string, unknown>[];
      const result = await sql`
        INSERT INTO poly_trader_fills ${sql(batch)}
        ON CONFLICT (trader_wallet_id, source, native_id) DO NOTHING
        RETURNING 1 AS one
      `;
      inserted += result.length;
      skipped += batch.length - result.length;
      const done = i + batch.length;
      if (done % 5000 < BATCH_SIZE || done === rows.length) {
        const rate = (done / ((Date.now() - t0) / 1000)).toFixed(0);
        console.log(`  [load] ${done}/${rows.length} (inserted=${inserted} skipped=${skipped})  ${rate}/s`);
      }
    }
    console.log(
      `[load] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — inserted ${inserted}, skipped ${skipped} (already-present)`
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("[load] unhandled:", err);
  process.exit(1);
});
