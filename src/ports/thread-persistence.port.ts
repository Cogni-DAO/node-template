// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/thread-persistence.port`
 * Purpose: Port interface for server-authoritative thread persistence.
 * Scope: Defines ThreadPersistencePort and ThreadSummary. Does not contain implementations.
 * Invariants:
 *   - SERIALIZED_APPENDS: saveThread() acquires FOR UPDATE lock within transaction
 *   - MESSAGES_GROW_ONLY: saveThread() rejects if messages.length < existing length
 *   - MAX_THREAD_MESSAGES: saveThread() rejects if messages.length > 200
 *   - SOFT_DELETE_DEFAULT: all reads filter deleted_at IS NULL
 * Side-effects: none
 * Links: docs/spec/thread-persistence.md
 * @public
 */

import type { UIMessage } from "ai";

/** Summary of a thread for listing (no full message content). */
export interface ThreadSummary {
  stateKey: string;
  updatedAt: Date;
  messageCount: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ThreadPersistencePort {
  /** Load thread messages. Returns empty array if thread doesn't exist. */
  loadThread(ownerUserId: string, stateKey: string): Promise<UIMessage[]>;

  /**
   * Persist full message array (upsert). Creates thread if not exists.
   * SERIALIZED_APPENDS: acquires FOR UPDATE lock within transaction.
   * MESSAGES_GROW_ONLY: rejects if messages.length < existing length.
   * MAX_THREAD_MESSAGES: rejects if messages.length > 200.
   */
  saveThread(
    ownerUserId: string,
    stateKey: string,
    messages: UIMessage[]
  ): Promise<void>;

  /** Soft delete thread. Sets deleted_at, messages still in DB for retention. */
  softDelete(ownerUserId: string, stateKey: string): Promise<void>;

  /** List threads for owner, ordered by recency. */
  listThreads(
    ownerUserId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<ThreadSummary[]>;
}
