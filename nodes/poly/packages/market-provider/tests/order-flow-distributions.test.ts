// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/order-flow-distributions`
 * Purpose: Unit tests for `summariseOrderFlow` — determinism, win/lost/pending classification, bucket placement, size-weighting, quantiles.
 * Scope: Pure function tests; no I/O.
 * Invariants: PURE, PENDING_IS_FIRST_CLASS, DISTRIBUTIONS_ARE_PURE_DERIVATIONS.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0431.poly-wallet-orderflow-distributions-d1.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  type OrderFlowTrade,
  summariseOrderFlow,
} from "../src/analysis/order-flow-distributions.js";
import type { MarketResolutionInput } from "../src/analysis/wallet-metrics.js";

const NOW = 1_777_852_800; // 2026-05-04T00:00:00Z

function trade(over: Partial<OrderFlowTrade>): OrderFlowTrade {
  return {
    side: "BUY",
    asset: "tok-yes",
    conditionId: "cid-1",
    size: 10,
    price: 0.5,
    timestamp: NOW - 3600,
    title: "Test market",
    outcome: "Yes",
    eventSlug: "event-1",
    ...over,
  };
}

function resolutions(
  entries: Array<[string, MarketResolutionInput]>
): ReadonlyMap<string, MarketResolutionInput> {
  return new Map(entries);
}

describe("summariseOrderFlow", () => {
  it("returns empty zero-state on no trades", () => {
    const d = summariseOrderFlow([], new Map(), { nowSec: NOW });
    expect(d.range.n).toBe(0);
    expect(d.pendingShare.byCount).toBe(0);
    expect(d.pendingShare.byUsdc).toBe(0);
    expect(d.topEvents).toHaveLength(0);
    expect(d.dcaDepth.buckets.every((b) => sumCounts(b) === 0)).toBe(true);
  });

  it("classifies a fill as `won` when its asset matches the winning token", () => {
    const trades: OrderFlowTrade[] = [
      trade({ asset: "tok-yes", conditionId: "cid-1", size: 100, price: 0.5 }),
    ];
    const res = resolutions([
      [
        "cid-1",
        {
          closed: true,
          tokens: [
            { token_id: "tok-yes", winner: true },
            { token_id: "tok-no", winner: false },
          ],
        },
      ],
    ]);
    const d = summariseOrderFlow(trades, res, { nowSec: NOW });

    expect(totalCounts(d.tradeSize.buckets, "won")).toBe(1);
    expect(totalCounts(d.tradeSize.buckets, "lost")).toBe(0);
    expect(totalCounts(d.tradeSize.buckets, "pending")).toBe(0);
    expect(d.pendingShare.byCount).toBe(0);
  });

  it("classifies a fill as `lost` when its asset matches a losing token", () => {
    const trades: OrderFlowTrade[] = [
      trade({ asset: "tok-no", conditionId: "cid-1", size: 50, price: 0.5 }),
    ];
    const res = resolutions([
      [
        "cid-1",
        {
          closed: true,
          tokens: [
            { token_id: "tok-yes", winner: true },
            { token_id: "tok-no", winner: false },
          ],
        },
      ],
    ]);
    const d = summariseOrderFlow(trades, res, { nowSec: NOW });

    expect(totalCounts(d.tradeSize.buckets, "lost")).toBe(1);
    expect(totalCounts(d.tradeSize.buckets, "won")).toBe(0);
  });

  it("classifies as `pending` when market is open or unresolved", () => {
    const trades: OrderFlowTrade[] = [
      trade({ conditionId: "cid-1" }),
      trade({ conditionId: "cid-2" }),
    ];
    const res = resolutions([
      ["cid-1", { closed: false, tokens: [] }],
      // cid-2 has no resolution entry at all
    ]);
    const d = summariseOrderFlow(trades, res, { nowSec: NOW });

    expect(totalCounts(d.tradeSize.buckets, "pending")).toBe(2);
    expect(d.pendingShare.byCount).toBe(1);
  });

  it("size-weights via the usdc accumulator separately from count", () => {
    const trades: OrderFlowTrade[] = [
      trade({ size: 1, price: 0.5 }), // $0.50 — bucket $0-10
      trade({ size: 100, price: 1 }), // $100 — bucket $100-500
    ];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });

    const bucket0to10 = d.tradeSize.buckets.find((b) => b.label === "$0-10")!;
    const bucket100to500 = d.tradeSize.buckets.find(
      (b) => b.label === "$100-500"
    )!;
    expect(bucket0to10.values.count.pending).toBe(1);
    expect(bucket0to10.values.usdc.pending).toBeCloseTo(0.5);
    expect(bucket100to500.values.count.pending).toBe(1);
    expect(bucket100to500.values.usdc.pending).toBeCloseTo(100);
  });

  it("places entry-price fills into the correct band", () => {
    const trades: OrderFlowTrade[] = [
      trade({ price: 0.02 }), // 0.00-0.05
      trade({ price: 0.5 }), // 0.45-0.55
      trade({ price: 0.97 }), // 0.95-1.00
    ];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    expect(
      d.entryPrice.buckets.find((b) => b.label === "0.00-0.05")!.values.count
        .pending
    ).toBe(1);
    expect(
      d.entryPrice.buckets.find((b) => b.label === "0.45-0.55")!.values.count
        .pending
    ).toBe(1);
    expect(
      d.entryPrice.buckets.find((b) => b.label === "0.95-1.00")!.values.count
        .pending
    ).toBe(1);
  });

  it("buckets DCA depth by group fill count", () => {
    const trades: OrderFlowTrade[] = [
      // group A: 1 fill
      trade({ conditionId: "cid-A", outcome: "Yes" }),
      // group B: 3 fills
      trade({ conditionId: "cid-B", outcome: "Yes" }),
      trade({ conditionId: "cid-B", outcome: "Yes" }),
      trade({ conditionId: "cid-B", outcome: "Yes" }),
      // group C: 7 fills
      ...Array.from({ length: 7 }, () =>
        trade({ conditionId: "cid-C", outcome: "Yes" })
      ),
    ];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    expect(
      d.dcaDepth.buckets.find((b) => b.label === "1")!.values.count.pending
    ).toBe(1);
    expect(
      d.dcaDepth.buckets.find((b) => b.label === "3-4")!.values.count.pending
    ).toBe(1);
    expect(
      d.dcaDepth.buckets.find((b) => b.label === "5-9")!.values.count.pending
    ).toBe(1);
  });

  it("computes DCA window from group first→last span (excludes single-fill groups)", () => {
    const trades: OrderFlowTrade[] = [
      // 30-min span on cid-X
      trade({
        conditionId: "cid-X",
        outcome: "Yes",
        timestamp: NOW - 30 * 60,
      }),
      trade({ conditionId: "cid-X", outcome: "Yes", timestamp: NOW }),
      // single fill — excluded
      trade({ conditionId: "cid-Y", outcome: "Yes", timestamp: NOW }),
    ];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    const totalWindowFills = d.dcaWindow.buckets.reduce(
      (s, b) => s + sumCounts(b),
      0
    );
    expect(totalWindowFills).toBe(1);
    expect(
      d.dcaWindow.buckets.find((b) => b.label === "5-30m")!.values.count.pending
    ).toBe(1);
  });

  it("places fills into the correct UTC hour bucket", () => {
    // 2026-05-04T03:30:00Z → hour 3
    const ts = Date.UTC(2026, 4, 4, 3, 30, 0) / 1000;
    const trades: OrderFlowTrade[] = [trade({ timestamp: ts })];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    expect(
      d.hourOfDay.buckets.find((b) => b.label === "03:00")!.values.count.pending
    ).toBe(1);
  });

  it("flat event-clustering buckets group across sub-markets without outcome split", () => {
    const trades: OrderFlowTrade[] = [
      // event-1 has 3 sub-market fills
      trade({ conditionId: "cid-A", eventSlug: "event-1", outcome: "Yes" }),
      trade({ conditionId: "cid-B", eventSlug: "event-1", outcome: "No" }),
      trade({ conditionId: "cid-C", eventSlug: "event-1", outcome: "Yes" }),
      // event-2 has 1 fill
      trade({ conditionId: "cid-D", eventSlug: "event-2", outcome: "Yes" }),
    ];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    expect(d.eventClustering.buckets.find((b) => b.label === "1")!.count).toBe(
      1
    );
    expect(
      d.eventClustering.buckets.find((b) => b.label === "3-4")!.count
    ).toBe(1);
  });

  it("ranks topEvents by trade count and caps at the limit", () => {
    const trades: OrderFlowTrade[] = [
      trade({ eventSlug: "hot", title: "Hot event", conditionId: "c1" }),
      trade({ eventSlug: "hot", title: "Hot event", conditionId: "c1" }),
      trade({ eventSlug: "hot", title: "Hot event", conditionId: "c1" }),
      trade({ eventSlug: "warm", title: "Warm event", conditionId: "c2" }),
    ];
    const d = summariseOrderFlow(trades, new Map(), {
      nowSec: NOW,
      topEventsLimit: 1,
    });
    expect(d.topEvents).toHaveLength(1);
    expect(d.topEvents[0]!.slug).toBe("hot");
    expect(d.topEvents[0]!.tradeCount).toBe(3);
  });

  it("uses finite bucket edges so JSON serialization preserves `hi`", () => {
    // Regression: `Number.POSITIVE_INFINITY` would round-trip to `null` via
    // JSON, silently violating `HistogramBucketSchema.hi: z.number()`.
    const trades: OrderFlowTrade[] = [trade({ size: 100, price: 0.5 })];
    const d = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    const roundTripped = JSON.parse(JSON.stringify(d)) as typeof d;
    for (const b of roundTripped.tradeSize.buckets) {
      expect(typeof b.hi).toBe("number");
      expect(Number.isFinite(b.hi)).toBe(true);
    }
    for (const b of roundTripped.dcaDepth.buckets) {
      expect(Number.isFinite(b.hi)).toBe(true);
    }
    for (const b of roundTripped.eventClustering.buckets) {
      expect(Number.isFinite(b.hi)).toBe(true);
    }
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const trades: OrderFlowTrade[] = [
      trade({ size: 100, price: 0.5 }),
      trade({ size: 50, price: 0.7, timestamp: NOW - 60 }),
    ];
    const a = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    const b = summariseOrderFlow(trades, new Map(), { nowSec: NOW });
    expect(a).toEqual(b);
  });
});

function sumCounts(b: {
  values: {
    count: { won: number; lost: number; pending: number };
  };
}): number {
  return b.values.count.won + b.values.count.lost + b.values.count.pending;
}

function totalCounts(
  buckets: ReadonlyArray<{
    values: {
      count: { won: number; lost: number; pending: number };
    };
  }>,
  status: "won" | "lost" | "pending"
): number {
  return buckets.reduce((s, b) => s + b.values.count[status], 0);
}
