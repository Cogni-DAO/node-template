// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/tests/merkle`
 * Purpose: Unit tests for Merkle tree construction, proof generation, and verification.
 * Scope: Pure unit tests with synthetic entitlements. Does not perform I/O or require infrastructure.
 * Invariants: LEAF_ENCODING_UNISWAP, TREE_SORTED_PAIR, ALL_MATH_BIGINT
 * Side-effects: none
 * Links: packages/settlement/src/merkle.ts
 * @internal
 */

import type { ClaimableEntitlement } from "@cogni/settlement";
import {
  computeLeaf,
  computeMerkleTree,
  hashPair,
  verifyProof,
} from "@cogni/settlement";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

const WALLET_A: Address = "0x1111111111111111111111111111111111111111";
const WALLET_B: Address = "0x2222222222222222222222222222222222222222";
const WALLET_C: Address = "0x3333333333333333333333333333333333333333";
const WALLET_D: Address = "0x4444444444444444444444444444444444444444";

function makeEntitlement(
  index: number,
  wallet: Address,
  tokenAmount: bigint
): ClaimableEntitlement {
  return {
    index,
    claimantKey: `user:${wallet}`,
    wallet,
    tokenAmount,
  };
}

describe("computeLeaf", () => {
  it("returns a 32-byte keccak256 hash", () => {
    const leaf = computeLeaf(0n, WALLET_A, 1000n);
    expect(leaf).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = computeLeaf(0n, WALLET_A, 1000n);
    const b = computeLeaf(0n, WALLET_A, 1000n);
    expect(a).toBe(b);
  });

  it("different inputs produce different hashes", () => {
    const a = computeLeaf(0n, WALLET_A, 1000n);
    const b = computeLeaf(1n, WALLET_A, 1000n);
    const c = computeLeaf(0n, WALLET_B, 1000n);
    const d = computeLeaf(0n, WALLET_A, 2000n);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
});

describe("hashPair", () => {
  it("is commutative — hashPair(a, b) === hashPair(b, a)", () => {
    const leafA = computeLeaf(0n, WALLET_A, 100n);
    const leafB = computeLeaf(1n, WALLET_B, 200n);
    expect(hashPair(leafA, leafB)).toBe(hashPair(leafB, leafA));
  });
});

describe("computeMerkleTree", () => {
  it("empty entitlements — returns zero root, zero total, empty leaves", () => {
    const result = computeMerkleTree([]);
    expect(result.root).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(result.totalAmount).toBe(0n);
    expect(result.leaves).toHaveLength(0);
  });

  it("single entitlement — root is the leaf hash, proof is empty", () => {
    const entitlements = [makeEntitlement(0, WALLET_A, 1000n)];
    const result = computeMerkleTree(entitlements);

    expect(result.totalAmount).toBe(1000n);
    expect(result.leaves).toHaveLength(1);
    expect(result.leaves[0]!.proof).toHaveLength(0);

    const expectedRoot = computeLeaf(0n, WALLET_A, 1000n);
    expect(result.root).toBe(expectedRoot);
  });

  it("two entitlements — proofs verify correctly", () => {
    const entitlements = [
      makeEntitlement(0, WALLET_A, 500n),
      makeEntitlement(1, WALLET_B, 300n),
    ];
    const result = computeMerkleTree(entitlements);

    expect(result.totalAmount).toBe(800n);
    expect(result.leaves).toHaveLength(2);

    // Verify both proofs
    for (const leaf of result.leaves) {
      const leafHash = computeLeaf(
        BigInt(leaf.index),
        leaf.wallet,
        leaf.amount
      );
      expect(verifyProof(result.root, leafHash, leaf.proof)).toBe(true);
    }
  });

  it("power-of-2 entitlements (4) — all proofs verify", () => {
    const entitlements = [
      makeEntitlement(0, WALLET_A, 100n),
      makeEntitlement(1, WALLET_B, 200n),
      makeEntitlement(2, WALLET_C, 300n),
      makeEntitlement(3, WALLET_D, 400n),
    ];
    const result = computeMerkleTree(entitlements);

    expect(result.totalAmount).toBe(1000n);
    expect(result.leaves).toHaveLength(4);

    for (const leaf of result.leaves) {
      const leafHash = computeLeaf(
        BigInt(leaf.index),
        leaf.wallet,
        leaf.amount
      );
      expect(verifyProof(result.root, leafHash, leaf.proof)).toBe(true);
    }
  });

  it("non-power-of-2 entitlements (3) — all proofs verify", () => {
    const entitlements = [
      makeEntitlement(0, WALLET_A, 100n),
      makeEntitlement(1, WALLET_B, 200n),
      makeEntitlement(2, WALLET_C, 300n),
    ];
    const result = computeMerkleTree(entitlements);

    expect(result.totalAmount).toBe(600n);
    expect(result.leaves).toHaveLength(3);

    for (const leaf of result.leaves) {
      const leafHash = computeLeaf(
        BigInt(leaf.index),
        leaf.wallet,
        leaf.amount
      );
      expect(verifyProof(result.root, leafHash, leaf.proof)).toBe(true);
    }
  });

  it("invalid proof does not verify", () => {
    const entitlements = [
      makeEntitlement(0, WALLET_A, 100n),
      makeEntitlement(1, WALLET_B, 200n),
    ];
    const result = computeMerkleTree(entitlements);

    // Use a different leaf hash to test invalid proof
    const wrongLeaf = computeLeaf(0n, WALLET_C, 100n);
    expect(verifyProof(result.root, wrongLeaf, result.leaves[0]!.proof)).toBe(
      false
    );
  });

  it("totalAmount sums all token amounts using bigint", () => {
    const large = 10n ** 18n;
    const entitlements = [
      makeEntitlement(0, WALLET_A, large),
      makeEntitlement(1, WALLET_B, large),
      makeEntitlement(2, WALLET_C, large),
    ];
    const result = computeMerkleTree(entitlements);
    expect(result.totalAmount).toBe(3n * large);
  });
});
