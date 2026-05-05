// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/trading-wallet-pnl-history.int`
 * Purpose: Component coverage for the DB-backed user-pnl read model (task.5012).
 *          Validates writer two-fidelity ingest, idempotent upsert on re-poll,
 *          reader fidelity selection per interval, retention prune of `1h` rows,
 *          and the cold-start path (zero rows → empty read).
 * Scope: Service-role DB + stub user-pnl client. No network.
 * Invariants: PAGE_LOAD_DB_ONLY, FIDELITY_PLAN, DEDUPE_BY_TS, RETENTION_BOUNDED.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/trading-wallet-overview-service.ts, work/items/task.5012
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyTraderUserPnlPoints,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import type {
  PolymarketUserPnlClient,
  PolymarketUserPnlPoint,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchAndPersistTradingWalletPnlHistory,
  getTradingWalletPnlHistory,
  pruneOldTradingWalletPnlPoints,
} from "@/features/wallet-analysis/server/trading-wallet-overview-service";

const WALLET = "0x5012000000000000000000000000000000005012" as const;

type FakePnlPoints = {
  "1h": PolymarketUserPnlPoint[];
  "1d": PolymarketUserPnlPoint[];
};

function makeUserPnlClient(points: FakePnlPoints): PolymarketUserPnlClient {
  return {
    async getUserPnl(_wallet, params) {
      return params.fidelity === "1h" ? [...points["1h"]] : [...points["1d"]];
    },
  } as unknown as PolymarketUserPnlClient;
}

async function seedWallet(db: ReturnType<typeof getSeedDb>): Promise<string> {
  const walletId = randomUUID();
  await db.insert(polyTraderWallets).values({
    id: walletId,
    walletAddress: WALLET,
    kind: "copy_target",
    label: "task-5012-test-target",
    activeForResearch: true,
  });
  return walletId;
}

describe("trading-wallet user-pnl history (component)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, WALLET));
  });

  it("cold-start: empty DB returns []", async () => {
    await seedWallet(db);
    const history = await getTradingWalletPnlHistory({
      db,
      address: WALLET,
      interval: "1W",
    });
    expect(history).toEqual([]);
  });

  it("writer ingests both fidelities; reader picks `1h` for 1W and `1d` for ALL", async () => {
    const walletId = await seedWallet(db);
    const now = Date.UTC(2026, 4, 4, 0, 0, 0) / 1_000;
    const oneHour = 3_600;
    const oneDay = 86_400;
    const points: FakePnlPoints = {
      "1h": Array.from({ length: 24 }).map((_, i) => ({
        t: now - (24 - i) * oneHour,
        p: 1 + i * 0.1,
      })),
      "1d": Array.from({ length: 5 }).map((_, i) => ({
        t: now - (5 - i) * oneDay,
        p: 100 + i,
      })),
    };

    const result = await fetchAndPersistTradingWalletPnlHistory({
      db,
      traderWalletId: walletId,
      walletAddress: WALLET,
      client: makeUserPnlClient(points),
    });
    expect(result.inserted).toBe(29);
    expect(result.fidelities).toEqual(["1h", "1d"]);

    const oneWeek = await getTradingWalletPnlHistory({
      db,
      address: WALLET,
      interval: "1W",
      capturedAt: new Date(now * 1_000).toISOString(),
    });
    // 1W → 1h fidelity, 24 points (last day) all within 7-day window.
    expect(oneWeek.length).toBe(24);

    const all = await getTradingWalletPnlHistory({
      db,
      address: WALLET,
      interval: "ALL",
      capturedAt: new Date(now * 1_000).toISOString(),
    });
    // ALL → 1d fidelity, 5 points.
    expect(all.length).toBe(5);
    expect(all[0]?.pnl).toBe(100);
    expect(all[4]?.pnl).toBe(104);
  });

  it("re-poll is idempotent (DEDUPE_BY_TS): no duplicate rows on rerun", async () => {
    const walletId = await seedWallet(db);
    const now = Date.UTC(2026, 4, 4, 0, 0, 0) / 1_000;
    const points: FakePnlPoints = {
      "1h": [
        { t: now - 7_200, p: 1 },
        { t: now - 3_600, p: 2 },
      ],
      "1d": [{ t: now - 86_400, p: 50 }],
    };

    await fetchAndPersistTradingWalletPnlHistory({
      db,
      traderWalletId: walletId,
      walletAddress: WALLET,
      client: makeUserPnlClient(points),
    });
    // Same poll twice — pnlUsdc bumped to a new value to verify upsert.
    const points2: FakePnlPoints = {
      "1h": [
        { t: now - 7_200, p: 11 },
        { t: now - 3_600, p: 22 },
      ],
      "1d": [{ t: now - 86_400, p: 55 }],
    };
    await fetchAndPersistTradingWalletPnlHistory({
      db,
      traderWalletId: walletId,
      walletAddress: WALLET,
      client: makeUserPnlClient(points2),
    });

    const stored = await db
      .select()
      .from(polyTraderUserPnlPoints)
      .where(eq(polyTraderUserPnlPoints.traderWalletId, walletId));
    expect(stored.length).toBe(3);
    const hourly = stored.filter((row) => row.fidelity === "1h");
    expect(hourly.length).toBe(2);
    // pnlUsdc was upserted to the second poll's value.
    expect(hourly.map((row) => Number(row.pnlUsdc)).sort()).toEqual([11, 22]);
  });

  it("retention prune drops `1h` rows past the 35-day cutoff but keeps `1d`", async () => {
    const walletId = await seedWallet(db);
    const now = new Date();
    const old = new Date(now.getTime() - 40 * 86_400_000);
    const recent = new Date(now.getTime() - 1 * 86_400_000);

    await db.insert(polyTraderUserPnlPoints).values([
      {
        traderWalletId: walletId,
        fidelity: "1h",
        ts: old,
        pnlUsdc: "1.00000000",
      },
      {
        traderWalletId: walletId,
        fidelity: "1h",
        ts: recent,
        pnlUsdc: "2.00000000",
      },
      {
        traderWalletId: walletId,
        fidelity: "1d",
        ts: old,
        pnlUsdc: "3.00000000",
      },
    ]);

    await pruneOldTradingWalletPnlPoints(db);

    const remaining = await db
      .select()
      .from(polyTraderUserPnlPoints)
      .where(eq(polyTraderUserPnlPoints.traderWalletId, walletId));
    expect(remaining.length).toBe(2);
    // The old `1h` row is gone; the recent `1h` and the old `1d` survive.
    expect(
      remaining.find((r) => r.fidelity === "1h" && Number(r.pnlUsdc) === 1)
    ).toBeUndefined();
    expect(
      remaining.find((r) => r.fidelity === "1d" && Number(r.pnlUsdc) === 3)
    ).toBeDefined();
  });

  it("PAGE_LOAD_DB_ONLY: reader does not call the user-pnl client", async () => {
    const walletId = await seedWallet(db);
    await db.insert(polyTraderUserPnlPoints).values({
      traderWalletId: walletId,
      fidelity: "1d",
      ts: new Date("2026-04-01T00:00:00.000Z"),
      pnlUsdc: "42.00000000",
    });
    let called = false;
    const sentinelClient = {
      async getUserPnl() {
        called = true;
        return [];
      },
    } as unknown as PolymarketUserPnlClient;

    // The reader does not accept a client by design — wire one anyway via the
    // module-level test setter to prove it is never invoked.
    const { __setTradingWalletOverviewUserPnlClientForTests } = await import(
      "@/features/wallet-analysis/server/trading-wallet-overview-service"
    );
    __setTradingWalletOverviewUserPnlClientForTests(sentinelClient);
    try {
      const history = await getTradingWalletPnlHistory({
        db,
        address: WALLET,
        interval: "ALL",
        capturedAt: "2026-05-04T00:00:00.000Z",
      });
      expect(history.length).toBe(1);
      expect(history[0]?.pnl).toBe(42);
    } finally {
      __setTradingWalletOverviewUserPnlClientForTests(undefined);
    }
    expect(called).toBe(false);
  });

  it("address normalization: lookup is case-insensitive (lowercases input)", async () => {
    const walletId = await seedWallet(db);
    await db.insert(polyTraderUserPnlPoints).values({
      traderWalletId: walletId,
      fidelity: "1d",
      ts: new Date("2026-04-01T00:00:00.000Z"),
      pnlUsdc: "7.50000000",
    });
    const upper = `0x${WALLET.slice(2).toUpperCase()}` as `0x${string}`;
    const history = await getTradingWalletPnlHistory({
      db,
      address: upper,
      interval: "ALL",
      capturedAt: "2026-05-04T00:00:00.000Z",
    });
    expect(history.length).toBe(1);
  });
});
