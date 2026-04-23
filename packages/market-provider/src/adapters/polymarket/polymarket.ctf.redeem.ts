// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/ctf-redeem`
 * Purpose: Polygon Conditional Tokens `redeemPositions` calldata for resolved binary markets, which returns USDC.e after resolution (distinct from CLOB SELL while a book is live).
 * Scope: Exports pinned mainnet addresses, a minimal ABI, and a condition-id normalizer for viem callers. Does not submit transactions, hold signers, or implement grant checks.
 * Invariants:
 *   - POLYGON_MAINNET_ONLY — addresses match `approve-polymarket-allowances.ts` / Polymarket docs for chain id 137.
 *   - BINARY_INDEX_SETS — `[1, 2]` matches Polymarket binary resolution semantics; multi-outcome markets need a different path.
 * Side-effects: none (pure constants + parseAbi)
 * Links: Polymarket agent-skills ctf-operations.md; scripts/experiments/approve-polymarket-allowances.ts
 * @public
 */

import { parseAbi } from "viem";

/** Polymarket CTF / ConditionalTokens on Polygon (same as approve-polymarket script). */
export const POLYGON_CONDITIONAL_TOKENS =
  "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;

/** Bridged USDC.e — Polymarket collateral on Polygon. */
export const POLYGON_USDC_E =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

export const PARENT_COLLECTION_ID_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Binary markets: index sets 1 (Yes) and 2 (No). Only the resolved winning
 * side pays USDC when redeeming after resolution.
 */
export const BINARY_REDEEM_INDEX_SETS: readonly [bigint, bigint] = [1n, 2n];

export const polymarketCtfRedeemAbi = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
]);

/** Normalize API / DB condition ids to a 32-byte hex string. */
export function normalizePolygonConditionId(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error(
      `normalizePolygonConditionId: expected 32-byte hex condition id, got "${raw.slice(0, 42)}..."`
    );
  }
  return hex as `0x${string}`;
}
