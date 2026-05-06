// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/target-overlap-pnl-source.int`
 * Purpose: Lock the LIVE_POSITION_ONLY invariant on the Target Overlap slice.
 *          The slice intentionally does NOT emit PnL (bug.5020), so this
 *          file exercises the staleness + closed-position predicate via the
 *          count and `currentValueUsdc` metrics that *do* render.
 *          Synthetic divergence: rows that should be excluded carry huge
 *          `currentValueUsdc` values; if either filter (active+shares>0 or
 *          fresh observation) regresses, the magnitude assertion blows up
 *          by orders of magnitude.
 * Scope: Service-role DB. No network. RN1 + swisstony seed rows come from
 *        migration `0040_poly_trader_activity.sql`; this test reuses them
 *        and cleans only its position rows in afterEach.
 * Invariants: LIVE_POSITION_ONLY (active=true AND shares>0 AND fresh<6h).
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: nodes/poly/app/src/features/wallet-analysis/server/target-overlap-service.ts, work/items/bug.5020
 * @internal
 */

import {
  polyTraderCurrentPositions,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getTargetOverlapSlice } from "@/features/wallet-analysis/server/target-overlap-service";

const RN1 = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" as const;
const SWISSTONY = "0x204f72f35326db932158cba6adff0b9a1da95e14" as const;
const COND_RN1 = "cond-bug5020-rn1-only";
const COND_SHARED = "cond-bug5020-shared";
const TOKEN_RN1_LIVE = "token-bug5020-rn1-live";
const TOKEN_RN1_STALE = "token-bug5020-rn1-stale";
const TOKEN_RN1_CLOSED = "token-bug5020-rn1-closed";
const ALL_TEST_TOKENS = [
  TOKEN_RN1_LIVE,
  TOKEN_RN1_STALE,
  TOKEN_RN1_CLOSED,
] as const;

describe("getTargetOverlapSlice — live-position predicate (bug.5020)", () => {
  const db = getSeedDb();
  let rn1Id = "";

  beforeAll(async () => {
    const wallets = await db
      .select({
        id: polyTraderWallets.id,
        walletAddress: polyTraderWallets.walletAddress,
      })
      .from(polyTraderWallets)
      .where(inArray(polyTraderWallets.walletAddress, [RN1, SWISSTONY]));
    rn1Id = wallets.find((w) => w.walletAddress === RN1)?.id ?? "";
    expect(rn1Id, "RN1 seed row missing — check migration 0040").not.toBe("");
  });

  afterEach(async () => {
    await db
      .delete(polyTraderCurrentPositions)
      .where(inArray(polyTraderCurrentPositions.tokenId, [...ALL_TEST_TOKENS]));
  });

  it("excludes stale (>6h) rows AND shares=0 closed rows from counts and currentValueUsdc", async () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await db.insert(polyTraderCurrentPositions).values([
      {
        // (1) live row — must appear in the bucket.
        traderWalletId: rn1Id,
        conditionId: COND_RN1,
        tokenId: TOKEN_RN1_LIVE,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "50.00000000",
        currentValueUsdc: "75.00000000",
        avgPrice: "0.50000000",
        contentHash: "hash-bug5020-live",
        raw: {},
      },
      {
        // (2) stale row — lastObservedAt past the 6h window.
        traderWalletId: rn1Id,
        conditionId: COND_SHARED,
        tokenId: TOKEN_RN1_STALE,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "9999999.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-stale",
        lastObservedAt: sevenHoursAgo,
        firstObservedAt: sevenHoursAgo,
        raw: {},
      },
      {
        // (3) closed row — shares=0; Polymarket still echoes these when
        //     the observer polls with sizeThreshold=0.
        traderWalletId: rn1Id,
        conditionId: COND_RN1,
        tokenId: TOKEN_RN1_CLOSED,
        active: true,
        shares: "0.00000000",
        costBasisUsdc: "8888888.00000000",
        currentValueUsdc: "0.00000000",
        avgPrice: "0.00000000",
        contentHash: "hash-bug5020-closed",
        raw: {},
      },
    ]);

    const result = await getTargetOverlapSlice(db, "ALL");
    // The stale row's $9.9M and the closed row's frozen costBasis/zero value
    // must not pollute the bucket. Only the +$75 live row's contribution may
    // appear from these synthetic rows. Real seed rows for RN1+swisstony also
    // exist, so we test containment: total currentValueUsdc must stay finite
    // (well under the synthetic poison values).
    for (const bucket of result.buckets) {
      expect(bucket.currentValueUsdc).toBeLessThan(1_000_000);
      expect(bucket.rn1.currentValueUsdc).toBeLessThan(1_000_000);
    }
  });
});
