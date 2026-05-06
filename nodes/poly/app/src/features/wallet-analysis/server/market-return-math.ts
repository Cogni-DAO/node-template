// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-return-math`
 * Purpose: Pure formulas for the dashboard Markets aggregation table —
 *   per-position cost-basis-deployed return, target-blend, and the
 *   rate-gap / size-scaled-gap pair that drives the "alpha leak" sort.
 *   No DB, no env, no logging — every input is provided by the caller
 *   so this module can be unit-tested directly against the worked
 *   examples in docs/design/poly-markets-aggregation-redesign.md §3.3.
 * Scope: Pure functions. Imported by `market-exposure-service.ts`.
 * Invariants:
 *   - MODIFIED_DIETZ_V_BEGIN_ZERO: positionReturnPct treats every BUY as
 *     committed capital and every SELL as cash credited back, with the
 *     starting position implicitly zero (we never carry a position into
 *     a copy-trade condition).
 *   - NULL_WHEN_UNDEFINED: divide-by-zero on `totalBuyNotional` returns
 *     `null`, never `Infinity` / `NaN`. UI must render `—`.
 *   - SIGN_CONVENTION_TARGET_MINUS_US: `rateGapPct` is
 *     `targetReturnPct − ourReturnPct`. Positive = target ahead = leak.
 *   - SIZE_SCALED_ON_OUR_BOOK: `sizeScaledGapUsdc` is denominated in OUR
 *     buy notional, not target's. Stays bounded to our portfolio scale.
 * Side-effects: none
 * Links: docs/design/poly-markets-aggregation-redesign.md §3
 * @internal
 */

export type PositionReturnInput = {
  /** Σ size_usdc over fills WHERE side='BUY'. */
  totalBuyNotional: number;
  /** Σ size_usdc over fills WHERE side='SELL'. */
  realizedCash: number;
  /** Σ over open legs of (shares × current_price). */
  currentMarkValue: number;
};

export type EdgeGapInput = {
  ourReturnPct: number | null;
  targetReturnPct: number | null;
  ourTotalBuyNotional: number;
};

export type EdgeGap = {
  rateGapPct: number | null;
  sizeScaledGapUsdc: number | null;
};

export type TargetBlendEntry = {
  totalBuyNotional: number;
  returnPct: number | null;
};

const PCT_DECIMALS = 4;
const USD_DECIMALS = 2;

/**
 * Cost-basis-deployed return for one (wallet, condition).
 * `null` when totalBuyNotional <= 0.
 */
export function positionReturnPct(input: PositionReturnInput): number | null {
  const { totalBuyNotional, realizedCash, currentMarkValue } = input;
  if (!Number.isFinite(totalBuyNotional) || totalBuyNotional <= 0) return null;
  if (!Number.isFinite(realizedCash) || !Number.isFinite(currentMarkValue)) {
    return null;
  }
  const totalPnl = realizedCash + currentMarkValue - totalBuyNotional;
  return roundPct(totalPnl / totalBuyNotional);
}

/**
 * Pair of metrics for the Markets table sort + display.
 * `null` propagates: if either return is null we cannot compute the gap.
 */
export function edgeGap(input: EdgeGapInput): EdgeGap {
  const { ourReturnPct, targetReturnPct, ourTotalBuyNotional } = input;
  if (ourReturnPct === null || targetReturnPct === null) {
    return { rateGapPct: null, sizeScaledGapUsdc: null };
  }
  if (!Number.isFinite(ourTotalBuyNotional) || ourTotalBuyNotional <= 0) {
    // Rate gap is still defined; dollar scaling is not.
    return {
      rateGapPct: roundPct(targetReturnPct - ourReturnPct),
      sizeScaledGapUsdc: null,
    };
  }
  const rate = targetReturnPct - ourReturnPct;
  return {
    rateGapPct: roundPct(rate),
    sizeScaledGapUsdc: roundUsd(rate * ourTotalBuyNotional),
  };
}

/**
 * Cost-basis-weighted blend across N active copy-targets on one
 * condition. Weights are each target's `totalBuyNotional`. Targets
 * with `null` returnPct (zero-buy-notional rows) are excluded from
 * both numerator and denominator. Returns `null` if no target has
 * positive buy notional with a defined return.
 */
export function blendTargetReturns(
  entries: readonly TargetBlendEntry[]
): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const e of entries) {
    if (e.returnPct === null) continue;
    if (!Number.isFinite(e.totalBuyNotional) || e.totalBuyNotional <= 0) {
      continue;
    }
    weightedSum += e.totalBuyNotional * e.returnPct;
    weightSum += e.totalBuyNotional;
  }
  if (weightSum <= 0) return null;
  return roundPct(weightedSum / weightSum);
}

function roundPct(value: number): number {
  const m = 10 ** PCT_DECIMALS;
  return Math.round(value * m) / m;
}

function roundUsd(value: number): number {
  const m = 10 ** USD_DECIMALS;
  return Math.round(value * m) / m;
}
