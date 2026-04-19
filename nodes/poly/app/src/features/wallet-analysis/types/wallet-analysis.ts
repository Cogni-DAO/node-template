// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/types/wallet-analysis`
 * Purpose: Shared shape for `WalletAnalysisView` and its molecules.
 * Scope: Pure type definitions; no logic. Mirrors the v1 wallet-analysis HTTP contract (Checkpoint B).
 * Invariants: All slices independently optional — molecules render skeletons when their slice is absent.
 * Side-effects: none
 * @public
 */

export type WalletTradeSide = "BUY" | "SELL";

export type WalletTrade = {
  ts: string;
  side: WalletTradeSide;
  size: string;
  px: string;
  mkt: string;
};

export type WalletDailyCount = {
  d: string;
  n: number;
};

export type WalletSnapshot = {
  n: number;
  wr: number;
  roi: number;
  pnl: string;
  dd: number;
  medianDur: string;
  avgPerDay: number;
  hypothesisMd?: string;
  takenAt?: string;
  category?: string;
};

export type WalletTrades = {
  last: readonly WalletTrade[];
  dailyCounts: readonly WalletDailyCount[];
  topMarkets: readonly string[];
};

export type WalletBalance = {
  available: number;
  locked: number;
  positions: number;
  total: number;
};

export type WalletIdentity = {
  name?: string;
  category?: string;
  isPrimaryTarget?: boolean;
};

export type WalletAnalysisData = {
  address: string;
  identity: WalletIdentity;
  snapshot?: WalletSnapshot;
  trades?: WalletTrades;
  balance?: WalletBalance;
};

export type WalletAnalysisVariant = "page" | "drawer" | "compact";
export type WalletAnalysisSize = "hero" | "default";
