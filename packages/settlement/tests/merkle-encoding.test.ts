// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/tests/merkle-encoding`
 * Purpose: Verifies Merkle leaf encoding matches Uniswap MerkleDistributor.sol test vectors.
 * Scope: Pure unit tests with known test vectors. Does not perform I/O or require infrastructure.
 * Invariants: LEAF_ENCODING_UNISWAP
 * Side-effects: none
 * Links: packages/settlement/src/merkle.ts
 * @internal
 */

import type { ClaimableEntitlement } from "@cogni/settlement";
import { computeLeaf, computeMerkleTree, verifyProof } from "@cogni/settlement";
import { type Address, encodePacked, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

describe("Uniswap leaf encoding compatibility", () => {
  it("matches keccak256(abi.encodePacked(uint256, address, uint256))", () => {
    const index = 0n;
    const account: Address = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
    const amount = 1000000000000000000n; // 1e18

    // Reference: what Solidity's keccak256(abi.encodePacked(index, account, amount)) produces
    const solidityEncoded = encodePacked(
      ["uint256", "address", "uint256"],
      [index, account, amount]
    );
    const expected = keccak256(solidityEncoded);

    const actual = computeLeaf(index, account, amount);
    expect(actual).toBe(expected);
  });

  it("matches for various index/amount combinations", () => {
    const cases: [bigint, Address, bigint][] = [
      [0n, "0x0000000000000000000000000000000000000001", 0n],
      [1n, "0xdead000000000000000000000000000000000000", 1n],
      [
        42n,
        "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
        999999999999999999999n,
      ],
      [
        255n,
        "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
        10n ** 18n * 1000000n,
      ],
    ];

    for (const [index, account, amount] of cases) {
      const solidityEncoded = encodePacked(
        ["uint256", "address", "uint256"],
        [index, account, amount]
      );
      const expected = keccak256(solidityEncoded);
      expect(computeLeaf(index, account, amount)).toBe(expected);
    }
  });

  it("tree proofs verify against Uniswap-compatible leaf hashes", () => {
    const entitlements: ClaimableEntitlement[] = [
      {
        index: 0,
        claimantKey: "user:alice",
        wallet: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
        tokenAmount: 1000000000000000000n,
      },
      {
        index: 1,
        claimantKey: "user:bob",
        wallet: "0x1234567890123456789012345678901234567890",
        tokenAmount: 2000000000000000000n,
      },
      {
        index: 2,
        claimantKey: "identity:github:123",
        wallet: "0xdead000000000000000000000000000000000000",
        tokenAmount: 500000000000000000n,
      },
    ];

    const tree = computeMerkleTree(entitlements);

    // Each leaf's proof should verify against the root
    for (const leaf of tree.leaves) {
      // Reconstruct the Uniswap-compatible leaf hash
      const leafHash = keccak256(
        encodePacked(
          ["uint256", "address", "uint256"],
          [BigInt(leaf.index), leaf.wallet, leaf.amount]
        )
      );

      expect(verifyProof(tree.root, leafHash, leaf.proof)).toBe(true);
    }
  });
});
