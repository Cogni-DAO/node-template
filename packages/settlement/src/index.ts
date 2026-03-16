// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement`
 * Purpose: Pure domain logic for on-chain settlement — Merkle tree generation, recipient resolution, settlement ID computation.
 * Scope: Exports pure functions and domain types. Does not depend on DB, Temporal, or runtime infrastructure.
 * Invariants:
 * - PURE_PACKAGE: No Next.js, Drizzle, or service-layer dependencies.
 * - LEAF_ENCODING_UNISWAP: Merkle leaves match Uniswap MerkleDistributor.claim() encoding.
 * - ALL_MATH_BIGINT: No floating point in token calculations.
 * Side-effects: none
 * Links: docs/spec/on-chain-settlement.md
 * @public
 */

// Merkle tree
export {
  computeLeaf,
  computeMerkleTree,
  hashPair,
  verifyProof,
} from "./merkle.js";
// Recipient resolution
export { resolveRecipients, type StatementLineInput } from "./resolve.js";
// Settlement ID
export { computeSettlementId } from "./settlement-id.js";
// Domain types
export type {
  AccruingEntitlement,
  ClaimableEntitlement,
  MerkleLeaf,
  MerkleSettlement,
  OwnershipModel,
  ResolutionResult,
} from "./types.js";
