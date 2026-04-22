// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/wallet-balance-history`
 * Purpose: Unit tests for the derived wallet balance-history helper.
 * Scope: Pure function tests only. Does not perform network I/O, and does not mutate state.
 * Invariants: PURE_REWIND, LIVE_DATA_SHAPE.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import { mapWalletBalanceHistory } from "../src/analysis/wallet-balance-history.js";

const AS_OF = "2026-04-22T00:00:00.000Z";

describe("mapWalletBalanceHistory", () => {
  it("rewinds cash and holdings from live trades into a daily balance series", () => {
    const history = mapWalletBalanceHistory({
      currentCash: 40,
      asOfIso: AS_OF,
      windowDays: 3,
      positions: [
        {
          asset: "asset-yes",
          size: 50,
          avgPrice: 0.4,
          curPrice: 0.5,
        } as never,
      ],
      trades: [
        {
          asset: "asset-yes",
          side: "BUY",
          size: 100,
          price: 0.4,
          timestamp: 1_776_672_000, // 2026-04-20T08:00:00Z
        } as never,
        {
          asset: "asset-yes",
          side: "SELL",
          size: 50,
          price: 0.6,
          timestamp: 1_776_758_400, // 2026-04-21T08:00:00Z
        } as never,
      ],
      priceHistoryByAsset: new Map([
        [
          "asset-yes",
          [
            { t: 1_776_614_400, p: 0.4 }, // 2026-04-19T16:00:00Z
            { t: 1_776_700_800, p: 0.6 }, // 2026-04-20T16:00:00Z
            { t: 1_776_787_200, p: 0.5 }, // 2026-04-21T16:00:00Z
          ],
        ],
      ]),
    });

    expect(history).toHaveLength(3);
    expect(history.map((point) => point.total)).toEqual([50, 70, 65]);
  });

  it("falls back to current prices when public price history is missing", () => {
    const history = mapWalletBalanceHistory({
      currentCash: 25,
      asOfIso: AS_OF,
      windowDays: 2,
      positions: [
        {
          asset: "asset-no",
          size: 10,
          avgPrice: 0.2,
          curPrice: 0.3,
        } as never,
      ],
      trades: [],
      priceHistoryByAsset: new Map(),
    });

    expect(history).toHaveLength(2);
    expect(history.every((point) => point.total === 28)).toBe(true);
  });
});
