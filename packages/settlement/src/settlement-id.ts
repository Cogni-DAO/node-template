// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/settlement-id`
 * Purpose: Deterministic settlement ID derivation from canonical inputs.
 * Scope: Pure function. Does not perform I/O or use randomness.
 * Invariants:
 * - SETTLEMENT_ID_DETERMINISTIC: Same inputs always produce the same ID.
 * - ALL_MATH_BIGINT: Sequence and chainId as bigint for ABI encoding.
 * Side-effects: none
 * Links: docs/spec/on-chain-settlement.md
 * @public
 */

import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";

/**
 * Compute a deterministic settlement ID from canonical inputs.
 *
 * settlement_id = keccak256(abi.encode(
 *   statementHash, nodeId, scopeId, chainId, tokenAddress,
 *   policyHash, programType, sequence
 * ))
 *
 * @param params - All inputs to the settlement ID derivation
 * @returns Deterministic keccak256 hash as Hex
 */
export function computeSettlementId(params: {
  readonly statementHash: string;
  readonly nodeId: string;
  readonly scopeId: string;
  readonly chainId: bigint;
  readonly tokenAddress: Address;
  readonly policyHash: string;
  readonly programType: string;
  readonly sequence: bigint;
}): Hex {
  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "string" },
      { type: "string" },
      { type: "uint256" },
      { type: "address" },
      { type: "string" },
      { type: "string" },
      { type: "uint256" },
    ],
    [
      params.statementHash,
      params.nodeId,
      params.scopeId,
      params.chainId,
      params.tokenAddress,
      params.policyHash,
      params.programType,
      params.sequence,
    ]
  );

  return keccak256(encoded);
}
