// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/store`
 * Purpose: Port interface for the activity ledger store. Shared by app and scheduler-worker.
 * Scope: Type definitions only. Does not contain implementations or I/O.
 * Invariants:
 * - ACTIVITY_APPEND_ONLY: insertActivityEvents never updates existing rows.
 * - CURATION_FREEZE_ON_FINALIZE: upsertCuration rejects writes when epoch is finalized.
 * - CURATION_AUTO_POPULATE: insertCurationDoNothing + updateCurationUserId never overwrite admin-set fields.
 * - IDENTITY_BEST_EFFORT: resolveIdentities is best-effort; unresolved events get userId=null.
 * - ONE_OPEN_EPOCH: createEpoch enforced by DB constraint.
 * - NODE_SCOPED: all operations are scoped to a node_id.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import type { CuratedEventForAllocation } from "./allocation";
import type { EpochStatus } from "./model";

// ---------------------------------------------------------------------------
// Domain record types (read-side)
// ---------------------------------------------------------------------------

export interface LedgerEpoch {
  readonly allocationAlgoRef: string | null;
  readonly approverSetHash: string | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly id: bigint;
  readonly nodeId: string;
  readonly openedAt: Date;
  readonly periodEnd: Date;
  readonly periodStart: Date;
  readonly poolTotalCredits: bigint | null;
  readonly scopeId: string;
  readonly status: EpochStatus;
  readonly weightConfig: Record<string, number>;
  readonly weightConfigHash: string | null;
}

export interface LedgerActivityEvent {
  readonly artifactUrl: string | null;
  readonly eventTime: Date;
  readonly eventType: string;
  readonly id: string;
  readonly ingestedAt: Date;
  readonly metadata: Record<string, unknown> | null;
  readonly nodeId: string;
  readonly payloadHash: string;
  readonly platformLogin: string | null;
  readonly platformUserId: string;
  readonly producer: string;
  readonly producerVersion: string;
  readonly retrievedAt: Date;
  readonly scopeId: string;
  readonly source: string;
}

export interface LedgerCuration {
  readonly createdAt: Date;
  readonly epochId: bigint;
  readonly eventId: string;
  readonly id: string;
  readonly included: boolean;
  readonly nodeId: string;
  readonly note: string | null;
  readonly updatedAt: Date;
  readonly userId: string | null;
  readonly weightOverrideMilli: bigint | null;
}

export interface LedgerAllocation {
  readonly activityCount: number;
  readonly createdAt: Date;
  readonly epochId: bigint;
  readonly finalUnits: bigint | null;
  readonly id: string;
  readonly nodeId: string;
  readonly overrideReason: string | null;
  readonly proposedUnits: bigint;
  readonly updatedAt: Date;
  readonly userId: string;
}

export interface LedgerSourceCursor {
  readonly cursorValue: string;
  readonly nodeId: string;
  readonly retrievedAt: Date;
  readonly scopeId: string;
  readonly source: string;
  readonly sourceRef: string;
  readonly stream: string;
}

export interface LedgerPoolComponent {
  readonly algorithmVersion: string;
  readonly amountCredits: bigint;
  readonly componentId: string;
  readonly computedAt: Date;
  readonly epochId: bigint;
  readonly evidenceRef: string | null;
  readonly id: string;
  readonly inputsJson: Record<string, unknown>;
  readonly nodeId: string;
}

export interface LedgerPayoutStatement {
  readonly allocationSetHash: string;
  readonly createdAt: Date;
  readonly epochId: bigint;
  readonly id: string;
  readonly nodeId: string;
  readonly payoutsJson: Array<{
    user_id: string;
    total_units: string;
    share: string;
    amount_credits: string;
  }>;
  readonly poolTotalCredits: bigint;
  readonly supersedesStatementId: string | null;
}

export interface LedgerStatementSignature {
  readonly id: string;
  readonly nodeId: string;
  readonly signature: string;
  readonly signedAt: Date;
  readonly signerWallet: string;
  readonly statementId: string;
}

// ---------------------------------------------------------------------------
// Write-side parameter types
// ---------------------------------------------------------------------------

export interface InsertActivityEventParams {
  readonly artifactUrl?: string | null;
  readonly eventTime: Date;
  readonly eventType: string;
  readonly id: string;
  readonly metadata?: Record<string, unknown> | null;
  readonly nodeId: string;
  readonly payloadHash: string;
  readonly platformLogin?: string | null;
  readonly platformUserId: string;
  readonly producer: string;
  readonly producerVersion: string;
  readonly retrievedAt: Date;
  readonly scopeId: string;
  readonly source: string;
}

export interface UpsertCurationParams {
  readonly epochId: bigint;
  readonly eventId: string;
  readonly included?: boolean;
  readonly nodeId: string;
  readonly note?: string | null;
  readonly userId?: string | null;
  readonly weightOverrideMilli?: bigint | null;
}

export interface InsertAllocationParams {
  readonly activityCount: number;
  readonly epochId: bigint;
  readonly finalUnits?: bigint | null;
  readonly nodeId: string;
  readonly overrideReason?: string | null;
  readonly proposedUnits: bigint;
  readonly userId: string;
}

export interface InsertPoolComponentParams {
  readonly algorithmVersion: string;
  readonly amountCredits: bigint;
  readonly componentId: string;
  readonly epochId: bigint;
  readonly evidenceRef?: string | null;
  readonly inputsJson: Record<string, unknown>;
  readonly nodeId: string;
}

export interface InsertPayoutStatementParams {
  readonly allocationSetHash: string;
  readonly epochId: bigint;
  readonly nodeId: string;
  readonly payoutsJson: Array<{
    user_id: string;
    total_units: string;
    share: string;
    amount_credits: string;
  }>;
  readonly poolTotalCredits: bigint;
  readonly supersedesStatementId?: string | null;
}

export interface InsertSignatureParams {
  readonly nodeId: string;
  readonly signature: string;
  readonly signedAt: Date;
  readonly signerWallet: string;
  readonly statementId: string;
}

/**
 * Narrowed params for auto-population INSERT (CURATION_AUTO_POPULATE).
 * Intentionally excludes weightOverrideMilli and note to prevent accidental overwrites.
 */
export interface InsertCurationAutoParams {
  readonly epochId: bigint;
  readonly eventId: string;
  readonly included: boolean;
  readonly nodeId: string;
  readonly userId: string | null;
}

// ---------------------------------------------------------------------------
// Identity resolution types
// ---------------------------------------------------------------------------

/**
 * An event that needs curation work — either no curation row exists,
 * or the curation row has user_id IS NULL (unresolved).
 */
export interface UncuratedEvent {
  readonly event: LedgerActivityEvent;
  /** true = curation row exists with userId=NULL; false = no curation row */
  readonly hasExistingCuration: boolean;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ActivityLedgerStore {
  /** Transition epoch open → review (INGESTION_CLOSED_ON_REVIEW).
   *  Pins approverSetHash, allocationAlgoRef, and weightConfigHash. */
  closeIngestion(
    epochId: bigint,
    approverSetHash: string,
    allocationAlgoRef: string,
    weightConfigHash: string
  ): Promise<LedgerEpoch>;
  // Epochs
  createEpoch(params: {
    nodeId: string;
    scopeId: string;
    periodStart: Date;
    periodEnd: Date;
    weightConfig: Record<string, number>;
  }): Promise<LedgerEpoch>;
  /**
   * Delete allocation rows where user_id NOT IN activeUserIds AND final_units IS NULL.
   * Admin-overridden allocations (final_units set) are never auto-deleted.
   */
  deleteStaleAllocations(
    epochId: bigint,
    activeUserIds: string[]
  ): Promise<void>;

  /** Transition epoch review → finalized. Sets poolTotalCredits and closedAt. */
  finalizeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch>;

  /**
   * Atomic finalize: epoch transition + statement upsert + signature upsert in one DB transaction.
   * Handles all states:
   * - review → finalized: insert statement + signature, return both
   * - already finalized: repair missing statement/signature, assert hash match
   * - open or missing: throw domain error
   * Uses ON CONFLICT for retry safety.
   */
  finalizeEpochAtomic(params: {
    epochId: bigint;
    poolTotal: bigint;
    statement: Omit<InsertPayoutStatementParams, "epochId">;
    signature: Omit<InsertSignatureParams, "statementId">;
    expectedAllocationSetHash: string;
  }): Promise<{ epoch: LedgerEpoch; statement: LedgerPayoutStatement }>;
  getActivityForWindow(
    nodeId: string,
    since: Date,
    until: Date
  ): Promise<LedgerActivityEvent[]>;
  getAllocationsForEpoch(epochId: bigint): Promise<LedgerAllocation[]>;

  // Allocation computation (joined query)
  /**
   * Returns curated events with resolved user IDs for allocation computation.
   * Joined query: activity_curation JOIN activity_events, filtered to userId IS NOT NULL.
   */
  getCuratedEventsForAllocation(
    epochId: bigint
  ): Promise<CuratedEventForAllocation[]>;
  getCurationForEpoch(epochId: bigint): Promise<LedgerCuration[]>;
  getCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string
  ): Promise<LedgerSourceCursor | null>;
  getEpoch(id: bigint): Promise<LedgerEpoch | null>;
  getEpochByWindow(
    nodeId: string,
    scopeId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<LedgerEpoch | null>;
  getOpenEpoch(nodeId: string, scopeId: string): Promise<LedgerEpoch | null>;
  getPoolComponentsForEpoch(epochId: bigint): Promise<LedgerPoolComponent[]>;
  getSignaturesForStatement(
    statementId: string
  ): Promise<LedgerStatementSignature[]>;
  getStatementForEpoch(epochId: bigint): Promise<LedgerPayoutStatement | null>;

  /**
   * Returns events in the epoch window that need curation work:
   * - No curation row exists (new events)
   * - Curation row exists but user_id IS NULL (unresolved)
   */
  getUncuratedEvents(
    nodeId: string,
    epochId: bigint,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UncuratedEvent[]>;
  getUnresolvedCuration(epochId: bigint): Promise<LedgerCuration[]>;

  // Activity events (append-only, epoch-agnostic raw log)
  insertActivityEvents(events: InsertActivityEventParams[]): Promise<void>;

  // Allocations
  insertAllocations(allocations: InsertAllocationParams[]): Promise<void>;
  /**
   * Insert curation rows with ON CONFLICT DO NOTHING semantics.
   * Used by auto-population (CURATION_AUTO_POPULATE) to avoid overwriting
   * admin-set fields if a row is created between getUncuratedEvents and insert.
   */
  insertCurationDoNothing(params: InsertCurationAutoParams[]): Promise<void>;

  // Payout statements
  insertPayoutStatement(
    params: InsertPayoutStatementParams
  ): Promise<LedgerPayoutStatement>;

  // Pool components
  insertPoolComponent(
    params: InsertPoolComponentParams
  ): Promise<LedgerPoolComponent>;

  // Statement signatures (schema only — signing flow is a follow-up)
  insertStatementSignature(params: InsertSignatureParams): Promise<void>;
  listEpochs(nodeId: string): Promise<LedgerEpoch[]>;

  // Identity resolution (cross-domain convenience — V0 on ledger port)
  /**
   * Resolves platform IDs to user UUIDs via user_bindings.
   * V0: GitHub only. Extend provider union for discord etc.
   */
  resolveIdentities(
    provider: "github",
    externalIds: string[]
  ): Promise<Map<string, string>>;
  updateAllocationFinalUnits(
    epochId: bigint,
    userId: string,
    finalUnits: bigint,
    overrideReason?: string
  ): Promise<void>;

  /**
   * Update user_id on a curation row ONLY when existing user_id IS NULL.
   * Never touches included, weight_override_milli, or note (CURATION_AUTO_POPULATE).
   */
  updateCurationUserId(
    epochId: bigint,
    eventId: string,
    userId: string
  ): Promise<void>;
  /**
   * Upsert allocations — ON CONFLICT (epoch_id, user_id) UPDATE proposed_units and activity_count.
   * Never touches final_units or override_reason (ALLOCATION_PRESERVES_OVERRIDES).
   */
  upsertAllocations(allocations: InsertAllocationParams[]): Promise<void>;

  // Curation (mutable while epoch open)
  upsertCuration(params: UpsertCurationParams[]): Promise<void>;

  // Cursors (one stream per call)
  upsertCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string,
    cursorValue: string
  ): Promise<void>;
}
