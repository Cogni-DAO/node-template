// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/setup/verify`
 * Purpose: Contract tests for DAO formation verification endpoint.
 * Scope: Tests /api/setup/verify security boundary and validation logic; does not make real RPC calls.
 * Invariants: Server NEVER trusts client-supplied DAO/plugin/signal addresses; only txHashes accepted. Split + operator wallet addresses are client-provided (deployed by client wallet).
 * Side-effects: none
 * Links: src/app/api/setup/verify/route.ts
 * @public
 */

import { describe, expect, it } from "vitest";

import { setupVerifyOperation } from "@/contracts/setup.verify.v1.contract";

const VALID_INPUT = {
  chainId: 8453,
  daoTxHash:
    "0x1234567890123456789012345678901234567890123456789012345678901234",
  signalTxHash:
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  signalBlockNumber: 12345678,
  initialHolder: "0x1234567890123456789012345678901234567890",
  splitAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  operatorWalletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} as const;

describe("setupVerifyOperation contract", () => {
  describe("input validation", () => {
    it("accepts valid BASE chainId (8453)", () => {
      const result = setupVerifyOperation.input.safeParse(VALID_INPUT);
      expect(result.success).toBe(true);
    });

    it("accepts valid SEPOLIA chainId (11155111)", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        chainId: 11155111,
      });
      expect(result.success).toBe(true);
    });

    it("rejects unsupported chainId (Ethereum mainnet)", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        chainId: 1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("8453");
      }
    });

    it("rejects unsupported chainId (Base Sepolia)", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        chainId: 84532,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid tx hash format", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        daoTxHash: "0xinvalid",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Invalid tx hash");
      }
    });

    it("rejects invalid address format", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        initialHolder: "0xinvalid",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Invalid address");
      }
    });

    it("rejects missing signalBlockNumber", () => {
      const { signalBlockNumber: _, ...withoutBlock } = VALID_INPUT;
      const result = setupVerifyOperation.input.safeParse(withoutBlock);
      expect(result.success).toBe(false);
    });

    it("SECURITY: rejects request with client-supplied daoAddress field", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        daoAddress: "0xMALICIOUS0000000000000000000000000000000",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
      }
    });

    it("SECURITY: rejects request with client-supplied pluginAddress field", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        pluginAddress: "0xMALICIOUS0000000000000000000000000000000",
      });
      expect(result.success).toBe(false);
    });

    it("SECURITY: rejects request with client-supplied signalAddress field", () => {
      const result = setupVerifyOperation.input.safeParse({
        ...VALID_INPUT,
        signalAddress: "0xMALICIOUS0000000000000000000000000000000",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("output validation", () => {
    it("validates successful verification response structure", () => {
      const success = {
        verified: true as const,
        addresses: {
          dao: "0x1234567890123456789012345678901234567890",
          token: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          plugin: "0x9876543210987654321098765432109876543210",
          signal: "0xfedcbafedcbafedcbafedcbafedcbafedcbafedc",
          split: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        repoSpecYaml: 'cogni_dao:\n  chain_id: "8453"\n',
      };

      const result = setupVerifyOperation.output.safeParse(success);
      expect(result.success).toBe(true);
    });

    it("validates failure response structure", () => {
      const failure = {
        verified: false as const,
        errors: ["DAORegistered event not found", "Transaction reverted"],
      };

      const result = setupVerifyOperation.output.safeParse(failure);
      expect(result.success).toBe(true);
    });
  });
});
