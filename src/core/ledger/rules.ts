// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/rules`
 * Purpose: Payout computation with BIGINT arithmetic and largest-remainder rounding (ALL_MATH_BIGINT).
 * Scope: Pure function. Does not perform I/O or mutate external state.
 * Invariants:
 * - All arithmetic uses BigInt — no floating point (ALL_MATH_BIGINT).
 * - Sum of payout amounts === poolTotalCredits (PAYOUT_DETERMINISTIC).
 * - Largest-remainder method distributes rounding residual.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md#payout-computation
 * @public
 */

import type { ApprovedReceipt, PayoutLineItem } from "./model";

/**
 * Precision multiplier for share computation.
 * We use 18 decimal digits of precision (same as ETH wei) for intermediate share calculations.
 */
const SHARE_PRECISION = 10n ** 18n;

/**
 * Compute proportional payouts from approved receipts and a pool total.
 *
 * 1. Group receipts by user_id, sum valuation_units per user
 * 2. Compute each user's share: user_units / total_units
 * 3. Distribute pool_total_credits proportionally using BIGINT arithmetic
 * 4. Apply largest-remainder rounding to ensure exact sum equals pool total
 *
 * @param receipts - Approved receipts (may contain multiple per user)
 * @param poolTotalCredits - Total credit pool to distribute
 * @returns Sorted payout line items (deterministic order by userId)
 */
export function computePayouts(
  receipts: readonly ApprovedReceipt[],
  poolTotalCredits: bigint
): PayoutLineItem[] {
  if (receipts.length === 0) {
    return [];
  }

  if (poolTotalCredits <= 0n) {
    return [];
  }

  // Step 1: Group by userId, sum units
  const userUnits = new Map<string, bigint>();
  for (const receipt of receipts) {
    const current = userUnits.get(receipt.userId) ?? 0n;
    userUnits.set(receipt.userId, current + receipt.valuationUnits);
  }

  // Compute total units
  let totalUnits = 0n;
  for (const units of userUnits.values()) {
    totalUnits += units;
  }

  if (totalUnits === 0n) {
    return [];
  }

  // Step 2-3: Compute floor allocations and remainders
  // Sort by userId for deterministic output
  const sortedUsers = [...userUnits.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const allocations: Array<{
    userId: string;
    totalUnits: bigint;
    floor: bigint;
    remainder: bigint;
    index: number;
  }> = [];

  let floorSum = 0n;

  for (const [userId, units] of sortedUsers) {
    // floor = (units * poolTotalCredits) / totalUnits (integer division)
    const floor = (units * poolTotalCredits) / totalUnits;
    // remainder = (units * poolTotalCredits) % totalUnits
    const remainder = (units * poolTotalCredits) % totalUnits;

    allocations.push({
      userId,
      totalUnits: units,
      floor,
      remainder,
      index: allocations.length,
    });
    floorSum += floor;
  }

  // Step 4: Largest-remainder rounding
  // Residual credits to distribute = poolTotalCredits - sum(floors)
  let residual = poolTotalCredits - floorSum;

  // Sort by remainder descending, then by userId for deterministic tie-breaking
  const byRemainder = [...allocations].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.userId.localeCompare(b.userId);
  });

  const bonuses = new Map<string, bigint>();
  for (const alloc of byRemainder) {
    if (residual <= 0n) break;
    bonuses.set(alloc.userId, 1n);
    residual -= 1n;
  }

  // Build final payouts, maintaining deterministic userId sort order
  return allocations.map(({ userId, totalUnits: units, floor }) => {
    const bonus = bonuses.get(userId) ?? 0n;
    const amountCredits = floor + bonus;

    // Compute share as a decimal string with 6 digits of precision
    const shareScaled = (units * SHARE_PRECISION) / totalUnits;
    const shareWhole = shareScaled / 10n ** 12n; // 6 digits
    const share = `0.${shareWhole.toString().padStart(6, "0")}`;

    return {
      userId,
      totalUnits: units,
      share,
      amountCredits,
    };
  });
}
