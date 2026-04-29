// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/analysis/order-flow-distributions`
 * Purpose: Pure function that turns a wallet's raw trades + a map of resolved markets into bucket-counted, win/loss-split distribution histograms — DCA depth, trade size, entry price, DCA window, hour-of-day, plus a flat event-clustering histogram and top-events list.
 * Scope: No I/O, no time, no randomness (now() injected for testability). Does not fetch trades, does not call CLOB, does not mutate inputs.
 * Invariants:
 *   - PURE: same inputs → same outputs.
 *   - PENDING_IS_FIRST_CLASS — every per-fill bucket carries `won` / `lost` / `pending` counts and USDC sums.
 *   - DISTRIBUTIONS_ARE_PURE_DERIVATIONS — bucket data is `f(trades, resolutions, range)`. Never authored.
 *   - Bucket edges are constants (not quantile-derived) so bar charts stay comparable across wallets.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0425.poly-wallet-orderflow-distributions-d1.md
 * @public
 */

import type {
  MarketResolutionInput,
  WalletTradeInput,
} from "./wallet-metrics.js";

export type OutcomeStatus = "won" | "lost" | "pending";

export type OutcomeCounts = Readonly<{
  won: number;
  lost: number;
  pending: number;
}>;

export type OutcomeBuckets = Readonly<{
  count: OutcomeCounts;
  usdc: OutcomeCounts;
}>;

export type HistogramBucket = Readonly<{
  lo: number;
  hi: number;
  label: string;
  values: OutcomeBuckets;
}>;

export type Histogram = Readonly<{
  buckets: ReadonlyArray<HistogramBucket>;
}>;

export type FlatBucket = Readonly<{
  lo: number;
  hi: number;
  label: string;
  count: number;
  usdc: number;
}>;

export type FlatHistogram = Readonly<{
  buckets: ReadonlyArray<FlatBucket>;
}>;

export type Quantiles = Readonly<{
  p50: number;
  p90: number;
  max: number;
}>;

export type TopEvent = Readonly<{
  slug: string;
  title: string;
  tradeCount: number;
  usdcNotional: number;
}>;

export type Distributions = Readonly<{
  range: Readonly<{ fromTs: number; toTs: number; n: number }>;
  dcaDepth: Histogram;
  tradeSize: Histogram;
  entryPrice: Histogram;
  dcaWindow: Histogram;
  hourOfDay: Histogram;
  eventClustering: FlatHistogram;
  topEvents: ReadonlyArray<TopEvent>;
  pendingShare: Readonly<{ byCount: number; byUsdc: number }>;
  quantiles: Readonly<{
    dcaDepth: Quantiles;
    tradeSize: Quantiles;
    dcaWindowMin: Quantiles;
  }>;
}>;

export type OrderFlowTrade = WalletTradeInput &
  Readonly<{
    eventSlug?: string | null;
    slug?: string | null;
  }>;

export type SummariseOrderFlowOptions = Readonly<{
  /** Injected clock (unix seconds). Defaults to Date.now. */
  nowSec?: number;
  /** Cap on `topEvents` (default 10). */
  topEventsLimit?: number;
}>;

/**
 * Finite sentinel for bucket upper edges. Avoids `Number.POSITIVE_INFINITY`
 * because `JSON.stringify(Infinity) === "null"` would silently violate the
 * `HistogramBucketSchema.hi: z.number()` contract on the wire.
 */
const BUCKET_UPPER_SENTINEL = Number.MAX_SAFE_INTEGER;

const TRADE_SIZE_EDGES: ReadonlyArray<number> = [
  0, 10, 50, 100, 500, 1000, 5000, 10000, BUCKET_UPPER_SENTINEL,
];
const TRADE_SIZE_LABELS: ReadonlyArray<string> = [
  "$0-10",
  "$10-50",
  "$50-100",
  "$100-500",
  "$500-1k",
  "$1k-5k",
  "$5k-10k",
  "≥$10k",
];

const ENTRY_PRICE_EDGES: ReadonlyArray<number> = [
  0, 0.05, 0.15, 0.3, 0.45, 0.55, 0.7, 0.85, 0.95, 1.0001,
];
const ENTRY_PRICE_LABELS: ReadonlyArray<string> = [
  "0.00-0.05",
  "0.05-0.15",
  "0.15-0.30",
  "0.30-0.45",
  "0.45-0.55",
  "0.55-0.70",
  "0.70-0.85",
  "0.85-0.95",
  "0.95-1.00",
];

const DCA_DEPTH_EDGES: ReadonlyArray<number> = [
  1, 2, 3, 5, 10, 20, 50, BUCKET_UPPER_SENTINEL,
];
const DCA_DEPTH_LABELS: ReadonlyArray<string> = [
  "1",
  "2",
  "3-4",
  "5-9",
  "10-19",
  "20-49",
  "≥50",
];

const DCA_WINDOW_MIN_EDGES: ReadonlyArray<number> = [
  0, 1, 5, 30, 60, 240, 1440, 10080, BUCKET_UPPER_SENTINEL,
];
const DCA_WINDOW_LABELS: ReadonlyArray<string> = [
  "0-1m",
  "1-5m",
  "5-30m",
  "30-60m",
  "1-4h",
  "4-24h",
  "1-7d",
  "≥7d",
];

const EVENT_CLUSTER_EDGES: ReadonlyArray<number> = [
  1, 2, 3, 5, 10, 20, 50, 100, BUCKET_UPPER_SENTINEL,
];
const EVENT_CLUSTER_LABELS: ReadonlyArray<string> = [
  "1",
  "2",
  "3-4",
  "5-9",
  "10-19",
  "20-49",
  "50-99",
  "≥100",
];

const ZERO_COUNTS: OutcomeCounts = { won: 0, lost: 0, pending: 0 };

function emptyBuckets(): OutcomeBuckets {
  return { count: { ...ZERO_COUNTS }, usdc: { ...ZERO_COUNTS } };
}

function classifyFill(
  trade: OrderFlowTrade,
  resolutions: ReadonlyMap<string, MarketResolutionInput>
): OutcomeStatus {
  const m = resolutions.get(trade.conditionId);
  if (!m || !m.closed) return "pending";
  const tokenInfo = m.tokens.find((x) => x.token_id === trade.asset);
  if (!tokenInfo) return "pending";
  return tokenInfo.winner ? "won" : "lost";
}

function bucketIndex(value: number, edges: ReadonlyArray<number>): number {
  for (let i = 0; i < edges.length - 1; i++) {
    if (value >= edges[i]! && value < edges[i + 1]!) return i;
  }
  return -1;
}

function makeHistogramBuckets(
  edges: ReadonlyArray<number>,
  labels: ReadonlyArray<string>
): HistogramBucket[] {
  return labels.map((label, i) => ({
    lo: edges[i]!,
    hi: edges[i + 1]!,
    label,
    values: emptyBuckets(),
  }));
}

function addToBucket(
  buckets: HistogramBucket[],
  index: number,
  status: OutcomeStatus,
  usdc: number
): void {
  if (index < 0 || index >= buckets.length) return;
  const b = buckets[index]!;
  const counts = b.values.count as { -readonly [K in keyof OutcomeCounts]: number };
  const usdcs = b.values.usdc as { -readonly [K in keyof OutcomeCounts]: number };
  counts[status] += 1;
  usdcs[status] += usdc;
}

function quantile(xs: ReadonlyArray<number>, q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[idx]!;
}

function makeQuantiles(xs: ReadonlyArray<number>): Quantiles {
  if (xs.length === 0) return { p50: 0, p90: 0, max: 0 };
  return {
    p50: quantile(xs, 0.5),
    p90: quantile(xs, 0.9),
    max: xs.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY),
  };
}

/**
 * Compute order-flow distribution histograms from a wallet's trade log joined
 * against CLOB market resolutions. Pure — same inputs always produce the same
 * output.
 */
export function summariseOrderFlow(
  trades: ReadonlyArray<OrderFlowTrade>,
  resolutions: ReadonlyMap<string, MarketResolutionInput>,
  options?: SummariseOrderFlowOptions
): Distributions {
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const topLimit = options?.topEventsLimit ?? 10;

  const tradeSize = makeHistogramBuckets(TRADE_SIZE_EDGES, TRADE_SIZE_LABELS);
  const entryPrice = makeHistogramBuckets(ENTRY_PRICE_EDGES, ENTRY_PRICE_LABELS);
  const hourOfDay = makeHistogramBuckets(
    Array.from({ length: 25 }, (_, i) => i),
    Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
  );

  type GroupAgg = {
    fills: number;
    firstTs: number;
    lastTs: number;
    usdc: number;
    status: OutcomeStatus;
    statusKnown: boolean;
  };
  const groups = new Map<string, GroupAgg>();
  const eventCounts = new Map<
    string,
    { count: number; usdc: number; title: string }
  >();

  let pendingByCount = 0;
  let pendingByUsdc = 0;
  let totalCount = 0;
  let totalUsdc = 0;
  let earliestTs = BUCKET_UPPER_SENTINEL;
  let latestTs = 0;

  for (const t of trades) {
    const status = classifyFill(t, resolutions);
    const usdc = t.size * t.price;
    totalCount += 1;
    totalUsdc += usdc;
    if (status === "pending") {
      pendingByCount += 1;
      pendingByUsdc += usdc;
    }
    if (t.timestamp < earliestTs) earliestTs = t.timestamp;
    if (t.timestamp > latestTs) latestTs = t.timestamp;

    addToBucket(tradeSize, bucketIndex(usdc, TRADE_SIZE_EDGES), status, usdc);
    addToBucket(
      entryPrice,
      bucketIndex(t.price, ENTRY_PRICE_EDGES),
      status,
      usdc
    );
    const hour = new Date(t.timestamp * 1000).getUTCHours();
    addToBucket(hourOfDay, hour, status, usdc);

    const groupKey = `${t.conditionId}:${t.outcome ?? ""}`;
    const g = groups.get(groupKey) ?? {
      fills: 0,
      firstTs: BUCKET_UPPER_SENTINEL,
      lastTs: 0,
      usdc: 0,
      status,
      statusKnown: status !== "pending",
    };
    g.fills += 1;
    g.usdc += usdc;
    g.firstTs = Math.min(g.firstTs, t.timestamp);
    g.lastTs = Math.max(g.lastTs, t.timestamp);
    if (!g.statusKnown && status !== "pending") {
      g.status = status;
      g.statusKnown = true;
    }
    groups.set(groupKey, g);

    const eventSlug = t.eventSlug ?? t.slug ?? t.conditionId;
    const ec = eventCounts.get(eventSlug) ?? {
      count: 0,
      usdc: 0,
      title: t.title ?? "",
    };
    ec.count += 1;
    ec.usdc += usdc;
    if (t.title && !ec.title) ec.title = t.title;
    eventCounts.set(eventSlug, ec);
  }

  const dcaDepth = makeHistogramBuckets(DCA_DEPTH_EDGES, DCA_DEPTH_LABELS);
  const dcaWindow = makeHistogramBuckets(
    DCA_WINDOW_MIN_EDGES,
    DCA_WINDOW_LABELS
  );

  const groupSizes: number[] = [];
  const groupSpansMin: number[] = [];

  for (const g of groups.values()) {
    groupSizes.push(g.fills);
    addToBucket(
      dcaDepth,
      bucketIndex(g.fills, DCA_DEPTH_EDGES),
      g.status,
      g.usdc
    );
    if (g.fills >= 2 && g.lastTs > g.firstTs) {
      const spanMin = (g.lastTs - g.firstTs) / 60;
      groupSpansMin.push(spanMin);
      addToBucket(
        dcaWindow,
        bucketIndex(spanMin, DCA_WINDOW_MIN_EDGES),
        g.status,
        g.usdc
      );
    }
  }

  const eventClusterBuckets: FlatBucket[] = EVENT_CLUSTER_LABELS.map(
    (label, i) => ({
      lo: EVENT_CLUSTER_EDGES[i]!,
      hi: EVENT_CLUSTER_EDGES[i + 1]!,
      label,
      count: 0,
      usdc: 0,
    })
  );
  for (const ec of eventCounts.values()) {
    const idx = bucketIndex(ec.count, EVENT_CLUSTER_EDGES);
    if (idx >= 0 && idx < eventClusterBuckets.length) {
      const b = eventClusterBuckets[idx]! as {
        -readonly [K in keyof FlatBucket]: FlatBucket[K];
      };
      b.count += 1;
      b.usdc += ec.usdc;
    }
  }

  const topEvents: TopEvent[] = [...eventCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topLimit)
    .map(([slug, ec]) => ({
      slug,
      title: ec.title,
      tradeCount: ec.count,
      usdcNotional: ec.usdc,
    }));

  const tradeSizesUsdc = trades.map((t) => t.size * t.price);

  return {
    range: {
      fromTs: earliestTs === BUCKET_UPPER_SENTINEL ? nowSec : earliestTs,
      toTs: latestTs === 0 ? nowSec : latestTs,
      n: totalCount,
    },
    dcaDepth: { buckets: dcaDepth },
    tradeSize: { buckets: tradeSize },
    entryPrice: { buckets: entryPrice },
    dcaWindow: { buckets: dcaWindow },
    hourOfDay: { buckets: hourOfDay },
    eventClustering: { buckets: eventClusterBuckets },
    topEvents,
    pendingShare: {
      byCount: totalCount > 0 ? pendingByCount / totalCount : 0,
      byUsdc: totalUsdc > 0 ? pendingByUsdc / totalUsdc : 0,
    },
    quantiles: {
      dcaDepth: makeQuantiles(groupSizes),
      tradeSize: makeQuantiles(tradeSizesUsdc),
      dcaWindowMin: makeQuantiles(groupSpansMin),
    },
  };
}
