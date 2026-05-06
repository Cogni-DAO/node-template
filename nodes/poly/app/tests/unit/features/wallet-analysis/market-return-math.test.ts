// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-analysis/market-return-math`
 * Purpose: Locks the worked examples (A–F) from
 *   docs/design/poly-markets-aggregation-redesign.md §3.3 against the
 *   pure math module that powers the Markets aggregation columns.
 * Scope: Pure unit. No DB, no DOM, no SQL.
 * Invariants:
 *   - MODIFIED_DIETZ_V_BEGIN_ZERO — positionReturnPct walks total-in vs
 *     total-out; partial-close (Example B) returns +24.0%, not the
 *     naive snapshot-based +30%.
 *   - NULL_WHEN_UNDEFINED — divide-by-zero on totalBuyNotional returns
 *     null; rateGapPct degrades to null whenever either side is null.
 *   - SIGN_CONVENTION_TARGET_MINUS_US — Example D reproduces the
 *     +15.5pp / +$8.22 pair exactly.
 * Side-effects: none
 * Links: nodes/poly/app/src/features/wallet-analysis/server/market-return-math.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  blendTargetReturns,
  edgeGap,
  positionReturnPct,
} from "@/features/wallet-analysis/server/market-return-math";

describe("positionReturnPct — worked examples §3.3", () => {
  it("A. simple long, still open → +30.0%", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 50,
        realizedCash: 0,
        currentMarkValue: 65,
      })
    ).toBe(0.3);
  });

  it("B. partial close → +24.0% (NOT the naive +30% from snapshot)", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 50,
        realizedCash: 36,
        currentMarkValue: 26,
      })
    ).toBe(0.24);
  });

  it("C. hedged YES + NO legs aggregated → +3.6%", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 41.5, // 50 * 0.50 + 30 * 0.55
        realizedCash: 0,
        currentMarkValue: 43.0, // 50 * 0.65 + 30 * 0.35
      })
    ).toBe(0.0361); // (1.5 / 41.5) rounded to 4 decimals
  });

  it("E. multi-fill averaging up then partial close → +13.2%", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 53,
        realizedCash: 31,
        currentMarkValue: 29,
      })
    ).toBeCloseTo(0.1321, 4);
  });

  it("F1. all-sold-out closed position with positive PnL", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 50,
        realizedCash: 60,
        currentMarkValue: 0,
      })
    ).toBe(0.2);
  });

  it("F2. zero buy notional → null", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: 0,
        realizedCash: 0,
        currentMarkValue: 0,
      })
    ).toBeNull();
  });

  it("F3. negative buy notional (data bug) → null", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: -10,
        realizedCash: 0,
        currentMarkValue: 5,
      })
    ).toBeNull();
  });

  it("F4. NaN inputs → null", () => {
    expect(
      positionReturnPct({
        totalBuyNotional: Number.NaN,
        realizedCash: 0,
        currentMarkValue: 50,
      })
    ).toBeNull();
    expect(
      positionReturnPct({
        totalBuyNotional: 50,
        realizedCash: Number.NaN,
        currentMarkValue: 50,
      })
    ).toBeNull();
  });
});

describe("edgeGap — paired us-vs-target §3.3-D", () => {
  it("D. our +17.0% vs target +32.5% → +15.5pp / +$8.22", () => {
    const result = edgeGap({
      ourReturnPct: 0.17,
      targetReturnPct: 0.325,
      ourTotalBuyNotional: 53,
    });
    expect(result.rateGapPct).toBe(0.155);
    expect(result.sizeScaledGapUsdc).toBe(8.22);
  });

  it("we-ahead case → negative gap", () => {
    const result = edgeGap({
      ourReturnPct: 0.24,
      targetReturnPct: 0.18,
      ourTotalBuyNotional: 76,
    });
    expect(result.rateGapPct).toBe(-0.06);
    expect(result.sizeScaledGapUsdc).toBe(-4.56);
  });

  it("either side null → both metrics null", () => {
    expect(
      edgeGap({
        ourReturnPct: null,
        targetReturnPct: 0.3,
        ourTotalBuyNotional: 50,
      })
    ).toEqual({ rateGapPct: null, sizeScaledGapUsdc: null });
    expect(
      edgeGap({
        ourReturnPct: 0.1,
        targetReturnPct: null,
        ourTotalBuyNotional: 50,
      })
    ).toEqual({ rateGapPct: null, sizeScaledGapUsdc: null });
  });

  it("zero our-buy-notional → rate defined, dollar gap null", () => {
    const result = edgeGap({
      ourReturnPct: 0.1,
      targetReturnPct: 0.3,
      ourTotalBuyNotional: 0,
    });
    expect(result.rateGapPct).toBe(0.2);
    expect(result.sizeScaledGapUsdc).toBeNull();
  });
});

describe("blendTargetReturns — multi-target weighting §3.5", () => {
  it("winner $400 +30% + loser $100 −20% → +20.0% blended", () => {
    expect(
      blendTargetReturns([
        { totalBuyNotional: 400, returnPct: 0.3 },
        { totalBuyNotional: 100, returnPct: -0.2 },
      ])
    ).toBe(0.2);
  });

  it("single target → that target's return", () => {
    expect(
      blendTargetReturns([{ totalBuyNotional: 100, returnPct: 0.15 }])
    ).toBe(0.15);
  });

  it("ignores null-return entries (zero-buy-notional targets)", () => {
    expect(
      blendTargetReturns([
        { totalBuyNotional: 100, returnPct: 0.3 },
        { totalBuyNotional: 0, returnPct: null },
        { totalBuyNotional: 50, returnPct: -0.1 },
      ])
    ).toBe(
      // (100 * 0.3 + 50 * -0.1) / (100 + 50) = 25 / 150 = 0.1667
      0.1667
    );
  });

  it("empty input → null", () => {
    expect(blendTargetReturns([])).toBeNull();
  });

  it("all-null entries → null", () => {
    expect(
      blendTargetReturns([
        { totalBuyNotional: 0, returnPct: null },
        { totalBuyNotional: 100, returnPct: null },
      ])
    ).toBeNull();
  });
});
