// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/events.ai`
 * Purpose: Strict payload schemas for AI domain events.
 * Scope: Type definitions for structured AI events. Does not implement event creation.
 * Invariants: All events extend EventBase (reqId required).
 * Side-effects: none
 * Notes: Use these types for type-safe logging in AI features/routes.
 * Links: Uses EventBase from events.ts; exported via observability/index.ts.
 * @public
 */

export interface AiLlmCallEvent {
  billingAccountId: string;
  durationMs: number;
  event: "ai.llm_call";
  model?: string | undefined;
  providerCostUsd?: number | undefined;
  reqId: string;
  routeId: string;
  tokensUsed?: number | undefined;
}

export interface AiActivityQueryCompletedEvent {
  billingAccountId: string;
  durationMs: number;
  /** Effective bucket step used (server-derived or validated) */
  effectiveStep: "5m" | "15m" | "1h" | "6h" | "1d";
  event: "ai.activity.query_completed";
  /** Total logs fetched from LiteLLM for this range */
  fetchedLogCount: number;
  orgId?: string | undefined;
  reqId: string;
  resultCount: number;
  routeId: string;
  scope: "user" | "org" | "system";
  status: "success" | "error";
  /** Logs without matching receipt (no spend data) */
  unjoinedLogCount: number;
}

/**
 * Emitted when commitUsageFact completes (success or error).
 * Per GRAPH_EXECUTION.md: billing subscriber commits usage facts to ledger.
 */
export interface AiBillingCommitCompleteEvent {
  attempt: number;
  chargedCredits?: string | undefined;
  /** Populated only on error */
  errorCode?: "db_error" | "validation" | "unknown" | undefined;
  event: "ai.billing.commit_complete";
  outcome: "success" | "error";
  /** Request ID for Loki correlation (from context.ingressRequestId) */
  reqId: string;
  runId: string;
  sourceSystem: string;
}

/**
 * Emitted when RunEventRelay pump fails unexpectedly.
 * Per BILLING_INDEPENDENT_OF_CLIENT: pump errors are logged but never propagate.
 */
export interface AiRelayPumpErrorEvent {
  errorCode: "pump_failed";
  event: "ai.relay.pump_error";
  /** Request ID for Loki correlation (from context.ingressRequestId) */
  reqId: string;
  runId: string;
}
