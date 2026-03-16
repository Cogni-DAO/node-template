// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/settlement/tests/resolve`
 * Purpose: Unit tests for recipient resolution — partitioning into claimable vs accruing entitlements.
 * Scope: Pure unit tests with mock wallet lookups. Does not perform DB queries or I/O.
 * Invariants: RESOLUTION_READS_EXISTING, UNLINKED_ACCRUE_NOT_DROP, TOKEN_AMOUNT_INTEGER_SCALED
 * Side-effects: none
 * Links: packages/settlement/src/resolve.ts
 * @internal
 */

import type { AttributionClaimant } from "@cogni/attribution-ledger";
import type { OwnershipModel, StatementLineInput } from "@cogni/settlement";
import { resolveRecipients } from "@cogni/settlement";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

const POLICY: OwnershipModel = {
  template: "attribution-1to1-v0",
  tokenDecimals: 18,
  claimWindowDays: 90,
};

const WALLET_ALICE: Address = "0x1111111111111111111111111111111111111111";
const WALLET_BOB: Address = "0x2222222222222222222222222222222222222222";

function userClaimant(userId: string): AttributionClaimant {
  return { kind: "user", userId };
}

function identityClaimant(
  provider: string,
  externalId: string
): AttributionClaimant {
  return { kind: "identity", provider, externalId, providerLogin: null };
}

function makeLine(
  claimantKey: string,
  claimant: AttributionClaimant,
  creditAmount: bigint
): StatementLineInput {
  return { claimantKey, claimant, creditAmount };
}

describe("resolveRecipients", () => {
  it("all linked — all claimable, none accruing", () => {
    const lines: StatementLineInput[] = [
      makeLine("user:alice", userClaimant("alice"), 10n),
      makeLine("user:bob", userClaimant("bob"), 20n),
    ];
    const lookup = new Map<string, Address>([
      ["user:alice", WALLET_ALICE],
      ["user:bob", WALLET_BOB],
    ]);

    const result = resolveRecipients(lines, lookup, POLICY);

    expect(result.claimable).toHaveLength(2);
    expect(result.accruing).toHaveLength(0);
    expect(result.claimable[0]!.index).toBe(0);
    expect(result.claimable[0]!.wallet).toBe(WALLET_ALICE);
    expect(result.claimable[0]!.tokenAmount).toBe(10n * 10n ** 18n);
    expect(result.claimable[1]!.index).toBe(1);
    expect(result.claimable[1]!.tokenAmount).toBe(20n * 10n ** 18n);
    expect(result.totalClaimable).toBe(30n * 10n ** 18n);
    expect(result.totalAccruing).toBe(0n);
  });

  it("all unlinked — none claimable, all accruing", () => {
    const lines: StatementLineInput[] = [
      makeLine("user:alice", userClaimant("alice"), 10n),
      makeLine("identity:github:123", identityClaimant("github", "123"), 5n),
    ];
    const lookup = new Map<string, Address>();

    const result = resolveRecipients(lines, lookup, POLICY);

    expect(result.claimable).toHaveLength(0);
    expect(result.accruing).toHaveLength(2);
    expect(result.accruing[0]!.reason).toBe("no_wallet");
    expect(result.accruing[1]!.reason).toBe("no_wallet");
    expect(result.totalClaimable).toBe(0n);
    expect(result.totalAccruing).toBe(15n * 10n ** 18n);
  });

  it("mixed — partitions correctly", () => {
    const lines: StatementLineInput[] = [
      makeLine("user:alice", userClaimant("alice"), 10n),
      makeLine("identity:github:456", identityClaimant("github", "456"), 20n),
      makeLine("user:bob", userClaimant("bob"), 30n),
    ];
    const lookup = new Map<string, Address>([
      ["user:alice", WALLET_ALICE],
      // identity:github:456 has no wallet
      // user:bob has no wallet
    ]);

    const result = resolveRecipients(lines, lookup, POLICY);

    expect(result.claimable).toHaveLength(1);
    expect(result.claimable[0]!.wallet).toBe(WALLET_ALICE);
    expect(result.claimable[0]!.index).toBe(0);
    expect(result.accruing).toHaveLength(2);
    expect(result.totalClaimable).toBe(10n * 10n ** 18n);
    expect(result.totalAccruing).toBe(50n * 10n ** 18n);
  });

  it("empty input — returns empty result", () => {
    const result = resolveRecipients([], new Map(), POLICY);

    expect(result.claimable).toHaveLength(0);
    expect(result.accruing).toHaveLength(0);
    expect(result.totalClaimable).toBe(0n);
    expect(result.totalAccruing).toBe(0n);
  });

  it("respects token decimals from policy", () => {
    const policy0: OwnershipModel = {
      template: "attribution-1to1-v0",
      tokenDecimals: 0,
      claimWindowDays: 90,
    };

    const lines: StatementLineInput[] = [
      makeLine("user:alice", userClaimant("alice"), 42n),
    ];
    const lookup = new Map<string, Address>([["user:alice", WALLET_ALICE]]);

    const result = resolveRecipients(lines, lookup, policy0);

    // With 0 decimals, tokenAmount = creditAmount * 10^0 = creditAmount * 1
    expect(result.claimable[0]!.tokenAmount).toBe(42n);
  });

  it("claimable indices are sequential starting from 0", () => {
    const lines: StatementLineInput[] = [
      makeLine("user:unlinked", userClaimant("unlinked"), 1n),
      makeLine("user:alice", userClaimant("alice"), 2n),
      makeLine("user:also-unlinked", userClaimant("also-unlinked"), 3n),
      makeLine("user:bob", userClaimant("bob"), 4n),
    ];
    const lookup = new Map<string, Address>([
      ["user:alice", WALLET_ALICE],
      ["user:bob", WALLET_BOB],
    ]);

    const result = resolveRecipients(lines, lookup, POLICY);

    expect(result.claimable).toHaveLength(2);
    expect(result.claimable[0]!.index).toBe(0);
    expect(result.claimable[1]!.index).toBe(1);
  });

  it("preserves claimant info in accruing entries", () => {
    const githubClaimant = identityClaimant("github", "789");
    const lines: StatementLineInput[] = [
      makeLine("identity:github:789", githubClaimant, 100n),
    ];

    const result = resolveRecipients(lines, new Map(), POLICY);

    expect(result.accruing[0]!.claimant).toEqual(githubClaimant);
    expect(result.accruing[0]!.creditAmount).toBe(100n);
    expect(result.accruing[0]!.claimantKey).toBe("identity:github:789");
  });
});
