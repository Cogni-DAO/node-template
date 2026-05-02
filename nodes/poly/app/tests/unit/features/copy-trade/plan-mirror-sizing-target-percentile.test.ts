// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/plan-mirror-sizing-target-percentile`
 * Purpose: Cover conviction-aware target-percentile sizing: filter low target
 * fills, mirror accepted fills at min bet, and keep market floors
 * authoritative.
 * Scope: Pure function; no I/O. Exercises `config.sizing.kind ===
 * "target_percentile"` with a wallet-stat snapshot.
 * Invariants: PLANNER_IS_PURE, MIRROR_REASON_BOUNDED, CAPS_LIVE_IN_GRANT.
 * Side-effects: none
 * Links: work/items/task.5005
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import { planMirrorFromFill } from "@/features/copy-trade/plan-mirror";
import type {
  MirrorTargetConfig,
  RuntimeState,
} from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_WALLET = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" as const;

const CLEAN_STATE: RuntimeState = {
  already_placed_ids: [],
};

const CONFIG: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: "00000000-0000-4000-b000-000000000000",
  created_by_user_id: "00000000-0000-4000-a000-000000000001",
  mode: "live",
  sizing: {
    kind: "target_percentile",
    max_usdc_per_trade: 5,
    statistic: {
      wallet: TARGET_WALLET,
      label: "RN1",
      captured_at: "2026-05-02T00:49:15Z",
      sample_size: 1000,
      percentile: 75,
      min_target_usdc: 64.11,
    },
  },
  placement: { kind: "mirror_limit" },
};

function makeFill(size_usdc: number, price = 0.5): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id: `data-api:0xtx:0xasset:BUY:${Math.floor(size_usdc * 1000)}`,
    source: "data-api",
    market_id: "prediction-market:polymarket:0xcondition",
    outcome: "YES",
    side: "BUY",
    price,
    size_usdc,
    observed_at: "2026-05-02T00:00:00.000Z",
    attributes: { asset: "0xasset", condition_id: "0xcondition" },
  };
}

describe("planMirrorFromFill() — sizing policy: kind=target_percentile", () => {
  it("skips low-conviction fills below the configured wallet percentile", () => {
    const fill = makeFill(64.1);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "below_target_percentile" });
  });

  it("mirrors accepted fills at min bet, not relative target size", () => {
    const fill = makeFill(888.12);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(1);
  });

  it("accepts fills exactly at the configured wallet percentile threshold", () => {
    const fill = makeFill(64.11);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(1);
  });

  it("raises accepted fills to the share-space market floor before placement", () => {
    const fill = makeFill(70, 0.9);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(4.5);
  });

  it("skips below_market_min when the market floor exceeds the hard ceiling", () => {
    const fill = makeFill(70, 0.99);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 6,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "below_market_min" });
  });
});
