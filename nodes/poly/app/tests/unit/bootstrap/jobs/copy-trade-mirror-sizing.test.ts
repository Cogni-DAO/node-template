// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/jobs/copy-trade-mirror-sizing`
 * Purpose: Verify bootstrap target config wires the conviction-aware bet sizer
 * only for the curated top target wallets.
 * Scope: Pure bootstrap config; no timers, network, DB, or CLOB calls.
 * Links: work/items/task.5005
 */

import { describe, expect, it } from "vitest";

import {
  buildMirrorTargetConfig,
  sizingPolicyKindForTargetWallet,
} from "@/bootstrap/jobs/copy-trade-mirror.job";

const BILLING_ACCOUNT_ID = "00000000-0000-4000-b000-000000000000";
const CREATED_BY_USER_ID = "00000000-0000-4000-a000-000000000001";
const RN1 = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" as const;
const SWISSTONY = "0x204f72f35326db932158cba6adff0b9a1da95e14" as const;
const UNKNOWN = "0x1234567890abcdef1234567890abcdef12345678" as const;

function build(targetWallet: `0x${string}`) {
  return buildMirrorTargetConfig({
    targetWallet,
    billingAccountId: BILLING_ACCOUNT_ID,
    createdByUserId: CREATED_BY_USER_ID,
  });
}

describe("buildMirrorTargetConfig() — sizing policy selection", () => {
  it("uses scaled target-percentile sizing for RN1", () => {
    const config = build(RN1);
    expect(sizingPolicyKindForTargetWallet(RN1)).toBe(
      "target_percentile_scaled"
    );
    expect(config.sizing).toMatchObject({
      kind: "target_percentile_scaled",
      max_usdc_per_trade: 5,
      statistic: {
        wallet: RN1,
        label: "RN1",
        percentile: 75,
        min_target_usdc: 117.65,
        max_target_usdc: 2660.08,
      },
    });
  });

  it("matches curated wallets case-insensitively", () => {
    const config = build("0x2005D16A84CEEFA912D4E380CD32E7FF827875EA");
    expect(config.sizing.kind).toBe("target_percentile_scaled");
  });

  it("uses scaled target-percentile sizing for swisstony", () => {
    const config = build(SWISSTONY);
    expect(config.sizing).toMatchObject({
      kind: "target_percentile_scaled",
      max_usdc_per_trade: 5,
      statistic: {
        wallet: SWISSTONY,
        label: "swisstony",
        percentile: 75,
        min_target_usdc: 114.57,
        max_target_usdc: 4811.89,
      },
    });
  });

  it("hydrates per-target slider fields into the policy", () => {
    const config = buildMirrorTargetConfig({
      targetWallet: SWISSTONY,
      billingAccountId: BILLING_ACCOUNT_ID,
      createdByUserId: CREATED_BY_USER_ID,
      mirrorFilterPercentile: 90,
      mirrorMaxUsdcPerTrade: 12,
    });
    expect(config.sizing).toMatchObject({
      kind: "target_percentile_scaled",
      max_usdc_per_trade: 12,
      statistic: {
        percentile: 90,
        min_target_usdc: 321.62,
      },
    });
  });

  it("keeps min_bet sizing for uncurated wallets", () => {
    const config = build(UNKNOWN);
    expect(sizingPolicyKindForTargetWallet(UNKNOWN)).toBe("min_bet");
    expect(config.sizing).toEqual({
      kind: "min_bet",
      max_usdc_per_trade: 5,
    });
  });
});
