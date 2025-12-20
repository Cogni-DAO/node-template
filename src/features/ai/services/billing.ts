// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/billing`
 * Purpose: Post-call charge recording (non-blocking).
 * Scope: Calculate user charge from provider cost, record charge receipt. Does NOT perform pre-flight checks or LLM calls.
 * Invariants:
 *   - Post-call billing NEVER blocks user response (catches errors in prod)
 *   - ZERO_CREDIT_RECEIPTS_WRITTEN: Always records receipt even when chargedCredits = 0n
 *   - LITELLM_CALL_ID_FALLBACK: sourceReference = litellmCallId ?? requestId with error log
 *   - TEST_ENV_RETHROWS_BILLING: APP_ENV === "test" re-throws for test visibility
 * Side-effects: IO (writes charge receipt via AccountService)
 * Notes: Per COMPLETION_REFACTOR_PLAN.md P2 extraction
 * Links: completion.ts, ports/account.port.ts, llmPricingPolicy.ts
 * @public
 */

import type { Logger } from "pino";
import type { AccountService } from "@/ports";

/**
 * Context for billing a completed LLM call.
 */
export interface BillingContext {
  readonly billingAccountId: string;
  readonly virtualKeyId: string;
  readonly requestId: string;
  readonly model: string;
  readonly providerCostUsd: number | undefined;
  readonly litellmCallId: string | undefined;
  readonly provenance: "response" | "stream";
}

/**
 * Record charge receipt for a completed LLM call.
 *
 * Non-blocking in production (catches all errors).
 * Re-throws in test environment for visibility.
 *
 * @param context - Billing context from LLM result
 * @param accountService - Account service port for charge recording
 * @param log - Logger for error reporting
 */
export async function recordBilling(
  _context: BillingContext,
  _accountService: AccountService,
  _log: Logger
): Promise<void> {
  throw new Error("Not implemented - P2 extraction pending");
}
