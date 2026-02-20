// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/model`
 * Purpose: Domain types and enums for the epoch ledger.
 * Scope: Pure types. Does not contain business logic or perform I/O.
 * Invariants: Mirrors epoch-ledger spec schema; all credit/unit fields are bigint (ALL_MATH_BIGINT).
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

/** Receipt roles — who performed the work */
export const RECEIPT_ROLES = ["author", "reviewer", "approver"] as const;
export type ReceiptRole = (typeof RECEIPT_ROLES)[number];

/** Receipt event types — append-only lifecycle */
export const EVENT_TYPES = ["proposed", "approved", "revoked"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Epoch statuses */
export const EPOCH_STATUSES = ["open", "closed"] as const;
export type EpochStatus = (typeof EPOCH_STATUSES)[number];

/** Domain-bound signing parameters (SIGNATURE_DOMAIN_BOUND) */
export interface SigningContext {
  readonly chainId: string;
  readonly appDomain: string;
  readonly specVersion: string;
}

/** Fields included in the canonical receipt message */
export interface ReceiptMessageFields {
  readonly epochId: string;
  readonly userId: string;
  readonly workItemId: string;
  readonly role: ReceiptRole;
  readonly valuationUnits: string;
  readonly artifactRef: string;
  readonly rationaleRef: string;
}

/** Payout line item produced by computePayouts */
export interface PayoutLineItem {
  readonly userId: string;
  readonly totalUnits: bigint;
  /** Proportional share as a string decimal (e.g. "0.333333") */
  readonly share: string;
  readonly amountCredits: bigint;
}

/** Input receipt for payout computation */
export interface ApprovedReceipt {
  readonly userId: string;
  readonly valuationUnits: bigint;
}
