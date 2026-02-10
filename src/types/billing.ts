// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@types/billing`
 * Purpose: Shared billing type definitions and categorization constants (logic-free).
 * Scope: Defines charge_reason enum for activity tracking, BillingCommitFn callback type for DI. Re-exports SourceSystem from @cogni/ai-core. Does NOT implement business logic.
 * Invariants:
 * - ONLY exports: enums (as const arrays), literal union types, simple string mappings, and callback type aliases
 * - FORBIDDEN: functions, computations, validation logic, or business rules
 * - charge_reason is for accounting/refunds, source_service is for UI/reports
 * - SOURCE_SYSTEMS/SourceSystem: Re-exported from @cogni/ai-core (SINGLE_SOURCE_OF_TRUTH)
 * Side-effects: none (constants and types only)
 * Links: Used by billing schema, ports, adapters, UI components, and core/public.ts re-exports
 * @public
 */

// Re-export from canonical source (per SINGLE_SOURCE_OF_TRUTH invariant)
export { SOURCE_SYSTEMS, type SourceSystem } from "@cogni/ai-core";

import type { RunContext } from "@/types/run-context";
import type { UsageFact } from "@/types/usage";

/**
 * Injected billing commit function for the BillingGraphExecutorDecorator.
 *
 * Created in the app layer (facade or route handler) as a closure binding
 * `commitUsageFact` + `accountService` + `log`. Passed through the factory
 * to the decorator — adapter/bootstrap layers never import from features.
 *
 * @param fact - Usage fact from a usage_report event
 * @param context - Run context for correlation (runId, attempt, ingressRequestId)
 */
export type BillingCommitFn = (
  fact: UsageFact,
  context: RunContext
) => Promise<void>;

/**
 * Charge reasons represent the economic/billing category of a charge.
 * Used for accounting, refunds, and financial analytics.
 */
export const CHARGE_REASONS = [
  "llm_usage",
  "image_generation",
  "subscription",
  "manual_adjustment",
  "promo_credit_consumption",
] as const;

export type ChargeReason = (typeof CHARGE_REASONS)[number];
