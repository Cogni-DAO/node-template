// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/payments/resmic-confirm.stack`
 * Purpose: Full-stack verification of Resmic confirm endpoint idempotency and balance updates.
 * Scope: Uses SIWE session to call /api/v1/payments/resmic/confirm and summary endpoints over HTTP; does not mock adapters or bypass API layer.
 * Invariants: 1 cent = 10 credits; duplicate clientPaymentId does not double credit balance.
 * Side-effects: IO (writes to billing tables via API calls).
 * Notes: Requires running stack with Auth.js + Postgres.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { randomUUID } from "node:crypto";

import { siweLogin } from "@tests/_fixtures/auth/authjs-http-helpers";
import { generateTestWallet } from "@tests/_fixtures/auth/siwe-helpers";
import { describe, expect, it } from "vitest";

function baseUrl(path = ""): string {
  const root = process.env.TEST_BASE_URL ?? "http://localhost:3000";
  return path ? new URL(path.replace(/^\//, ""), root).toString() : root;
}

async function getSummary(cookie: string): Promise<{
  billingAccountId: string;
  balanceCredits: number;
  ledger: { amount: number; reason: string; reference: string | null }[];
}> {
  const response = await fetch(baseUrl("/api/v1/payments/resmic/summary"), {
    headers: { Cookie: cookie },
  });

  expect(response.ok).toBe(true);
  return (await response.json()) as Awaited<ReturnType<typeof getSummary>>;
}

describe("Resmic confirm endpoint", () => {
  it("credits balance on first confirm call", async () => {
    const wallet = generateTestWallet("resmic-confirm-happy-path");
    const domain = new URL(baseUrl()).host;
    const login = await siweLogin({
      baseUrl: baseUrl(),
      wallet,
      domain,
      chainId: 11155111,
    });

    expect(login.success).toBe(true);
    expect(login.sessionCookie).toBeTruthy();

    const sessionCookie = `${login.sessionCookie?.name}=${login.sessionCookie?.value}`;
    const clientPaymentId = randomUUID();

    const response = await fetch(baseUrl("/api/v1/payments/resmic/confirm"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        amountUsdCents: 1000,
        clientPaymentId,
        metadata: { test: true },
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as { balanceCredits: number };
    expect(body.balanceCredits).toBe(1000 * 10);

    const summary = await getSummary(sessionCookie);
    expect(summary.balanceCredits).toBe(body.balanceCredits);
    expect(summary.ledger[0]?.reference).toBe(clientPaymentId);
  });

  it("is idempotent for duplicate clientPaymentId", async () => {
    const wallet = generateTestWallet("resmic-confirm-idempotent");
    const domain = new URL(baseUrl()).host;
    const login = await siweLogin({
      baseUrl: baseUrl(),
      wallet,
      domain,
      chainId: 11155111,
    });

    expect(login.success).toBe(true);
    expect(login.sessionCookie).toBeTruthy();

    const sessionCookie = `${login.sessionCookie?.name}=${login.sessionCookie?.value}`;
    const clientPaymentId = randomUUID();

    const first = await fetch(baseUrl("/api/v1/payments/resmic/confirm"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        amountUsdCents: 500,
        clientPaymentId,
      }),
    });
    expect(first.ok).toBe(true);
    const firstBody = (await first.json()) as { balanceCredits: number };

    const second = await fetch(baseUrl("/api/v1/payments/resmic/confirm"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        amountUsdCents: 500,
        clientPaymentId,
      }),
    });
    expect(second.ok).toBe(true);
    const secondBody = (await second.json()) as { balanceCredits: number };

    expect(secondBody.balanceCredits).toBe(firstBody.balanceCredits);

    const summary = await getSummary(sessionCookie);
    expect(
      summary.ledger.filter((entry) => entry.reference === clientPaymentId)
        .length
    ).toBe(1);
  });
});
