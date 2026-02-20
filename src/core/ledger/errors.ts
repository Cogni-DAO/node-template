// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/errors`
 * Purpose: Domain error classes for ledger operations.
 * Scope: Error definitions and type guards. Does not perform I/O or contain business logic.
 * Invariants: All errors have a readonly `code` discriminant for type guards.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

export class EpochNotOpenError extends Error {
  public readonly code = "EPOCH_NOT_OPEN" as const;
  constructor(public readonly epochId: string) {
    super(`Epoch ${epochId} is not open`);
    this.name = "EpochNotOpenError";
  }
}

export class EpochAlreadyClosedError extends Error {
  public readonly code = "EPOCH_ALREADY_CLOSED" as const;
  constructor(public readonly epochId: string) {
    super(`Epoch ${epochId} is already closed`);
    this.name = "EpochAlreadyClosedError";
  }
}

export class ReceiptSignatureInvalidError extends Error {
  public readonly code = "RECEIPT_SIGNATURE_INVALID" as const;
  constructor(
    public readonly receiptId: string,
    public readonly reason: string
  ) {
    super(`Invalid signature on receipt ${receiptId}: ${reason}`);
    this.name = "ReceiptSignatureInvalidError";
  }
}

export class IssuerNotAuthorizedError extends Error {
  public readonly code = "ISSUER_NOT_AUTHORIZED" as const;
  constructor(
    public readonly address: string,
    public readonly requiredRole: string
  ) {
    super(`Issuer ${address} lacks required role: ${requiredRole}`);
    this.name = "IssuerNotAuthorizedError";
  }
}

export class PoolComponentMissingError extends Error {
  public readonly code = "POOL_COMPONENT_MISSING" as const;
  constructor(
    public readonly epochId: string,
    public readonly componentId: string
  ) {
    super(
      `Epoch ${epochId} is missing required pool component: ${componentId}`
    );
    this.name = "PoolComponentMissingError";
  }
}

// Type guards

export function isEpochNotOpenError(
  error: unknown
): error is EpochNotOpenError {
  return error instanceof Error && error.name === "EpochNotOpenError";
}

export function isEpochAlreadyClosedError(
  error: unknown
): error is EpochAlreadyClosedError {
  return error instanceof Error && error.name === "EpochAlreadyClosedError";
}

export function isReceiptSignatureInvalidError(
  error: unknown
): error is ReceiptSignatureInvalidError {
  return (
    error instanceof Error && error.name === "ReceiptSignatureInvalidError"
  );
}

export function isIssuerNotAuthorizedError(
  error: unknown
): error is IssuerNotAuthorizedError {
  return error instanceof Error && error.name === "IssuerNotAuthorizedError";
}

export function isPoolComponentMissingError(
  error: unknown
): error is PoolComponentMissingError {
  return error instanceof Error && error.name === "PoolComponentMissingError";
}
