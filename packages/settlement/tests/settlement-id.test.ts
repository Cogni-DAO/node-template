// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/tests/settlement-id`
 * Purpose: Unit tests for deterministic settlement ID derivation.
 * Scope: Pure unit tests with synthetic inputs. Does not perform I/O or use randomness.
 * Invariants: SETTLEMENT_ID_DETERMINISTIC
 * Side-effects: none
 * Links: packages/settlement/src/settlement-id.ts
 * @internal
 */

import { computeSettlementId } from "@cogni/settlement";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

const BASE_PARAMS = {
  statementHash: "abc123def456",
  nodeId: "550e8400-e29b-41d4-a716-446655440000",
  scopeId: "660e8400-e29b-41d4-a716-446655440000",
  chainId: 8453n, // Base mainnet
  tokenAddress: "0x1234567890123456789012345678901234567890" as Address,
  policyHash: "policy-hash-v0",
  programType: "attribution-1to1-v0",
  sequence: 0n,
};

describe("computeSettlementId", () => {
  it("returns a 32-byte keccak256 hash", () => {
    const id = computeSettlementId(BASE_PARAMS);
    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = computeSettlementId(BASE_PARAMS);
    const b = computeSettlementId(BASE_PARAMS);
    expect(a).toBe(b);
  });

  it("different statementHash produces different ID", () => {
    const a = computeSettlementId(BASE_PARAMS);
    const b = computeSettlementId({
      ...BASE_PARAMS,
      statementHash: "different-hash",
    });
    expect(a).not.toBe(b);
  });

  it("different sequence produces different ID", () => {
    const a = computeSettlementId({ ...BASE_PARAMS, sequence: 0n });
    const b = computeSettlementId({ ...BASE_PARAMS, sequence: 1n });
    expect(a).not.toBe(b);
  });

  it("different chainId produces different ID", () => {
    const a = computeSettlementId({ ...BASE_PARAMS, chainId: 8453n });
    const b = computeSettlementId({ ...BASE_PARAMS, chainId: 84532n }); // Sepolia
    expect(a).not.toBe(b);
  });

  it("different nodeId produces different ID", () => {
    const a = computeSettlementId(BASE_PARAMS);
    const b = computeSettlementId({
      ...BASE_PARAMS,
      nodeId: "770e8400-e29b-41d4-a716-446655440000",
    });
    expect(a).not.toBe(b);
  });

  it("different tokenAddress produces different ID", () => {
    const a = computeSettlementId(BASE_PARAMS);
    const b = computeSettlementId({
      ...BASE_PARAMS,
      tokenAddress: "0xdead000000000000000000000000000000000000",
    });
    expect(a).not.toBe(b);
  });
});
