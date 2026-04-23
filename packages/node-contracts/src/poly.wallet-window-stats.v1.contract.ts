// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet-window-stats.v1.contract`
 * Purpose: Contract for the batched per-wallet windowed stats endpoint — POST /api/v1/poly/wallets/stats.
 * Scope: Read-only; does not place orders or mutate state. Covers volumeUsdc, pnlUsdc, numTrades
 *        per (wallet, timePeriod). pnlKind is "authoritative" (positions API) or "estimated"
 *        (trade-cashflow fallback).
 * Invariants:
 *   - CONTRACT_IS_SOT: Route handler and capability both derive types from these schemas.
 *   - PURE_LIBRARY: No I/O, no env vars.
 * Side-effects: none
 * Links: work/items/task.0346.poly-wallet-stats-data-api-first.md
 * @public
 */

import { z } from "zod";
import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

export const WalletWindowTimePeriodSchema = z.enum([
  "DAY",
  "WEEK",
  "MONTH",
  "ALL",
]);
export type WalletWindowTimePeriod = z.infer<
  typeof WalletWindowTimePeriodSchema
>;

export const WalletWindowStatsSchema = z.object({
  proxyWallet: PolyAddressSchema,
  timePeriod: WalletWindowTimePeriodSchema,
  volumeUsdc: z.number(),
  pnlUsdc: z.number(),
  /** "authoritative" = Polymarket positions API (cashPnl + realizedPnl). "estimated" = trade-cashflow fallback. */
  pnlKind: z.enum(["authoritative", "estimated"]),
  roiPct: z.number().nullable(),
  numTrades: z.number().int().nonnegative(),
  /** True when the /trades response hit the fetch cap (10k); actual count may be higher. */
  numTradesCapped: z.boolean(),
  computedAt: z.string(),
});
export type WalletWindowStats = z.infer<typeof WalletWindowStatsSchema>;

export const WalletWindowStatsBatchRequestSchema = z.object({
  timePeriod: WalletWindowTimePeriodSchema,
  addresses: z.array(PolyAddressSchema).min(1).max(50),
});
export type WalletWindowStatsBatchRequest = z.infer<
  typeof WalletWindowStatsBatchRequestSchema
>;

export const WalletWindowStatsBatchSchema = z.object({
  timePeriod: WalletWindowTimePeriodSchema,
  stats: z.record(z.string(), WalletWindowStatsSchema),
});
export type WalletWindowStatsBatch = z.infer<
  typeof WalletWindowStatsBatchSchema
>;
