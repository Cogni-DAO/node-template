// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/top-wallet-distributions`
 * Purpose: Read-only Data-API probe — render ASCII-histogram distributions for the
 *   two top target wallets so we can visualise their order-flow style. Six charts
 *   per wallet: trades-per-market-group, trades-per-event, trade-size USDC,
 *   entry-price (probability), DCA window (group first→last trade gap), and
 *   trades-per-day cadence.
 * Scope: Read-only. No PKs, no signing.
 * Side-effects: HTTPS to data-api.polymarket.com; stdout.
 * @internal
 */

import {
  PolymarketDataApiClient,
  type PolymarketUserTrade,
} from "@cogni/market-provider/adapters/polymarket";

const TARGETS = [
  {
    label: "RN1",
    proxyWallet: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  },
  {
    label: "swisstony",
    proxyWallet: "0x204f72f35326db932158cba6adff0b9a1da95e14",
  },
] as const;

const BAR_WIDTH = 40;

function bar(count: number, max: number): string {
  if (max === 0) return "";
  const w = Math.round((count / max) * BAR_WIDTH);
  return "█".repeat(w);
}

interface Bucket {
  label: string;
  count: number;
}

function renderHist(title: string, buckets: Bucket[], note?: string): void {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const labelW = Math.max(...buckets.map((b) => b.label.length));
  console.log(`\n### ${title}`);
  if (note) console.log(`_${note}_`);
  console.log("```");
  for (const b of buckets) {
    const pad = b.label.padStart(labelW);
    const cnt = String(b.count).padStart(5);
    console.log(`${pad} | ${cnt}  ${bar(b.count, max)}`);
  }
  console.log("```");
}

function bucketise(
  values: number[],
  edges: number[],
  fmt: (lo: number, hi: number) => string
): Bucket[] {
  const buckets: Bucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const count = values.filter((v) => v >= lo && v < hi).length;
    buckets.push({ label: fmt(lo, hi), count });
  }
  // overflow
  const lastLo = edges[edges.length - 1];
  const overflow = values.filter((v) => v >= lastLo).length;
  if (overflow > 0) {
    buckets.push({ label: `≥${lastLo}`, count: overflow });
  }
  return buckets;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[idx];
}

function analyzeAndRender(label: string, trades: PolymarketUserTrade[]): void {
  console.log(`\n## ${label} — distributions (n = ${trades.length} trades)`);

  // === 1. Trades per (conditionId, outcome) group ===
  const groupCounts = new Map<string, number>();
  for (const t of trades) {
    const key = `${t.conditionId}:${t.outcome}`;
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }
  const groupSizes = [...groupCounts.values()];
  renderHist(
    `Trades per (market, outcome) group — DCA depth`,
    bucketise(
      groupSizes,
      [1, 2, 3, 5, 10, 20, 50],
      (lo, hi) => `${lo}-${hi - 1}`
    ),
    `${groupSizes.length} unique (market,outcome) groups; max=${Math.max(...groupSizes)}, p50=${quantile(groupSizes, 0.5)}, p90=${quantile(groupSizes, 0.9)}`
  );

  // === 2. Trades per event (eventSlug) ===
  const eventCounts = new Map<string, number>();
  for (const t of trades) {
    const key = (t.eventSlug || t.slug || t.conditionId) as string;
    eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
  }
  const eventSizes = [...eventCounts.values()];
  renderHist(
    `Trades per parent event — multi-market clustering`,
    bucketise(
      eventSizes,
      [1, 2, 3, 5, 10, 20, 50, 100],
      (lo, hi) => `${lo}-${hi - 1}`
    ),
    `${eventSizes.length} unique events; max=${Math.max(...eventSizes)}, p50=${quantile(eventSizes, 0.5)}, p90=${quantile(eventSizes, 0.9)} → an event with N trades = N orders spread across that event's outcomes/spreads/totals`
  );

  // Top events by trade count
  const topEvents = [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`\n**Top 5 events by # trades:**`);
  for (const [slug, n] of topEvents) {
    const sample = trades.find((t) => (t.eventSlug || t.slug) === slug);
    const title = sample?.title || slug;
    console.log(`- ${n} trades — ${title.slice(0, 70)}`);
  }

  // === 3. Trade USDC notional distribution ===
  const usdcs = trades.map((t) => t.size * t.price);
  renderHist(
    `Trade size — USDC notional (log buckets)`,
    bucketise(
      usdcs,
      [0, 10, 50, 100, 500, 1000, 5000, 10000],
      (lo, hi) => `$${lo}-${hi}`
    ),
    `min=$${Math.min(...usdcs).toFixed(2)}, p50=$${quantile(usdcs, 0.5).toFixed(0)}, p90=$${quantile(usdcs, 0.9).toFixed(0)}, max=$${Math.max(...usdcs).toFixed(0)}`
  );

  // === 4. Entry price (probability) distribution ===
  const prices = trades.map((t) => t.price);
  renderHist(
    `Entry price (probability) — favorite vs longshot`,
    [
      { lo: 0.0, hi: 0.05, lbl: "0.00-0.05 (deep dog)" },
      { lo: 0.05, hi: 0.15, lbl: "0.05-0.15" },
      { lo: 0.15, hi: 0.3, lbl: "0.15-0.30" },
      { lo: 0.3, hi: 0.45, lbl: "0.30-0.45" },
      { lo: 0.45, hi: 0.55, lbl: "0.45-0.55 (coin)" },
      { lo: 0.55, hi: 0.7, lbl: "0.55-0.70" },
      { lo: 0.7, hi: 0.85, lbl: "0.70-0.85" },
      { lo: 0.85, hi: 0.95, lbl: "0.85-0.95 (fav)" },
      { lo: 0.95, hi: 1.01, lbl: "0.95-1.00 (lock)" },
    ].map((b) => ({
      label: b.lbl,
      count: prices.filter((p) => p >= b.lo && p < b.hi).length,
    })),
    `p50=${quantile(prices, 0.5).toFixed(2)}, p90=${quantile(prices, 0.9).toFixed(2)}`
  );

  // === 5. DCA window (per-group first→last trade gap, in minutes) ===
  const groupSpansMin: number[] = [];
  const tradesByGroup = new Map<string, PolymarketUserTrade[]>();
  for (const t of trades) {
    const key = `${t.conditionId}:${t.outcome}`;
    const arr = tradesByGroup.get(key) || [];
    arr.push(t);
    tradesByGroup.set(key, arr);
  }
  for (const arr of tradesByGroup.values()) {
    if (arr.length < 2) continue;
    const ts = arr.map((t) => t.timestamp);
    const span = (Math.max(...ts) - Math.min(...ts)) / 60;
    groupSpansMin.push(span);
  }
  renderHist(
    `Per-group DCA window — first→last trade in same (market,outcome)`,
    [
      { lo: 0, hi: 1, lbl: "0-1 min" },
      { lo: 1, hi: 5, lbl: "1-5 min" },
      { lo: 5, hi: 30, lbl: "5-30 min" },
      { lo: 30, hi: 60, lbl: "30-60 min" },
      { lo: 60, hi: 240, lbl: "1-4 hr" },
      { lo: 240, hi: 1440, lbl: "4-24 hr" },
      { lo: 1440, hi: 1440 * 7, lbl: "1-7 days" },
      { lo: 1440 * 7, hi: 1e9, lbl: "≥7 days" },
    ].map((b) => ({
      label: b.lbl,
      count: groupSpansMin.filter((s) => s >= b.lo && s < b.hi).length,
    })),
    `${groupSpansMin.length} groups with ≥2 trades. Single-shot groups (n=1) excluded. p50=${quantile(groupSpansMin, 0.5).toFixed(1)}min, p90=${quantile(groupSpansMin, 0.9).toFixed(0)}min`
  );

  // === 6. Trades per day (cadence) ===
  const dayCounts = new Map<string, number>();
  for (const t of trades) {
    const day = new Date(t.timestamp * 1000).toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  const days = [...dayCounts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  renderHist(
    `Trades per day — recency cadence (last ${days.length} active days)`,
    days.map(([d, n]) => ({ label: d, count: n })),
    `total span ${days[0]?.[0]} → ${days[days.length - 1]?.[0]}; per-day p50=${quantile([...dayCounts.values()], 0.5)}, p90=${quantile([...dayCounts.values()], 0.9)}`
  );

  // === 7. Hour-of-day (UTC) ===
  const hourCounts = new Array(24).fill(0);
  for (const t of trades) {
    const h = new Date(t.timestamp * 1000).getUTCHours();
    hourCounts[h] += 1;
  }
  renderHist(
    `Hour-of-day (UTC) — when do they trade?`,
    hourCounts.map((c, h) => ({ label: `${String(h).padStart(2, "0")}:00`, count: c })),
    `peak=${hourCounts.indexOf(Math.max(...hourCounts))}:00 UTC`
  );
}

async function main(): Promise<void> {
  const client = new PolymarketDataApiClient();
  console.log(
    `# Top-2 Wallet Order-Flow Distributions — ${new Date().toISOString().slice(0, 10)}`
  );
  console.log(
    `\nSource: Data-API \`/trades?user=…&limit=1000\` (most recent 1000 fills per wallet).`
  );
  for (const t of TARGETS) {
    console.error(`[fetch] ${t.label}`);
    const trades = await client.listUserTrades(t.proxyWallet, { limit: 1000 });
    analyzeAndRender(`${t.label}  ${t.proxyWallet}`, trades);
  }
}

main().catch((err: unknown) => {
  console.error("[fatal]", err);
  process.exit(1);
});
