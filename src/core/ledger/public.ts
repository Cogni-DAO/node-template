// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/public`
 * Purpose: Re-exports from @cogni/ledger-core so app code uses @/core/ledger unchanged.
 * Scope: Re-exports only. Does not define any logic.
 * Invariants: Only exports stable public interfaces and functions.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md, packages/ledger-core/
 * @public
 */

export type {
  ApprovedReceipt,
  EpochStatus,
  EventType,
  PayoutLineItem,
  ReceiptMessageFields,
  ReceiptRole,
  SigningContext,
} from "@cogni/ledger-core";
export {
  buildReceiptMessage,
  computePayouts,
  computeReceiptSetHash,
  EPOCH_STATUSES,
  EpochAlreadyClosedError,
  EpochNotOpenError,
  EVENT_TYPES,
  hashReceiptMessage,
  IssuerNotAuthorizedError,
  isEpochAlreadyClosedError,
  isEpochNotOpenError,
  isIssuerNotAuthorizedError,
  isPoolComponentMissingError,
  isReceiptSignatureInvalidError,
  PoolComponentMissingError,
  RECEIPT_ROLES,
  ReceiptSignatureInvalidError,
} from "@cogni/ledger-core";
