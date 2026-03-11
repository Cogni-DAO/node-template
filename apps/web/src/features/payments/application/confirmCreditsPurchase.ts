// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/payments/application/confirmCreditsPurchase`
 * Purpose: Application orchestrator — composes credit confirmation with treasury settlement.
 * Scope: Orchestrates the business invariant: "after every confirmed credit purchase, settle treasury revenue." Does not contain billing logic (delegates to creditsConfirm) or chain mechanics (delegates to TreasurySettlementPort).
 * Invariants: Credit confirmation always succeeds independently of settlement. Settlement skipped on idempotent replay.
 * Side-effects: IO (via delegated ports)
 * Links: docs/spec/payments-design.md, task.0085
 * @public
 */

import {
  type CreditsConfirmInput,
  confirmCreditsPayment,
} from "@/features/payments/services/creditsConfirm";
import type {
  AccountService,
  ServiceAccountService,
  TreasurySettlementOutcome,
  TreasurySettlementPort,
} from "@/ports";

export type { CreditsConfirmInput } from "@/features/payments/services/creditsConfirm";

export interface ConfirmCreditsPurchaseResult {
  billingAccountId: string;
  balanceCredits: number;
  creditsApplied: number;
  /** Present when on-chain treasury settlement succeeded */
  settlement?: TreasurySettlementOutcome;
  /** Present when treasury settlement was attempted but failed */
  settlementError?: unknown;
}

/**
 * Confirm a credit purchase and settle treasury revenue.
 *
 * Steps 1-2 (credit user + mint system tenant bonus) delegate to confirmCreditsPayment.
 * Step 3 (treasury settlement) delegates to TreasurySettlementPort.
 *
 * Settlement failure never fails credit confirmation. The structured result
 * carries either `settlement` (success) or `settlementError` (failure) for
 * the caller to log.
 */
export async function confirmCreditsPurchase(
  accountService: AccountService,
  serviceAccountService: ServiceAccountService,
  treasurySettlement: TreasurySettlementPort | undefined,
  input: CreditsConfirmInput
): Promise<ConfirmCreditsPurchaseResult> {
  // Steps 1-2: Credit user + mint system tenant bonus
  const result = await confirmCreditsPayment(
    accountService,
    serviceAccountService,
    input
  );

  // Skip settlement on idempotent replay (duplicate payment)
  if (result.creditsApplied === 0) return result;

  // Step 3: Settle treasury revenue
  if (treasurySettlement) {
    try {
      const settlement = await treasurySettlement.settleConfirmedCreditPurchase(
        {
          paymentIntentId: input.clientPaymentId,
        }
      );
      if (settlement) return { ...result, settlement };
    } catch (err) {
      return { ...result, settlementError: err };
    }
  }

  return result;
}
