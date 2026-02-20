// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/signing`
 * Purpose: Canonical receipt message builder and SHA-256 hashing (SIGNATURE_DOMAIN_BOUND).
 * Scope: Pure functions. Does not hold private keys, verify signatures, or perform network I/O.
 * Invariants:
 * - Message format is canonical and deterministic.
 * - Domain-bound: includes chain_id, app_domain, spec_version (SIGNATURE_DOMAIN_BOUND).
 * - Hash is SHA-256 of the canonical message bytes.
 * Side-effects: none (uses Web Crypto API which is sync-like via subtle)
 * Links: docs/spec/epoch-ledger.md#receipt-signing
 * @public
 */

import type { ReceiptMessageFields, SigningContext } from "./model";

/**
 * Build the canonical domain-bound receipt message string.
 *
 * Format (per spec):
 * ```
 * {appDomain}:{specVersion}:{chainId}
 * epoch:{epochId}
 * receipt:{userId}:{workItemId}:{role}
 * units:{valuationUnits}
 * artifact:{artifactRef}
 * rationale:{rationaleRef}
 * ```
 */
export function buildReceiptMessage(
  context: SigningContext,
  fields: ReceiptMessageFields
): string {
  return [
    `${context.appDomain}:${context.specVersion}:${context.chainId}`,
    `epoch:${fields.epochId}`,
    `receipt:${fields.userId}:${fields.workItemId}:${fields.role}`,
    `units:${fields.valuationUnits}`,
    `artifact:${fields.artifactRef}`,
    `rationale:${fields.rationaleRef}`,
  ].join("\n");
}

/**
 * Compute SHA-256 hash of a message string.
 * Returns lowercase hex string.
 */
export async function hashReceiptMessage(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a deterministic hash of a set of receipts for epoch close.
 * Receipts are sorted by ID before hashing to ensure determinism.
 *
 * @param receiptIds - Receipt UUIDs to include in the set hash
 * @returns SHA-256 hex string of the sorted, joined receipt IDs
 */
export async function computeReceiptSetHash(
  receiptIds: readonly string[]
): Promise<string> {
  const sorted = [...receiptIds].sort();
  const canonical = sorted.join(",");
  return hashReceiptMessage(canonical);
}
