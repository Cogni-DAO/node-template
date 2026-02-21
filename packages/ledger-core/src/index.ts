// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core`
 * Purpose: Pure domain logic for the epoch ledger — shared between app and scheduler-worker.
 * Scope: Re-exports model types, payout computation, signing, and errors. Does not contain I/O or infrastructure code.
 * Invariants: No imports from src/ or services/. Pure domain logic only.
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
