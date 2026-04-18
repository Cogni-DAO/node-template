// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-watch/polymarket-source.test`
 * Purpose: Unit tests for `createPolymarketActivitySource`. Validates cursor advance, empty-tx rejection + counter, fill-shape correctness, and skip bucketing.
 * Scope: Mocked `PolymarketDataApiClient` — no network. Uses real `createRecordingMetrics` + `noopLogger` from `@cogni/market-provider`.
 * Invariants: CURSOR_IS_MAX_TIMESTAMP; DA_EMPTY_HASH_REJECTED; WALLET_WATCH_IS_GENERIC.
 * Side-effects: none
 * Links: src/features/wallet-watch/polymarket-source.ts
 * @internal
 */

import {
  createRecordingMetrics,
  noopLogger,
} from "@cogni/market-provider";
import type {
  PolymarketDataApiClient,
  PolymarketUserTrade,
} from "@cogni/market-provider/adapters/polymarket";
import { describe, expect, it } from "vitest";

import {
  createPolymarketActivitySource,
  WALLET_WATCH_METRICS,
} from "@/features/wallet-watch/polymarket-source";

const TARGET_WALLET =
  "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;

/** Minimal stub of the Data-API client — only the methods the source calls. */
function makeStubClient(
  trades: PolymarketUserTrade[]
): PolymarketDataApiClient {
  return {
    async listUserActivity() {
      return trades;
    },
  } as unknown as PolymarketDataApiClient;
}

function makeTrade(
  overrides: Partial<PolymarketUserTrade> & { timestamp: number }
): PolymarketUserTrade {
  return {
    proxyWallet: TARGET_WALLET,
    side: "BUY",
    asset: "12345",
    conditionId:
      "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
    size: 10,
    price: 0.5,
    timestamp: overrides.timestamp,
    title: "Some market",
    outcome: "YES",
    transactionHash: "0xdeadbeef",
    ...overrides,
  };
}

describe("createPolymarketActivitySource.fetchSince", () => {
  it("normalizes a valid Data-API trade into a Fill with the canonical fill_id", async () => {
    const trade = makeTrade({ timestamp: 1_713_302_400 });
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([trade]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });

    const { fills, newSince } = await source.fetchSince();
    expect(fills).toHaveLength(1);
    const fill = fills[0];
    expect(fill?.source).toBe("data-api");
    expect(fill?.fill_id).toBe(
      `data-api:${trade.transactionHash}:${trade.asset}:${trade.side}:${trade.timestamp}`
    );
    expect(fill?.target_wallet).toBe(TARGET_WALLET);
    expect(fill?.market_id).toBe(
      `prediction-market:polymarket:${trade.conditionId}`
    );
    // notional = size * price
    expect(fill?.size_usdc).toBeCloseTo(5, 6);
    expect(newSince).toBe(trade.timestamp);
  });

  it("rejects empty-transactionHash rows and increments skip counter", async () => {
    const badTrade = makeTrade({
      timestamp: 1_713_302_401,
      transactionHash: "",
    });
    const goodTrade = makeTrade({ timestamp: 1_713_302_402 });
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([badTrade, goodTrade]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });

    const { fills, newSince } = await source.fetchSince();
    expect(fills).toHaveLength(1);
    expect(fills[0]?.fill_id).toContain(goodTrade.transactionHash);
    // newSince includes the skipped row's timestamp — rejection is about
    // de-duping, not about ignoring cursor advance.
    expect(newSince).toBe(1_713_302_402);

    const skipCounter = metrics.emissions.find(
      (c) =>
        c.kind === "counter" &&
        c.name === WALLET_WATCH_METRICS.skipTotal &&
        c.labels.reason === "empty_transaction_hash"
    );
    expect(skipCounter).toBeDefined();
  });

  it("advances newSince to max(trade.timestamp) across the page", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([
        makeTrade({ timestamp: 100 }),
        makeTrade({ timestamp: 300 }),
        makeTrade({ timestamp: 200 }),
      ]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    const { newSince } = await source.fetchSince(50);
    expect(newSince).toBe(300);
  });

  it("returns the input since when the page is empty", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    const { fills, newSince } = await source.fetchSince(42);
    expect(fills).toHaveLength(0);
    expect(newSince).toBe(42);
  });

  it("buckets skip reasons with bounded labels", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([
        makeTrade({ timestamp: 1, transactionHash: "" }),
        makeTrade({ timestamp: 2, price: 0 }),
        makeTrade({ timestamp: 3, size: 0 }),
      ]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    await source.fetchSince();
    const reasons = metrics.emissions
      .filter(
        (c) =>
          c.kind === "counter" && c.name === WALLET_WATCH_METRICS.skipTotal
      )
      .map((c) => c.labels.reason);
    expect(reasons).toContain("empty_transaction_hash");
    expect(reasons).toContain("non_positive_price");
    expect(reasons).toContain("non_positive_size");
  });
});
