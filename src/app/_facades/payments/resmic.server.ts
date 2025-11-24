// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/payments/resmic.server`
 * Purpose: App-layer wiring for Resmic payments. Resolves dependencies and delegates to feature services.
 * Scope: Server-only facade. Handles billing account resolution from session user and maps to feature inputs; does not perform direct persistence or HTTP handling.
 * Invariants: Billing account comes exclusively from session identity; no body-provided account identifiers.
 * Side-effects: IO (via AccountService port).
 * Notes: Errors bubble to route handlers for HTTP mapping.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { createContainer } from "@/bootstrap/container";
import { confirmResmicPayment } from "@/features/payments/services/resmicConfirm";
import { getResmicSummary } from "@/features/payments/services/resmicSummary";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import type { SessionUser } from "@/shared/auth";

export async function confirmResmicPaymentFacade(params: {
  sessionUser: SessionUser;
  amountUsdCents: number;
  clientPaymentId: string;
  metadata?: Record<string, unknown> | undefined;
}): Promise<{ billingAccountId: string; balanceCredits: number }> {
  const { accountService } = createContainer();

  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    {
      userId: params.sessionUser.id,
      walletAddress: params.sessionUser.walletAddress,
    }
  );

  const result = await confirmResmicPayment(accountService, {
    billingAccountId: billingAccount.id,
    defaultVirtualKeyId: billingAccount.defaultVirtualKeyId,
    amountUsdCents: params.amountUsdCents,
    clientPaymentId: params.clientPaymentId,
    metadata: params.metadata,
  });

  return {
    billingAccountId: result.billingAccountId,
    balanceCredits: result.balanceCredits,
  };
}

export async function getResmicSummaryFacade(params: {
  sessionUser: SessionUser;
  limit?: number | undefined;
}): Promise<{
  billingAccountId: string;
  balanceCredits: number;
  ledger: {
    id: string;
    amount: number;
    balanceAfter: number;
    reason: string;
    reference: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }[];
}> {
  const { accountService } = createContainer();

  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    {
      userId: params.sessionUser.id,
      walletAddress: params.sessionUser.walletAddress,
    }
  );

  return getResmicSummary(accountService, {
    billingAccountId: billingAccount.id,
    limit: params.limit,
  });
}
