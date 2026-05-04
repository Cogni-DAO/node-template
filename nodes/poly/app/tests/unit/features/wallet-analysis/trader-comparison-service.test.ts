// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trader-comparison-service` tests
 * Purpose: Pins the windowed P/L delta used by the research trader-comparison board.
 * Scope: Pure helper coverage; DB aggregation is exercised by route/service typecheck and component wiring.
 * Invariants:
 *   - WINDOWED_DELTA: comparison P/L is `last.pnl - first.pnl`, matching the wallet-analysis P/L card.
 * Side-effects: none
 * @internal
 */

import { describe, expect, it } from "vitest";
import { computeWindowedPnl } from "@/features/wallet-analysis/server/trader-comparison-service";

describe("computeWindowedPnl", () => {
  it("returns null when a delta cannot be expressed", () => {
    expect(computeWindowedPnl([])).toBeNull();
    expect(
      computeWindowedPnl([{ ts: "2026-05-01T00:00:00.000Z", pnl: 10 }])
    ).toBeNull();
  });

  it("computes last minus first for positive and negative windows", () => {
    expect(
      computeWindowedPnl([
        { ts: "2026-05-01T00:00:00.000Z", pnl: 100 },
        { ts: "2026-05-02T00:00:00.000Z", pnl: 112.25 },
      ])
    ).toBe(12.25);
    expect(
      computeWindowedPnl([
        { ts: "2026-05-01T00:00:00.000Z", pnl: 100 },
        { ts: "2026-05-02T00:00:00.000Z", pnl: 88.5 },
      ])
    ).toBe(-11.5);
  });
});
