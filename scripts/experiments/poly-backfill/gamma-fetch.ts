// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/poly-backfill/gamma-fetch`
 * Purpose: spike.5024 v0 — pull Gamma `/markets?condition_ids=<one>` for every
 *   unique conditionId found in a backfill NDJSON file. Writes one NDJSON line
 *   per market with the resolution-relevant subset of fields needed to seed
 *   `poly_market_outcomes` once CP3 (`task.5018`) wires its writer. Runs at
 *   fan-out=10; empirically all-200 with no rate limiting from a single host.
 * Scope: read-only Gamma fetch + NDJSON write. Does not touch the Data API.
 *   Does not write to any DB.
 * Invariants: deduplicates conditionIds before issuing requests; tolerates
 *   missing markets (Gamma occasionally returns `[]` for valid IDs); preserves
 *   the full Gamma payload in `raw` so the eventual writer can pick fields.
 * Side-effects: IO (unauthenticated HTTPS to gamma-api.polymarket.com; reads
 *   one NDJSON file from disk; writes one NDJSON file to disk).
 * Links: docs/research/poly/backfill-spike-2026-05-05.md, work item spike.5024
 * @internal — experiment code, not shipped to production
 */

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const FAN_OUT = 10;

interface Args {
  inFile: string;
  outFile: string;
  fanOut: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const inFile = get("in");
  const outFile = get("out");
  if (!inFile || !outFile) {
    throw new Error("usage: gamma-fetch --in <fills.ndjson> --out <markets.ndjson> [--fan-out N]");
  }
  return {
    inFile,
    outFile,
    fanOut: Number(get("fan-out") ?? FAN_OUT),
  };
}

async function readUniqueConditionIds(path: string): Promise<string[]> {
  const seen = new Set<string>();
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.conditionId && typeof r.conditionId === "string") seen.add(r.conditionId);
    } catch {
      /* skip malformed line */
    }
  }
  return [...seen];
}

interface GammaMarket {
  id?: string;
  conditionId: string;
  question?: string;
  closed?: boolean;
  active?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  closedTime?: string;
  resolutionSource?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  umaResolution?: unknown;
  volume?: number;
  liquidity?: number;
  // ...86 fields total; preserve all of `raw`.
  [k: string]: unknown;
}

async function fetchOne(conditionId: string): Promise<GammaMarket | null> {
  const url = new URL("/markets", GAMMA_BASE);
  url.searchParams.set("condition_ids", conditionId);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.warn(`  [gamma] ${resp.status} ${resp.statusText} for ${conditionId}`);
    return null;
  }
  const json = await resp.json();
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[0] as GammaMarket;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const t0 = Date.now();
  const ids = await readUniqueConditionIds(args.inFile);
  console.log(`[gamma-fetch] ${ids.length} unique conditionIds from ${args.inFile}`);

  const out = createWriteStream(args.outFile, { encoding: "utf8" });
  let ok = 0;
  let miss = 0;

  // Simple worker pool — N parallel fetches at a time.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= ids.length) return;
      const cid = ids[i];
      const m = await fetchOne(cid);
      if (m) {
        out.write(`${JSON.stringify(m)}\n`);
        ok++;
      } else {
        miss++;
      }
      if ((ok + miss) % 100 === 0) {
        const rate = ((ok + miss) / ((Date.now() - t0) / 1000)).toFixed(0);
        console.log(`  [gamma] ${ok + miss}/${ids.length}  ok=${ok} miss=${miss}  ${rate}/s`);
      }
    }
  }
  await Promise.all(Array.from({ length: args.fanOut }, () => worker()));

  await new Promise<void>((res) => out.end(res));
  console.log(
    `[gamma-fetch] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ok=${ok} miss=${miss} of ${ids.length} -> ${args.outFile}`
  );
}

main().catch((err: unknown) => {
  console.error("[gamma-fetch] unhandled:", err);
  process.exit(1);
});
