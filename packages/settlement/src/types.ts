// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/types`
 * Purpose: Domain types for on-chain settlement — entitlement resolution, Merkle tree output, ownership model.
 * Scope: Type definitions only. Does not contain runtime logic.
 * Invariants:
 * - ALL_MATH_BIGINT: Token amounts are bigint, never floating point.
 * - PURE_PACKAGE: No Next.js, Drizzle, or runtime infrastructure imports.
 * Side-effects: none
 * Links: docs/spec/on-chain-settlement.md
 * @public
 */

import type { AttributionClaimant } from "@cogni/attribution-ledger";
import type { Address, Hex } from "viem";

/** Claimant with resolved wallet — goes into Merkle tree. */
export interface ClaimableEntitlement {
  readonly index: number;
  readonly claimantKey: string;
  readonly wallet: Address;
  readonly tokenAmount: bigint;
}

/** Claimant without wallet — accrues, included in next publication when linked. */
export interface AccruingEntitlement {
  readonly claimantKey: string;
  readonly claimant: AttributionClaimant;
  readonly creditAmount: bigint;
  readonly reason: "no_binding" | "no_wallet";
}

/** Result of resolveRecipients(). */
export interface ResolutionResult {
  readonly claimable: readonly ClaimableEntitlement[];
  readonly accruing: readonly AccruingEntitlement[];
  readonly totalClaimable: bigint;
  readonly totalAccruing: bigint;
}

/** Single leaf in the Merkle tree with its proof. */
export interface MerkleLeaf {
  readonly index: number;
  readonly wallet: Address;
  readonly amount: bigint;
  readonly proof: readonly Hex[];
}

/** Output of computeMerkleTree(). */
export interface MerkleSettlement {
  readonly root: Hex;
  readonly totalAmount: bigint;
  readonly leaves: readonly MerkleLeaf[];
}

/** Ownership model from repo-spec. */
export interface OwnershipModel {
  readonly template: "attribution-1to1-v0";
  readonly tokenDecimals: number;
  readonly claimWindowDays: number;
}
