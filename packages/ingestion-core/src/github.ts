// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ingestion-core/github`
 * Purpose: GitHub source constants and canonical hash-field builders — shared by poll and webhook adapters.
 * Scope: Registration metadata + cross-path dedup alignment. Does not contain adapter implementations or platform-specific deps.
 * Invariants:
 * - ACTIVITY_IDEMPOTENT: Canonical hash builders guarantee identical payloadHash from both poll and webhook for overlapping event types.
 * - Both poll and webhook adapters for GitHub MUST use these builders for shared event types.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

// ---------------------------------------------------------------------------
// Source identity
// ---------------------------------------------------------------------------

/** GitHub source identifier. Use this instead of string literal "github". */
export const GITHUB_SOURCE = "github" as const;

/** GitHub adapter version. Shared by poll and webhook adapters. Bump on schema changes. */
export const GITHUB_ADAPTER_VERSION = "0.3.0" as const;

// ---------------------------------------------------------------------------
// Canonical hash-field builders
//
// Both poll (scheduler-worker) and webhook (app) adapters MUST use these
// for overlapping event types. This guarantees identical payloadHash from
// either path, which is critical for RECEIPT_IDEMPOTENT dedup.
//
// When adding a new source: create a sibling file (e.g. notion.ts) with
// the same pattern — source constant, version constant, hash builders.
// ---------------------------------------------------------------------------

/** Canonical hash fields for a merged PR. Used by both poll and webhook. */
export function prMergedHashFields(
  authorId: string,
  id: string,
  mergedAt: string
): Record<string, unknown> {
  return { authorId, id, mergedAt };
}

/** Canonical hash fields for a closed issue. Used by both poll and webhook. */
export function issueClosedHashFields(
  authorId: string,
  closedAt: string,
  id: string
): Record<string, unknown> {
  return { authorId, closedAt, id };
}

/** Canonical hash fields for a submitted review. Used by both poll and webhook. */
export function reviewSubmittedHashFields(
  authorId: string,
  id: string,
  state: string,
  submittedAt: string
): Record<string, unknown> {
  return { authorId, id, state, submittedAt };
}
