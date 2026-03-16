// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/merkle`
 * Purpose: Uniswap-compatible Merkle tree generation for on-chain token claims.
 * Scope: Pure functions for leaf encoding, tree construction, and proof generation. Does not use OpenZeppelin encoding.
 * Invariants:
 * - LEAF_ENCODING_UNISWAP: leaf = keccak256(abi.encodePacked(uint256 index, address account, uint256 amount)).
 * - TREE_SORTED_PAIR: Internal nodes use sorted-pair hashing: a < b ? H(a‖b) : H(b‖a).
 * - ALL_MATH_BIGINT: No floating point in token amount calculations.
 * - Do NOT use @openzeppelin/merkle-tree — incompatible encoding.
 * Side-effects: none
 * Links: docs/spec/on-chain-settlement.md
 * @public
 */

import { type Address, concat, encodePacked, type Hex, keccak256 } from "viem";

import type {
  ClaimableEntitlement,
  MerkleLeaf,
  MerkleSettlement,
} from "./types.js";

// Empty tree sentinel — keccak256 of empty bytes
const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Compute a Merkle leaf matching Uniswap MerkleDistributor.claim() encoding.
 *
 * Solidity equivalent:
 *   bytes32 node = keccak256(abi.encodePacked(index, account, amount));
 */
export function computeLeaf(
  index: bigint,
  wallet: Address,
  amount: bigint
): Hex {
  return keccak256(
    encodePacked(["uint256", "address", "uint256"], [index, wallet, amount])
  );
}

/**
 * Sorted-pair hash for internal Merkle tree nodes.
 * Matches Uniswap/OZ MerkleProof.verify() behavior.
 */
export function hashPair(a: Hex, b: Hex): Hex {
  return a < b ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/**
 * Build a Uniswap-compatible Merkle tree from claimable entitlements.
 *
 * Returns root, totalAmount, and per-leaf proofs. Each leaf encodes
 * (index, wallet, tokenAmount) per LEAF_ENCODING_UNISWAP.
 *
 * Edge cases:
 * - 0 entitlements: root = 0x00...00, totalAmount = 0n, leaves = []
 * - 1 entitlement: root = the single leaf hash, proof = []
 */
export function computeMerkleTree(
  entitlements: readonly ClaimableEntitlement[]
): MerkleSettlement {
  if (entitlements.length === 0) {
    return { root: ZERO_BYTES32, totalAmount: 0n, leaves: [] };
  }

  // Compute leaves
  const leafHashes: Hex[] = entitlements.map((e) =>
    computeLeaf(BigInt(e.index), e.wallet, e.tokenAmount)
  );

  // Build tree layers bottom-up
  const layers: Hex[][] = [leafHashes];
  let currentLayer = leafHashes;

  while (currentLayer.length > 1) {
    const nextLayer: Hex[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i]!, currentLayer[i + 1]!));
      } else {
        // Odd node promoted without hashing
        nextLayer.push(currentLayer[i]!);
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const root = currentLayer[0]!;

  // Compute totalAmount
  let totalAmount = 0n;
  for (const e of entitlements) {
    totalAmount += e.tokenAmount;
  }

  // Generate proofs for each leaf
  const leaves: MerkleLeaf[] = entitlements.map((e, leafIndex) => {
    const proof = generateProof(layers, leafIndex);
    return {
      index: e.index,
      wallet: e.wallet,
      amount: e.tokenAmount,
      proof,
    };
  });

  return { root, totalAmount, leaves };
}

/**
 * Generate a Merkle proof for a leaf at the given index.
 */
function generateProof(layers: Hex[][], leafIndex: number): Hex[] {
  const proof: Hex[] = [];
  let idx = leafIndex;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i]!;
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;

    if (siblingIdx < layer.length) {
      proof.push(layer[siblingIdx]!);
    }
    // Move to parent index
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Verify a Merkle proof against a root.
 * Useful for testing; mirrors on-chain MerkleProof.verify().
 */
export function verifyProof(
  root: Hex,
  leaf: Hex,
  proof: readonly Hex[]
): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed === root;
}
