// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/execution-request`
 * Purpose: Port interface for execution request idempotency.
 * Scope: Defines contract for idempotent graph execution via internal API. Does not contain implementations.
 * Invariants:
 *   - Per EXECUTION_IDEMPOTENCY_PERSISTED: Persists idempotency key → {runId, traceId}
 *   - idempotencyKey uniqueness enforced at DB level (primary key)
 *   - requestHash mismatch detection for payload integrity
 * Side-effects: none (interface definition only)
 * Links: docs/SCHEDULER_SPEC.md, execution_requests table
 * @public
 */

/**
 * Stored execution request record.
 * Per SCHEDULER_SPEC.md: correctness layer for slot deduplication.
 */
export interface ExecutionRequest {
  /** Idempotency key (e.g., `scheduleId:TemporalScheduledStartTime`) */
  readonly idempotencyKey: string;
  /** SHA256 hash of normalized request payload */
  readonly requestHash: string;
  /** GraphExecutorPort runId */
  readonly runId: string;
  /** Langfuse trace ID (null if Langfuse not configured) */
  readonly traceId: string | null;
  /** When request was first received */
  readonly createdAt: Date;
}

/**
 * Result of checking/storing an execution request.
 */
export type ExecutionRequestResult =
  | { status: "new" }
  | { status: "cached"; request: ExecutionRequest }
  | { status: "mismatch"; existingHash: string; providedHash: string };

/**
 * Port interface for execution request idempotency.
 * Per EXECUTION_IDEMPOTENCY_PERSISTED: This is the correctness layer for slot deduplication.
 */
export interface ExecutionRequestPort {
  /**
   * Get or create an execution request record.
   *
   * - If idempotencyKey doesn't exist: returns { status: 'new' }, caller proceeds with execution
   * - If idempotencyKey exists and requestHash matches: returns { status: 'cached', request }
   * - If idempotencyKey exists but requestHash differs: returns { status: 'mismatch' }
   *
   * @param idempotencyKey - Unique key for deduplication (e.g., `scheduleId:scheduledFor`)
   * @param requestHash - SHA256 hash of normalized request payload
   */
  checkIdempotency(
    idempotencyKey: string,
    requestHash: string
  ): Promise<ExecutionRequestResult>;

  /**
   * Store execution request after successful execution.
   * Called only after graph execution completes (with runId and optional traceId).
   *
   * @param idempotencyKey - Unique key for deduplication
   * @param requestHash - SHA256 hash of normalized request payload
   * @param runId - GraphExecutorPort runId
   * @param traceId - Langfuse trace ID (null if not configured)
   */
  storeRequest(
    idempotencyKey: string,
    requestHash: string,
    runId: string,
    traceId: string | null
  ): Promise<void>;
}
