// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/public`
 * Purpose: Public API barrel for the ledger domain.
 * Scope: Re-exports only. Does not define any logic.
 * Invariants: Only exports stable public interfaces and functions.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

// Errors
export {
  EpochAlreadyClosedError,
  EpochNotOpenError,
  IssuerNotAuthorizedError,
  isEpochAlreadyClosedError,
  isEpochNotOpenError,
  isIssuerNotAuthorizedError,
  isPoolComponentMissingError,
  isReceiptSignatureInvalidError,
  PoolComponentMissingError,
  ReceiptSignatureInvalidError,
} from "./errors";
// Model types and enums
export type {
  ApprovedReceipt,
  EpochStatus,
  EventType,
  PayoutLineItem,
  ReceiptMessageFields,
  ReceiptRole,
  SigningContext,
} from "./model";
export { EPOCH_STATUSES, EVENT_TYPES, RECEIPT_ROLES } from "./model";

// Rules
export { computePayouts } from "./rules";

// Signing
export {
  buildReceiptMessage,
  computeReceiptSetHash,
  hashReceiptMessage,
} from "./signing";
