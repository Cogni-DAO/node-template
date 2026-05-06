// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/markets-table-alpha-leak`
 * Purpose: Locks the `isAlphaLeak` predicate that drives the dashboard
 *   Markets-table "alpha leak only" toggle. Predicate sits on the new
 *   two-axis fields (`rateGapPct`, `sizeScaledGapUsdc`) per
 *   docs/design/poly-markets-aggregation-redesign.md §4.4.
 * Scope: Pure unit test. No React, no DOM, no DB.
 * Invariants:
 *   - Predicate is `rateGapPct >= 5pp AND sizeScaledGapUsdc > 0`.
 *   - Either-side null (no comparable target legs) → not a leak.
 *   - The predicate fires regardless of our pnl sign — "we made +$5,
 *     target made +$5,000" is a leak (today's predicate misses this).
 * Side-effects: none
 * Links: nodes/poly/app/src/app/(app)/_components/markets-table/MarketsTable.tsx
 * @public
 */

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import { describe, expect, it } from "vitest";

import {
  ALPHA_LEAK_RATE_GAP_THRESHOLD,
  isAlphaLeak,
} from "@/app/(app)/_components/markets-table/MarketsTable";

function group(
  overrides: Partial<WalletExecutionMarketGroup> = {}
): WalletExecutionMarketGroup {
  return {
    groupKey: "condition:0xabc",
    eventTitle: null,
    eventSlug: null,
    marketCount: 1,
    status: "live",
    ourValueUsdc: 0,
    targetValueUsdc: 0,
    pnlUsd: 0,
    ourReturnPct: null,
    targetReturnPct: null,
    rateGapPct: null,
    sizeScaledGapUsdc: null,
    hedgeCount: 0,
    lines: [],
    ...overrides,
  };
}

describe("isAlphaLeak", () => {
  it("returns true when target is meaningfully ahead and dollars are at stake", () => {
    expect(
      isAlphaLeak(group({ rateGapPct: 0.41, sizeScaledGapUsdc: 30.34 }))
    ).toBe(true);
  });

  it("returns true when we are GREEN but target is even greener (the leak today's predicate misses)", () => {
    // ourReturn +5%, targetReturn +50% → rateGap +45pp, dollar gap on $100 = +$45.
    // Today's predicate gates on `pnlUsd < 0` and would miss this.
    expect(
      isAlphaLeak(group({ rateGapPct: 0.45, sizeScaledGapUsdc: 45 }))
    ).toBe(true);
  });

  it("returns false when rate gap is below the 5pp threshold", () => {
    // 4pp gap is noise even with a positive dollar amount.
    expect(
      isAlphaLeak(group({ rateGapPct: 0.04, sizeScaledGapUsdc: 10 }))
    ).toBe(false);
  });

  it("returns true exactly at the threshold (>= 5pp, not >)", () => {
    expect(
      isAlphaLeak(
        group({
          rateGapPct: ALPHA_LEAK_RATE_GAP_THRESHOLD,
          sizeScaledGapUsdc: 1,
        })
      )
    ).toBe(true);
  });

  it("returns false when we are ahead (negative gaps)", () => {
    expect(
      isAlphaLeak(group({ rateGapPct: -0.1, sizeScaledGapUsdc: -8 }))
    ).toBe(false);
  });

  it("returns false at the dollar-gap zero boundary", () => {
    // Pure pick-quality gap with zero of our money at stake — nothing to fix.
    expect(isAlphaLeak(group({ rateGapPct: 0.2, sizeScaledGapUsdc: 0 }))).toBe(
      false
    );
  });

  it("returns false when either field is null (no comparable target legs)", () => {
    expect(
      isAlphaLeak(group({ rateGapPct: null, sizeScaledGapUsdc: 30 }))
    ).toBe(false);
    expect(
      isAlphaLeak(group({ rateGapPct: 0.4, sizeScaledGapUsdc: null }))
    ).toBe(false);
    expect(
      isAlphaLeak(group({ rateGapPct: null, sizeScaledGapUsdc: null }))
    ).toBe(false);
  });
});
