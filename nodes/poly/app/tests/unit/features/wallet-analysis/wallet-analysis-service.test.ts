// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service` (unit)
 * Purpose: Verifies `getExecutionSlice` reads positions/trades from the DB
 *   mirrors (task.5012 CP5) and `getBalanceSlice` aggregates the same
 *   `poly_trader_current_positions` rows. Live/closed split, EXECUTION_OPEN_LIMIT,
 *   EXECUTION_HISTORY_LIMIT, and the CLOB-history-open-only invariant remain.
 * Scope: Covers the DB-only page-load contract (no Data API hit) and the v0
 *   `PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY` carve-out for CLOB price-history.
 * Invariants:
 *   - PAGE_LOAD_DB_ONLY (task.5012 CP5): no `listUserPositions` / `listUserTrades`.
 *   - PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY: `getPriceHistory` only on open rows.
 *   - live_positions contains only open/redeemable rows (cap 18); closed_positions only closed rows (cap 30).
 * Side-effects: none (DB calls go through a fake drizzle, CLOB through __setClientsForTests)
 * Notes: TTL cache cleared in afterEach to prevent inter-test coalescing.
 * Links: nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts, work/items/task.5012, work/items/task.5015
 * @public
 */

import {
  polyTraderCurrentPositions,
  polyTraderFills,
} from "@cogni/poly-db-schema/trader-activity";
import { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTtlCache } from "@/features/wallet-analysis/server/coalesce";
import {
  __setClientsForTests,
  getBalanceSlice,
  getDistributionsSlice,
  getExecutionSlice,
  getSnapshotSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

type FakeDbRow = {
  conditionId: string;
  tokenId: string;
  shares: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  avgPrice: string;
  lastObservedAt: Date;
  firstObservedAt: Date;
  raw: Record<string, unknown> | null;
};

type FakeFillRow = {
  conditionId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: string;
  shares: string;
  observedAt: Date;
  raw: Record<string, unknown> | null;
};

/**
 * Drizzle's chained builder is fluent and thenable. Both call shapes here are
 *   db.select(...).from(table).innerJoin(...).where(...)                  (positions)
 *   db.select(...).from(table).innerJoin(...).where(...).orderBy(...)     (fills)
 * Identity-compare the table to dispatch fake rows; both terminal steps
 * (`.where(...)` and `.orderBy(...)`) resolve to the same row set.
 */
function makeFakeDb(opts: { positions: FakeDbRow[]; fills: FakeFillRow[] }) {
  return {
    /**
     * Execution slice now reads fills via raw `sql` template through `db.execute(...)`
     * (readFillsForActivePositionsFromDb). Match the field shape the helper expects
     * — already-aliased keys per the SELECT — and project from `opts.fills`.
     */
    execute() {
      return Promise.resolve(
        opts.fills.map((f) => ({
          conditionId: f.conditionId,
          tokenId: f.tokenId,
          side: f.side,
          price: f.price,
          shares: f.shares,
          observedAt: f.observedAt,
          raw: f.raw,
        }))
      );
    },
    select() {
      let rows: unknown[] = [];
      const builder = {
        from(table: unknown) {
          if (table === polyTraderFills) rows = opts.fills as unknown[];
          else if (table === polyTraderCurrentPositions)
            rows = opts.positions as unknown[];
          else rows = [];
          return builder;
        },
        innerJoin() {
          return builder;
        },
        where() {
          // Chain shapes used by the slice queries:
          //   .where(...) (positions)                                                         → resolves rows
          //   .where(...).orderBy(...) (legacy)                                               → resolves rows
          //   .where(...).orderBy(...).limit(N) (bounded fill read, snapshot/dist/execution)  → resolves rows.slice(0, N)
          return Object.assign(Promise.resolve(rows), {
            orderBy: () =>
              Object.assign(Promise.resolve(rows), {
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              }),
          });
        },
        orderBy() {
          return Object.assign(Promise.resolve(rows), {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          });
        },
      };
      return builder;
    },
  } as never;
}

const ADDR = "0xabcdef1234567890abcdef1234567890abcdef12";

function makePosition(
  asset: string,
  overrides: Partial<FakeDbRow> = {}
): FakeDbRow {
  return {
    conditionId: `cid-${asset}`,
    tokenId: asset,
    shares: "5",
    costBasisUsdc: "2.5",
    currentValueUsdc: "3",
    avgPrice: "0.5",
    lastObservedAt: new Date(),
    firstObservedAt: new Date(Date.now() - 3_600_000),
    raw: {
      title: `Market ${asset}`,
      outcome: "YES",
      curPrice: 0.6,
    },
    ...overrides,
  };
}

function makeFill(
  asset: string,
  side: "BUY" | "SELL",
  observedAt: Date,
  shares = "10",
  price = "0.5"
): FakeFillRow {
  return {
    conditionId: `cid-${asset}`,
    tokenId: asset,
    side,
    price,
    shares,
    observedAt,
    raw: { title: `Market ${asset}`, outcome: "YES" },
  };
}

describe("getExecutionSlice — DB-backed live/closed split", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("puts open positions in live_positions and closed in closed_positions", async () => {
    const NOW = Date.now();
    const openAssets = ["a1", "a2", "a3"];
    const closedAssets = ["c1", "c2"];

    const db = makeFakeDb({
      positions: openAssets.map((asset) => makePosition(asset)),
      fills: [
        ...openAssets.map((a) => makeFill(a, "BUY", new Date(NOW - 3_600_000))),
        ...closedAssets.flatMap((a) => [
          makeFill(a, "BUY", new Date(NOW - 7_200_000)),
          makeFill(a, "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
        ]),
      ],
    });

    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions).toHaveLength(3);
    expect(result.closed_positions).toHaveLength(2);
    for (const p of result.live_positions) {
      expect(["open", "redeemable"]).toContain(p.status);
    }
    for (const p of result.closed_positions) {
      expect(p.status).toBe("closed");
    }
  });

  it("caps live_positions at EXECUTION_OPEN_LIMIT (18)", async () => {
    const NOW = Date.now();
    const assets = Array.from({ length: 25 }, (_, i) => `asset${i}`);
    const db = makeFakeDb({
      positions: assets.map((a) => makePosition(a)),
      fills: assets.map((a) => makeFill(a, "BUY", new Date(NOW - 3_600_000))),
    });
    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions.length).toBeLessThanOrEqual(18);
    expect(result.closed_positions).toHaveLength(0);
  });

  it("caps closed_positions at EXECUTION_HISTORY_LIMIT (30)", async () => {
    const NOW = Date.now();
    const assets = Array.from({ length: 40 }, (_, i) => `closed${i}`);
    const db = makeFakeDb({
      positions: [],
      fills: assets.flatMap((a) => [
        makeFill(a, "BUY", new Date(NOW - 7_200_000)),
        makeFill(a, "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
      ]),
    });
    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions).toHaveLength(0);
    expect(result.closed_positions.length).toBeLessThanOrEqual(30);
  });

  it("does not fetch CLOB price history for closed positions", async () => {
    const NOW = Date.now();
    const db = makeFakeDb({
      positions: [makePosition("open1")],
      fills: [
        makeFill("open1", "BUY", new Date(NOW - 3_600_000)),
        makeFill("closed1", "BUY", new Date(NOW - 7_200_000)),
        makeFill("closed1", "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
      ],
    });

    const clobFetch = vi.fn().mockResolvedValue({ ok: true, json: () => [] });
    const clobPublic = new PolymarketClobPublicClient({ fetch: clobFetch });
    __setClientsForTests({ clobPublic });

    await getExecutionSlice(db as never, ADDR);

    const clobUrls: string[] = clobFetch.mock.calls.map(
      (call: [string, ...unknown[]]) => call[0]
    );
    const historyUrlsForClosed = clobUrls.filter(
      (u) => u.includes("prices-history") && u.includes("closed1")
    );
    expect(historyUrlsForClosed).toHaveLength(0);
  });

  it("can return current positions without trades, and never reads the Data API", async () => {
    const db = makeFakeDb({
      positions: [makePosition("open1")],
      fills: [],
    });
    // CLOB client must not be hit for closed-side history; it's still allowed
    // for the open row but only when includePriceHistory=true.
    const clobFetch = vi.fn().mockResolvedValue({ ok: true, json: () => [] });
    const clobPublic = new PolymarketClobPublicClient({ fetch: clobFetch });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR, {
      includePriceHistory: false,
      includeTrades: false,
    });

    expect(result.live_positions).toHaveLength(1);
    expect(result.closed_positions).toHaveLength(0);
    expect(result.dailyTradeCounts.every((point) => point.n === 0)).toBe(true);
    expect(clobFetch).not.toHaveBeenCalled();
  });
});

describe("getBalanceSlice — DB-backed positions aggregate", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("sums currentValueUsdc across active rows from the DB", async () => {
    const db = makeFakeDb({
      positions: [
        makePosition("a", { currentValueUsdc: "12.5" }),
        makePosition("b", { currentValueUsdc: "0.49" }),
        makePosition("c", { currentValueUsdc: "100" }),
      ],
      fills: [],
    });

    const result = await getBalanceSlice(db as never, ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.positions).toBeCloseTo(112.99, 2);
    expect(result.value.total).toBeCloseTo(112.99, 2);
    expect(result.value.isOperator).toBe(false);
  });

  it("returns zero when the wallet has no DB-mirrored positions", async () => {
    const db = makeFakeDb({ positions: [], fills: [] });

    const result = await getBalanceSlice(db as never, ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.positions).toBe(0);
    expect(result.value.total).toBe(0);
  });
});

describe("getDistributionsSlice — historical observed fills", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("builds PR 1137 histograms from saved trader-fill history", async () => {
    const addr = ADDR;
    const rows = [
      {
        conditionId: "cid-a",
        tokenId: "asset-win",
        side: "BUY",
        price: "0.50000000",
        shares: "20.00000000",
        observedAt: new Date("2026-05-01T12:00:00.000Z"),
        raw: {
          outcome: "YES",
          attributes: {
            title: "Will histograms render?",
            slug: "histograms-render",
            event_slug: "wallet-research",
          },
        },
      },
      {
        conditionId: "cid-a",
        tokenId: "asset-loss",
        side: "BUY",
        price: "0.25000000",
        shares: "40.00000000",
        observedAt: new Date("2026-05-02T18:00:00.000Z"),
        raw: {
          outcome: "NO",
          attributes: {
            title: "Will histograms render?",
            slug: "histograms-render",
            event_slug: "wallet-research",
          },
        },
      },
    ];
    // task.5012 CP4: getDistributionsSlice now reads resolutions from
    // poly_market_outcomes via a second drizzle SELECT (no CLOB call). Build a
    // fresh chain per `select()` call so `state.joined` is per-query.
    const outcomeRows = [
      { conditionId: "cid-a", tokenId: "asset-win", outcome: "winner" },
      { conditionId: "cid-a", tokenId: "asset-loss", outcome: "loser" },
    ];
    const fakeDb = {
      select: () => {
        const state = { joined: false };
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.innerJoin = () => {
          state.joined = true;
          return chain;
        };
        chain.where = () => {
          // Outcomes branch resolves immediately (no orderBy/limit).
          if (!state.joined)
            return outcomeRows as unknown as Record<string, unknown>;
          // Joined fill branch supports .orderBy().limit() as the temp
          // distributions read uses (readWalletFillsTodoCp9).
          return Object.assign(Promise.resolve(rows), {
            orderBy: () =>
              Object.assign(Promise.resolve(rows), {
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              }),
          });
        };
        chain.orderBy = async () => rows;
        return chain;
      },
    };

    const result = await getDistributionsSlice(
      fakeDb as never,
      addr,
      "historical"
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.mode).toBe("historical");
    expect(result.value.range.n).toBe(2);
    expect(result.value.pendingShare.byCount).toBe(0);
    expect(
      result.value.tradeSize.buckets.reduce(
        (sum, bucket) =>
          sum +
          bucket.values.count.won +
          bucket.values.count.lost +
          bucket.values.count.pending,
        0
      )
    ).toBe(2);
  });
});

describe("getSnapshotSlice — DB-backed (task.5012 CP4)", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("computes snapshot metrics from SQL aggregates + poly_market_outcomes", async () => {
    // Snapshot now reads SQL aggregates (positions / dailyCounts / activity)
    // via db.execute(sql`...`); resolutions still through .select().from().where().
    // Fake injects canned aggregate rows in execute-call order matching the slice.
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    const fakeDb = makeSqlAggregateFakeDb({
      positionAggs: [
        // resolved winner: held=0 (10 buy / 10 sell), pnl = sellUsdc - buyUsdc = +4
        {
          conditionId: "cid-a",
          tokenId: "asset-win",
          buyUsdc: 4,
          sellUsdc: 8,
          buyShares: 10,
          sellShares: 10,
          firstBuyTs: 1761998400, // 2026-05-01T12:00 UTC
          lastTs: 1762084800,
          title: "Market A",
        },
        // open: no outcome row
        {
          conditionId: "cid-b",
          tokenId: "asset-pending",
          buyUsdc: 6,
          sellUsdc: 0,
          buyShares: 20,
          sellShares: 0,
          firstBuyTs: 1762171200,
          lastTs: 1762171200,
          title: "Market B",
        },
      ],
      dailyCounts: [{ day: "2026-05-03", n: 1 }],
      activity: { recent30: 3, latestTs: 1762171200 },
      outcomes: [
        { conditionId: "cid-a", tokenId: "asset-win", outcome: "winner" },
        { conditionId: "cid-a", tokenId: "asset-loss", outcome: "loser" },
      ],
    });

    const result = await getSnapshotSlice(fakeDb as never, addr);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.resolvedPositions).toBe(1);
    expect(result.value.openPositions).toBe(1);
    expect(result.value.uniqueMarkets).toBe(2);
    // resolvedPositions=1 < SNAPSHOT_MIN_RESOLVED (5) → trueWinRatePct null.
    expect(result.value.trueWinRatePct).toBeNull();
  });

  it("returns warning on DB read failure", async () => {
    const failingDb = {
      execute: () => {
        throw new Error("db down");
      },
    };
    const result = await getSnapshotSlice(
      failingDb as never,
      "0xabcdef1234567890abcdef1234567890abcdef12"
    );
    expect(result.kind).toBe("warn");
    if (result.kind !== "warn") return;
    expect(result.warning.slice).toBe("snapshot");
  });

  it("scales to 100K positions without truncation (SQL aggregation, not raw fills)", async () => {
    // Simulates a whale wallet whose fills compress to many distinct markets.
    // The architectural test: even with 100K position aggregates, the slice
    // returns ok and uniqueMarkets reflects EVERY market — no truncation cap.
    // (Pre-CP4-architecture this path loaded raw fills and OOMed; SQL pre-agg
    // means JS only sees ≈uniqueMarkets rows.)
    const positionAggs = Array.from({ length: 100_000 }, (_, i) => ({
      conditionId: `cid-${i}`,
      tokenId: `tok-${i}`,
      buyUsdc: 1,
      sellUsdc: 0,
      buyShares: 1,
      sellShares: 0,
      firstBuyTs: 1761998400 + i,
      lastTs: 1761998400 + i,
      title: `Market ${i}`,
    }));
    const fakeDb = makeSqlAggregateFakeDb({
      positionAggs,
      dailyCounts: [],
      activity: { recent30: 100_000, latestTs: 1762000000 },
      outcomes: [],
    });
    const result = await getSnapshotSlice(fakeDb as never, ADDR);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.uniqueMarkets).toBe(100_000);
    expect(result.value.openPositions).toBe(100_000);
  });
});

/**
 * Fake DB used by the SQL-aggregated snapshot path. Implements:
 *   - db.execute(sql`...`)  →  returns canned aggregate rows in call order:
 *       1st call: positionAggs   (readPositionAggregatesFromDb)
 *       2nd call: dailyCounts    (readDailyCountsFromDb)
 *       3rd call: activity-row   (readActivityCountsFromDb)
 *   - db.select().from().where()  →  outcome rows (readResolutionsForConditions)
 * Order assumption matches `Promise.all([positions, dailyRows, activity])`
 * in getSnapshotSlice; if the slice is reordered, adjust this fake.
 */
function makeSqlAggregateFakeDb(opts: {
  positionAggs: ReadonlyArray<{
    conditionId: string;
    tokenId: string;
    buyUsdc: number;
    sellUsdc: number;
    buyShares: number;
    sellShares: number;
    firstBuyTs: number;
    lastTs: number;
    title: string;
  }>;
  dailyCounts: ReadonlyArray<{ day: string; n: number }>;
  activity: { recent30: number; latestTs: number };
  outcomes: ReadonlyArray<{
    conditionId: string;
    tokenId: string;
    outcome: string;
  }>;
}) {
  const executeQueue: Array<unknown> = [
    opts.positionAggs,
    opts.dailyCounts,
    [opts.activity],
  ];
  return {
    execute() {
      const next = executeQueue.shift() ?? [];
      // postgres-js shape: array directly. node-pg shape: { rows: [...] }.
      // Slice handlers are tolerant of both — return array form.
      return Promise.resolve(next);
    },
    select() {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve(opts.outcomes);
      return chain;
    },
  };
}
