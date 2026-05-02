// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/target-source`
 * Purpose: Verifies the `envTargetSource` impl of `CopyTradeTargetSource` —
 *          the local-dev/test fallback for the production `dbTargetSource`.
 *          DB-backed coverage lives in component tests against testcontainers.
 * Scope: Unit. No DB, no HTTP. Just the port impl.
 * @public
 */

import type { ActorId } from "@cogni/ids";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import { describe, expect, it } from "vitest";
import { targetIdFromWallet } from "@/features/copy-trade/target-id";
import {
  envTargetSource,
  type UserTargetRow,
  type WalletAddress,
} from "@/features/copy-trade/target-source";

const W1 = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb" as WalletAddress;
const W2 = "0xCCCCddddCCCCddddCCCCddddCCCCddddCCCCdddd" as WalletAddress;
const ANY_ACTOR = "00000000-0000-4000-a000-000000000001" as unknown as ActorId;

describe("envTargetSource", () => {
  it("listForActor returns empty list for empty input", async () => {
    const src = envTargetSource([]);
    await expect(src.listForActor(ANY_ACTOR)).resolves.toEqual([]);
  });

  it("listForActor preserves caller order and synthesizes stable per-wallet ids", async () => {
    const src = envTargetSource([W1, W2]);
    await expect(src.listForActor(ANY_ACTOR)).resolves.toEqual([
      {
        id: targetIdFromWallet(W1),
        targetWallet: W1,
        mirrorFilterPercentile: 75,
        mirrorMaxUsdcPerTrade: 5,
      },
      {
        id: targetIdFromWallet(W2),
        targetWallet: W2,
        mirrorFilterPercentile: 75,
        mirrorMaxUsdcPerTrade: 5,
      },
    ]);
  });

  it("listForActor result is frozen — push throws", async () => {
    const src = envTargetSource([W1, W2]);
    const first = (await src.listForActor(ANY_ACTOR)) as UserTargetRow[];
    expect(() =>
      first.push({
        id: "x",
        targetWallet: W1,
        mirrorFilterPercentile: 75,
        mirrorMaxUsdcPerTrade: 5,
      })
    ).toThrow();
    const second = await src.listForActor(ANY_ACTOR);
    expect(second).toHaveLength(2);
  });

  it("listAllActive attributes every wallet to the system tenant", async () => {
    const src = envTargetSource([W1, W2]);
    const enumerated = await src.listAllActive();
    expect(enumerated).toEqual([
      {
        billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
        createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
        targetWallet: W1,
        mirrorFilterPercentile: 75,
        mirrorMaxUsdcPerTrade: 5,
      },
      {
        billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
        createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
        targetWallet: W2,
        mirrorFilterPercentile: 75,
        mirrorMaxUsdcPerTrade: 5,
      },
    ]);
  });
});
