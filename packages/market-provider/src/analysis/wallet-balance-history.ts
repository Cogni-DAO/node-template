// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/analysis/wallet-balance-history`
 * Purpose: Derives a compact wallet balance-history series from live Polymarket trades, current open positions, and public price history.
 * Scope: Pure helper only. Does not fetch, mutate, or read env.
 * Invariants:
 *   - Series is derived from real upstream data; no synthetic interpolation.
 *   - Current cash snapshot is anchored to the caller-provided wallet balance.
 *   - Historical cash excludes deposits, withdrawals, and historical locked-order
 *     state the upstream APIs do not expose yet.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @public
 */

import type {
  ClobPriceHistoryPoint,
  PolymarketUserPosition,
  PolymarketUserTrade,
} from "../adapters/polymarket/index.js";

const EPSILON = 1e-6;
const SEC_PER_DAY = 86_400;

export type WalletBalanceHistoryPoint = {
  readonly ts: string;
  readonly total: number;
};

export type MapWalletBalanceHistoryInput = {
  readonly positions: readonly PolymarketUserPosition[];
  readonly trades: readonly PolymarketUserTrade[];
  readonly priceHistoryByAsset?: ReadonlyMap<
    string,
    readonly ClobPriceHistoryPoint[]
  >;
  readonly currentCash: number;
  readonly asOfIso?: string;
  readonly windowDays?: number;
};

export function mapWalletBalanceHistory({
  positions,
  trades,
  priceHistoryByAsset,
  currentCash,
  asOfIso = new Date().toISOString(),
  windowDays = 14,
}: MapWalletBalanceHistoryInput): WalletBalanceHistoryPoint[] {
  const asOfSec = Math.floor(new Date(asOfIso).getTime() / 1000);
  const safeWindowDays = Math.max(2, Math.floor(windowDays));
  const sampleSecs = Array.from({ length: safeWindowDays }, (_, index) => {
    const offset = safeWindowDays - 1 - index;
    return asOfSec - offset * SEC_PER_DAY;
  });
  const earliestSampleSec = sampleSecs[0] ?? asOfSec;
  const relevantTrades = trades
    .filter((trade) => trade.timestamp >= earliestSampleSec)
    .sort((left, right) => right.timestamp - left.timestamp);

  const assets = new Set<string>();
  const currentSizeByAsset = new Map<string, number>();
  const fallbackPriceByAsset = new Map<string, number>();

  for (const position of positions) {
    const size = sanitizeNumber(position.size);
    if (size > EPSILON) {
      currentSizeByAsset.set(position.asset, size);
      assets.add(position.asset);
    }
    const currentPrice =
      sanitizePositive(position.curPrice) ??
      sanitizePositive(position.avgPrice) ??
      0;
    if (currentPrice > 0) {
      fallbackPriceByAsset.set(position.asset, currentPrice);
    }
  }

  for (const trade of relevantTrades) {
    assets.add(trade.asset);
    const tradePrice = sanitizePositive(trade.price);
    if (tradePrice !== null && !fallbackPriceByAsset.has(trade.asset)) {
      fallbackPriceByAsset.set(trade.asset, tradePrice);
    }
  }

  const priceSeriesByAsset = new Map<string, PricePoint[]>();
  for (const asset of assets) {
    const pointsByTs = new Map<number, number>();
    for (const point of priceHistoryByAsset?.get(asset) ?? []) {
      const t = Math.floor(point.t);
      if (!Number.isFinite(t) || !Number.isFinite(point.p)) continue;
      pointsByTs.set(t, point.p);
    }
    for (const trade of relevantTrades) {
      if (trade.asset !== asset) continue;
      pointsByTs.set(trade.timestamp, trade.price);
    }
    const currentPrice = fallbackPriceByAsset.get(asset);
    if (currentPrice !== undefined && currentPrice > 0) {
      pointsByTs.set(asOfSec, currentPrice);
    }
    const series = [...pointsByTs.entries()]
      .map(([t, p]) => ({ t, p }))
      .sort((left, right) => left.t - right.t);
    if (series.length > 0) {
      priceSeriesByAsset.set(asset, series);
    }
  }

  const stateCash = Number.isFinite(currentCash) ? currentCash : 0;
  const stateSizeByAsset = new Map(currentSizeByAsset);
  const series: WalletBalanceHistoryPoint[] = Array.from({
    length: safeWindowDays,
  });
  let tradeIndex = 0;
  let rewoundCash = stateCash;

  for (
    let sampleIndex = sampleSecs.length - 1;
    sampleIndex >= 0;
    sampleIndex--
  ) {
    const sampleSec = sampleSecs[sampleIndex] ?? asOfSec;

    while (
      tradeIndex < relevantTrades.length &&
      (relevantTrades[tradeIndex]?.timestamp ?? 0) > sampleSec
    ) {
      const trade = relevantTrades[tradeIndex];
      if (!trade) break;
      const usd = sanitizeNumber(trade.size) * sanitizeNumber(trade.price);
      const previousSize = stateSizeByAsset.get(trade.asset) ?? 0;
      if (trade.side.toUpperCase() === "BUY") {
        rewoundCash += usd;
        stateSizeByAsset.set(
          trade.asset,
          Math.max(0, previousSize - trade.size)
        );
      } else {
        rewoundCash -= usd;
        stateSizeByAsset.set(trade.asset, previousSize + trade.size);
      }
      tradeIndex += 1;
    }

    let positionsValue = 0;
    for (const asset of assets) {
      const size = stateSizeByAsset.get(asset) ?? 0;
      if (size <= EPSILON) continue;
      const price = getPriceAt(
        priceSeriesByAsset.get(asset) ?? [],
        sampleSec,
        fallbackPriceByAsset.get(asset) ?? 0
      );
      positionsValue += size * price;
    }

    series[sampleIndex] = {
      ts: toIso(sampleSec),
      total: roundToCents(rewoundCash + positionsValue),
    };
  }

  return series;
}

type PricePoint = {
  readonly t: number;
  readonly p: number;
};

function getPriceAt(
  series: readonly PricePoint[],
  sampleSec: number,
  fallbackPrice: number
): number {
  if (series.length === 0) return fallbackPrice;

  let left = 0;
  let right = series.length - 1;
  let bestIndex = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const point = series[mid];
    if (!point) break;
    if (point.t <= sampleSec) {
      bestIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (bestIndex >= 0) {
    return sanitizePositive(series[bestIndex]?.p) ?? fallbackPrice;
  }

  return sanitizePositive(series[0]?.p) ?? fallbackPrice;
}

function sanitizeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function sanitizePositive(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIso(tsSec: number): string {
  return new Date(tsSec * 1_000).toISOString();
}
