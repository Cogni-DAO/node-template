// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/top-wallet-open-close-analysis`
 * Purpose: Read-only Data-API probe — characterize the open/close trading style of
 *   the two top-ranked target wallets from the 2026-04-28 curve screen (RN1 +
 *   swisstony). Per (conditionId, outcome) lifecycle: open ts, close ts, hold
 *   duration, BUY-vol vs SELL-vol, avg BUY px vs avg SELL px (sells-on-highs proxy),
 *   resolved-and-redeemed vs closed-on-CLOB. Writes a markdown summary to stdout.
 * Scope: Read-only. No PKs, no signing.
 * Side-effects: HTTPS to data-api.polymarket.com; stdout.
 * @internal
 */

import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";

const TARGETS = [
  {
    label: "RN1 (#1, $7.68M)",
    proxyWallet: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  },
  {
    label: "swisstony (#2, $6.56M)",
    proxyWallet: "0x204f72f35326db932158cba6adff0b9a1da95e14",
  },
] as const;

interface PositionGroup {
  conditionId: string;
  outcome: string;
  title: string;
  buys: { ts: number; size: number; price: number }[];
  sells: { ts: number; size: number; price: number }[];
}

interface Stats {
  totalTrades: number;
  buys: number;
  sells: number;
  buyUsdc: number;
  sellUsdc: number;
  groupsTotal: number;
  groupsClosedFully: number; // sells ≥ buys size
  groupsPartialClose: number; // some sells but < buys
  groupsHeldOpen: number; // 0 sells (rode position)
  redeemEvents: number;
  redeemUsdc: number;
  // Hold-time stats (closed-fully groups only, in days, first BUY → last SELL)
  holdDaysAvg: number;
  holdDaysMedian: number;
  // Sells-on-highs proxy: avg(sell_px) vs avg(buy_px) per group, share-weighted
  edgeWavgPxDiff: number; // mean over groups of (avgSellPx - avgBuyPx); for SAME outcome → positive = sold higher than bought
  topMarkets: { title: string; usdc: number }[];
  recentTrades: {
    ts: number;
    side: string;
    outcome: string;
    size: number;
    price: number;
    title: string;
  }[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function buildGroups(
  trades: Awaited<
    ReturnType<PolymarketDataApiClient["listUserTrades"]>
  >
): Map<string, PositionGroup> {
  const groups = new Map<string, PositionGroup>();
  for (const t of trades) {
    const key = `${t.conditionId}:${t.outcome || ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        conditionId: t.conditionId,
        outcome: t.outcome || "",
        title: t.title || "",
        buys: [],
        sells: [],
      };
      groups.set(key, g);
    }
    if (t.side === "BUY") {
      g.buys.push({ ts: t.timestamp, size: t.size, price: t.price });
    } else {
      g.sells.push({ ts: t.timestamp, size: t.size, price: t.price });
    }
  }
  return groups;
}

async function analyzeWallet(
  client: PolymarketDataApiClient,
  label: string,
  proxyWallet: string
): Promise<Stats> {
  console.error(`[fetch] ${label} ${proxyWallet}`);
  const trades = await client.listUserTrades(proxyWallet, { limit: 1000 });
  console.error(`         /trades: ${trades.length} rows`);

  const groups = buildGroups(trades);

  let groupsClosedFully = 0;
  let groupsPartialClose = 0;
  let groupsHeldOpen = 0;
  const holdDays: number[] = [];
  const pxDiffs: number[] = [];
  const usdcByMarket = new Map<string, number>();

  let buyUsdc = 0;
  let sellUsdc = 0;
  let buys = 0;
  let sells = 0;

  for (const g of groups.values()) {
    const buySize = g.buys.reduce((a, b) => a + b.size, 0);
    const sellSize = g.sells.reduce((a, b) => a + b.size, 0);
    const buyU = g.buys.reduce((a, b) => a + b.size * b.price, 0);
    const sellU = g.sells.reduce((a, b) => a + b.size * b.price, 0);
    buyUsdc += buyU;
    sellUsdc += sellU;
    buys += g.buys.length;
    sells += g.sells.length;

    const titleKey = g.title || g.conditionId;
    usdcByMarket.set(
      titleKey,
      (usdcByMarket.get(titleKey) || 0) + buyU + sellU
    );

    if (sellSize >= buySize - 1e-6 && buySize > 0) {
      groupsClosedFully += 1;
      const firstBuy = Math.min(...g.buys.map((b) => b.ts));
      const lastSell = Math.max(...g.sells.map((s) => s.ts));
      const days = (lastSell - firstBuy) / 86400;
      if (days >= 0) holdDays.push(days);
    } else if (sellSize > 0) {
      groupsPartialClose += 1;
    } else {
      groupsHeldOpen += 1;
    }

    if (buySize > 0 && sellSize > 0) {
      const avgBuy = buyU / buySize;
      const avgSell = sellU / sellSize;
      pxDiffs.push(avgSell - avgBuy);
    }
  }

  const topMarkets = [...usdcByMarket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, usdc]) => ({ title, usdc }));

  // Activity for redeem events (the smoking gun: do they hold to resolution?)
  let redeemEvents = 0;
  let redeemUsdc = 0;
  try {
    const redeems = await client.listActivity(proxyWallet, {
      type: "REDEEM",
      limit: 500,
    });
    redeemEvents = redeems.length;
    redeemUsdc = redeems.reduce((acc, r) => acc + (r.usdcSize || 0), 0);
    console.error(`         /activity?REDEEM: ${redeems.length} events`);
  } catch (e) {
    console.error(`         /activity REDEEM failed:`, (e as Error).message);
  }

  const recentTrades = trades.slice(0, 8).map((t) => ({
    ts: t.timestamp,
    side: t.side,
    outcome: t.outcome || "",
    size: t.size,
    price: t.price,
    title: t.title || "",
  }));

  return {
    totalTrades: trades.length,
    buys,
    sells,
    buyUsdc,
    sellUsdc,
    groupsTotal: groups.size,
    groupsClosedFully,
    groupsPartialClose,
    groupsHeldOpen,
    redeemEvents,
    redeemUsdc,
    holdDaysAvg:
      holdDays.length === 0
        ? 0
        : holdDays.reduce((a, b) => a + b, 0) / holdDays.length,
    holdDaysMedian: median(holdDays),
    edgeWavgPxDiff:
      pxDiffs.length === 0
        ? 0
        : pxDiffs.reduce((a, b) => a + b, 0) / pxDiffs.length,
    topMarkets,
    recentTrades,
  };
}

function renderStats(label: string, s: Stats): void {
  const closeRatePct = ((s.groupsClosedFully / s.groupsTotal) * 100).toFixed(1);
  const heldPct = ((s.groupsHeldOpen / s.groupsTotal) * 100).toFixed(1);

  console.log(`\n## ${label}`);
  console.log("");
  console.log(
    `| metric | value |\n|---|---:|\n` +
      `| /trades rows fetched | ${s.totalTrades} |\n` +
      `| BUY trades | ${s.buys} |\n` +
      `| SELL trades | ${s.sells} |\n` +
      `| BUY notional (USDC) | $${Math.round(s.buyUsdc).toLocaleString()} |\n` +
      `| SELL notional (USDC) | $${Math.round(s.sellUsdc).toLocaleString()} |\n` +
      `| (cond, outcome) groups | ${s.groupsTotal} |\n` +
      `| fully-closed via SELL | ${s.groupsClosedFully} (${closeRatePct}%) |\n` +
      `| partial close | ${s.groupsPartialClose} |\n` +
      `| held to resolution / open | ${s.groupsHeldOpen} (${heldPct}%) |\n` +
      `| REDEEM events | ${s.redeemEvents} |\n` +
      `| REDEEM USDC claimed | $${Math.round(s.redeemUsdc).toLocaleString()} |\n` +
      `| avg hold (days, closed only) | ${s.holdDaysAvg.toFixed(1)} |\n` +
      `| median hold (days, closed only) | ${s.holdDaysMedian.toFixed(1)} |\n` +
      `| avg(sell_px) − avg(buy_px) per group | ${s.edgeWavgPxDiff >= 0 ? "+" : ""}${s.edgeWavgPxDiff.toFixed(3)} |\n`
  );

  console.log(`\n**Top markets by activity (USDC notional)**`);
  for (const m of s.topMarkets) {
    console.log(`- $${Math.round(m.usdc).toLocaleString()} — ${m.title}`);
  }

  console.log(`\n**Most recent 8 trades**`);
  console.log(`| date | side | outcome | size | px | title |`);
  console.log(`|---|---|---|---:|---:|---|`);
  for (const t of s.recentTrades) {
    const title = t.title.slice(0, 50);
    console.log(
      `| ${fmtTs(t.ts)} | ${t.side} | ${t.outcome} | ${t.size.toFixed(0)} | ${t.price.toFixed(3)} | ${title} |`
    );
  }
}

async function main(): Promise<void> {
  const client = new PolymarketDataApiClient();
  const results: { label: string; stats: Stats }[] = [];

  for (const t of TARGETS) {
    const stats = await analyzeWallet(client, t.label, t.proxyWallet);
    results.push({ label: t.label, stats });
  }

  console.log(`# Top-2 Wallet Open/Close Style — ${new Date().toISOString().slice(0, 10)}`);
  console.log("");
  console.log(
    "Source: Polymarket Data-API `/trades` (default limit 1000) + `/activity?type=REDEEM`. " +
      "Position lifecycle inferred per `(conditionId, outcome)` group from BUY/SELL fills. " +
      "REDEEM events confirm whether the wallet rides positions to resolution."
  );

  for (const r of results) renderStats(r.label, r.stats);
}

main().catch((err: unknown) => {
  console.error("[fatal]", err);
  process.exit(1);
});
