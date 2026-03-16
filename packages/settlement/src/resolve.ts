// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/resolve`
 * Purpose: Pure recipient resolution — partitions statement lines into claimable vs accruing entitlements.
 * Scope: Takes a pre-loaded wallet lookup and ownership model. Does not perform DB queries or I/O.
 * Invariants:
 * - RESOLUTION_READS_EXISTING: Pure function consuming a pre-loaded wallet lookup. No DB queries.
 * - UNLINKED_ACCRUE_NOT_DROP: Claimants without wallets are excluded from tree but NOT dropped.
 * - TOKEN_AMOUNT_INTEGER_SCALED: tokenAmount = creditAmount × 10^tokenDecimals.
 * - ALL_MATH_BIGINT: No floating point in token amount calculations.
 * Side-effects: none
 * Links: docs/spec/on-chain-settlement.md
 * @public
 */

import type { AttributionClaimant } from "@cogni/attribution-ledger";
import type { Address } from "viem";

import type {
  AccruingEntitlement,
  ClaimableEntitlement,
  OwnershipModel,
  ResolutionResult,
} from "./types.js";

/** Minimal statement line input — what resolveRecipients needs. */
export interface StatementLineInput {
  readonly claimantKey: string;
  readonly claimant: AttributionClaimant;
  readonly creditAmount: bigint;
}

/**
 * Resolve statement lines into claimable and accruing entitlements.
 *
 * - Claimable: wallet found in lookup → included in Merkle tree with scaled token amount.
 * - Accruing: no wallet → NOT dropped, entitlement remains for next publication.
 *
 * @param statementLines - Attribution statement lines with credit amounts
 * @param walletLookup - Pre-loaded Map<claimantKey, Address> from DB
 * @param policy - Ownership model with token decimals for scaling
 * @returns Partitioned resolution result
 */
export function resolveRecipients(
  statementLines: readonly StatementLineInput[],
  walletLookup: ReadonlyMap<string, Address>,
  policy: OwnershipModel
): ResolutionResult {
  const scaleFactor = 10n ** BigInt(policy.tokenDecimals);

  const claimable: ClaimableEntitlement[] = [];
  const accruing: AccruingEntitlement[] = [];
  let totalClaimable = 0n;
  let totalAccruing = 0n;
  let claimableIndex = 0;

  for (const line of statementLines) {
    const wallet = walletLookup.get(line.claimantKey);

    if (wallet) {
      const tokenAmount = line.creditAmount * scaleFactor;
      claimable.push({
        index: claimableIndex,
        claimantKey: line.claimantKey,
        wallet,
        tokenAmount,
      });
      totalClaimable += tokenAmount;
      claimableIndex++;
    } else {
      accruing.push({
        claimantKey: line.claimantKey,
        claimant: line.claimant,
        creditAmount: line.creditAmount,
        reason: "no_wallet",
      });
      totalAccruing += line.creditAmount * scaleFactor;
    }
  }

  return { claimable, accruing, totalClaimable, totalAccruing };
}
