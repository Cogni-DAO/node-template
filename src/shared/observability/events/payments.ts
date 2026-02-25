// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/events.payments`
 * Purpose: Strict payload schemas for payments domain events.
 * Scope: Type definitions for structured payment events. Does not implement event creation.
 * Invariants: All events extend EventBase (reqId required).
 * Side-effects: none
 * Notes: Use these types for type-safe logging in payments features/routes.
 * Links: Uses EventBase from events.ts; exported via observability/index.ts.
 * @public
 */

export interface PaymentsIntentCreatedEvent {
  billingAccountId: string;
  chainId: number;
  durationMs: number;
  event: "payments.intent_created";
  paymentIntentId: string;
  reqId: string;
  routeId: string;
}

export interface PaymentsStateTransitionEvent {
  billingAccountId: string;
  chainId: number;
  durationMs: number;
  errorCode?: string | undefined;
  event: "payments.state_transition";
  fromStatus?: string | undefined;
  idempotentHit?: boolean | undefined;
  paymentIntentId: string;
  reqId: string;
  routeId: string;
  toStatus: string;
  txHash?: string | undefined;
}

export interface PaymentsVerifiedEvent {
  billingAccountId: string;
  chainId: number;
  durationMs: number;
  event: "payments.verified";
  paymentIntentId: string;
  reqId: string;
  routeId: string;
  txHash: string;
}

export interface PaymentsConfirmedEvent {
  billingAccountId: string;
  chainId: number;
  creditsApplied?: number | undefined;
  durationMs: number;
  event: "payments.confirmed";
  paymentIntentId: string;
  reqId: string;
  routeId: string;
  txHash: string;
}

export interface PaymentsStatusReadEvent {
  billingAccountId: string;
  durationMs: number;
  event: "payments.status_read";
  paymentIntentId: string;
  reqId: string;
  routeId: string;
  status: string;
}
