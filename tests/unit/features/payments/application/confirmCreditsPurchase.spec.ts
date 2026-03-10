// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/payments/application/confirmCreditsPurchase`
 * Purpose: Verifies the application orchestrator composes credit confirmation with treasury settlement correctly.
 * Scope: Covers orchestration logic: delegation to creditsConfirm, treasury settlement on success, skip on idempotent replay, graceful degradation on settlement failure; does not test creditsConfirm internals or adapter implementations.
 * Invariants: Credit confirmation always succeeds independently of settlement; settlement skipped when creditsApplied=0.
 * Side-effects: none
 * Links: src/features/payments/application/confirmCreditsPurchase.ts
 * @public
 */

import { createMockAccountService } from "@tests/_fakes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmCreditsPurchase } from "@/features/payments/application/confirmCreditsPurchase";
import { confirmCreditsPayment } from "@/features/payments/services/creditsConfirm";
import type { ServiceAccountService, TreasurySettlementPort } from "@/ports";

vi.mock("@/features/payments/services/creditsConfirm", () => ({
  confirmCreditsPayment: vi.fn(),
}));

vi.mock("@/shared/env", () => ({
  serverEnv: () => ({ SYSTEM_TENANT_REVENUE_SHARE: 0.75 }),
}));

const mockConfirmCreditsPayment = vi.mocked(confirmCreditsPayment);

function createMockServiceAccountService(): ServiceAccountService {
  return {
    getBillingAccountById: vi.fn(),
    getOrCreateBillingAccountForUser: vi.fn(),
    creditAccount: vi.fn().mockResolvedValue({ newBalance: 0 }),
    findCreditLedgerEntryByReference: vi.fn().mockResolvedValue(null),
  };
}

function createMockTreasurySettlement(): TreasurySettlementPort & {
  settleConfirmedCreditPurchase: ReturnType<typeof vi.fn>;
} {
  return {
    settleConfirmedCreditPurchase: vi
      .fn()
      .mockResolvedValue({ txHash: "0xfake-settlement-tx" }),
  };
}

describe("features/payments/application/confirmCreditsPurchase", () => {
  const input = {
    billingAccountId: "billing-123",
    defaultVirtualKeyId: "vk-123",
    amountUsdCents: 1000,
    clientPaymentId: "payment-1",
  };

  let accountService: ReturnType<typeof createMockAccountService>;
  let serviceAccountService: ServiceAccountService;

  beforeEach(() => {
    vi.clearAllMocks();
    accountService = createMockAccountService();
    serviceAccountService = createMockServiceAccountService();

    mockConfirmCreditsPayment.mockResolvedValue({
      billingAccountId: "billing-123",
      balanceCredits: 100_000_000,
      creditsApplied: 100_000_000,
    });
  });

  it("confirms credits and settles treasury on success", async () => {
    const treasury = createMockTreasurySettlement();

    const result = await confirmCreditsPurchase(
      accountService,
      serviceAccountService,
      treasury,
      input
    );

    expect(mockConfirmCreditsPayment).toHaveBeenCalledWith(
      accountService,
      serviceAccountService,
      input
    );

    expect(treasury.settleConfirmedCreditPurchase).toHaveBeenCalledWith({
      paymentIntentId: "payment-1",
    });

    expect(result).toEqual({
      billingAccountId: "billing-123",
      balanceCredits: 100_000_000,
      creditsApplied: 100_000_000,
      settlement: { txHash: "0xfake-settlement-tx" },
    });
  });

  it("confirms credits without settlement when treasury port is undefined", async () => {
    const result = await confirmCreditsPurchase(
      accountService,
      serviceAccountService,
      undefined,
      input
    );

    expect(mockConfirmCreditsPayment).toHaveBeenCalled();
    expect(result.settlement).toBeUndefined();
    expect(result.settlementError).toBeUndefined();
    expect(result.creditsApplied).toBe(100_000_000);
  });

  it("returns settlementError when treasury settlement fails", async () => {
    const treasury = createMockTreasurySettlement();
    const settlementErr = new Error("rpc timeout");
    treasury.settleConfirmedCreditPurchase.mockRejectedValue(settlementErr);

    const result = await confirmCreditsPurchase(
      accountService,
      serviceAccountService,
      treasury,
      input
    );

    // Credits still confirmed
    expect(result.billingAccountId).toBe("billing-123");
    expect(result.creditsApplied).toBe(100_000_000);
    // Settlement error surfaced for caller to log
    expect(result.settlementError).toBe(settlementErr);
    expect(result.settlement).toBeUndefined();
  });

  it("skips settlement on idempotent replay (creditsApplied=0)", async () => {
    const treasury = createMockTreasurySettlement();

    mockConfirmCreditsPayment.mockResolvedValue({
      billingAccountId: "billing-123",
      balanceCredits: 100_000_000,
      creditsApplied: 0,
    });

    const result = await confirmCreditsPurchase(
      accountService,
      serviceAccountService,
      treasury,
      input
    );

    expect(treasury.settleConfirmedCreditPurchase).not.toHaveBeenCalled();
    expect(result.creditsApplied).toBe(0);
    expect(result.settlement).toBeUndefined();
  });
});
