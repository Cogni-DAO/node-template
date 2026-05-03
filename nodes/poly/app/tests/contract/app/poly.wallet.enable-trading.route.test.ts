// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/contract/app/poly.wallet.enable-trading.route`
 * Purpose: Verify enable-trading maps preflight failures to distinct HTTP
 *   responses and emits a terminal feature event with a stable errorCode.
 * Scope: Route-only with mocked bootstrap deps. Does not hit Privy, Polygon,
 *   or Polymarket.
 * Invariants: TENANT_SCOPED; OBSERVABLE_PREFLIGHT_FAILURES.
 * Side-effects: none
 * Links: src/app/api/v1/poly/wallet/enable-trading/route.ts
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT = { id: "billing-account-1" };
const ADDRESS = "0x1111111111111111111111111111111111111111";

const mockGetPolyTraderWalletAdapter = vi.fn();
const mockAccountsForUser = vi.fn();
const mockGetOrCreateBillingAccountForUser = vi.fn();
const mockEnsureTradingApprovals = vi.fn();
const logInfo = vi.fn();
const logError = vi.fn();

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (_config: unknown, handler: (...args: unknown[]) => unknown) =>
    async (request: Request) =>
      handler(
        {
          reqId: "req-enable-trading-test",
          routeId: "poly.wallet.enable_trading",
          log: {
            info: logInfo,
            warn: vi.fn(),
            error: logError,
            debug: vi.fn(),
            child: vi.fn().mockReturnThis(),
          },
        },
        request,
        SESSION_USER
      ),
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    accountsForUser: mockAccountsForUser,
  })),
}));

vi.mock("@/bootstrap/poly-trader-wallet", () => ({
  getPolyTraderWalletAdapter: mockGetPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError: class WalletAdapterUnconfiguredError extends Error {},
}));

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/poly/wallet/enable-trading", {
    method: "POST",
  });
}

describe("poly wallet enable-trading route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAccountsForUser.mockReturnValue({
      getOrCreateBillingAccountForUser: mockGetOrCreateBillingAccountForUser,
    });
    mockGetOrCreateBillingAccountForUser.mockResolvedValue(ACCOUNT);
    mockGetPolyTraderWalletAdapter.mockReturnValue({
      ensureTradingApprovals: mockEnsureTradingApprovals,
    });
    mockEnsureTradingApprovals.mockResolvedValue({
      ready: true,
      address: ADDRESS,
      polBalance: 1,
      readyAt: new Date("2026-05-03T21:30:00.000Z"),
      steps: [],
    });
  });

  it("logs and returns a distinct response for a missing active connection", async () => {
    mockEnsureTradingApprovals.mockRejectedValueOnce(
      Object.assign(new Error("missing connection"), { code: "no_connection" })
    );

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/enable-trading/route"
    );
    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "no_active_wallet_connection",
      reason: "no_connection",
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "feature.poly_wallet_enable_trading.complete",
        reqId: "req-enable-trading-test",
        routeId: "poly.wallet.enable_trading",
        status: 409,
        outcome: "error",
        errorCode: "no_connection",
        billing_account_id: ACCOUNT.id,
      }),
      "feature.poly_wallet_enable_trading.complete"
    );
  });

  it("does not collapse invalid encrypted CLOB creds into no_active_wallet_connection", async () => {
    mockEnsureTradingApprovals.mockRejectedValueOnce(
      Object.assign(new Error("invalid encrypted creds"), {
        code: "clob_creds_invalid",
      })
    );

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/enable-trading/route"
    );
    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "wallet_signing_context_unavailable",
      reason: "clob_creds_invalid",
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "feature.poly_wallet_enable_trading.complete",
        reqId: "req-enable-trading-test",
        routeId: "poly.wallet.enable_trading",
        status: 500,
        outcome: "error",
        errorCode: "clob_creds_invalid",
        billing_account_id: ACCOUNT.id,
      }),
      "feature.poly_wallet_enable_trading.complete"
    );
  });
});
