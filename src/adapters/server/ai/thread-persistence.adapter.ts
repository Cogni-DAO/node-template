// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/thread-persistence.adapter`
 * Purpose: Drizzle implementation of ThreadPersistencePort with RLS enforcement.
 * Scope: CRUD operations on ai_threads table within tenant-scoped transactions. Does not contain business logic or query optimization.
 * Invariants:
 *   - SERIALIZED_APPENDS: SELECT ... FOR UPDATE within transaction
 *   - MESSAGES_GROW_ONLY: rejects saves where newMessages.length < existingMessages.length
 *   - MAX_THREAD_MESSAGES: rejects saves exceeding 200 messages
 *   - TENANT_SCOPED: SET LOCAL app.current_user_id in every transaction
 *   - SOFT_DELETE_DEFAULT: all reads filter deleted_at IS NULL
 * Side-effects: IO (database transactions)
 * Links: docs/spec/thread-persistence.md, ThreadPersistencePort
 * @public
 */

import type { ActorId } from "@cogni/ids";
import type { UIMessage } from "ai";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/adapters/server/db/client";
import { setTenantContext } from "@/adapters/server/db/client";
import type { ThreadPersistencePort, ThreadSummary } from "@/ports";
import { aiThreads } from "@/shared/db/schema";

/** Maximum messages per thread — per MAX_THREAD_MESSAGES invariant. */
export const MAX_THREAD_MESSAGES = 200;

/**
 * Drizzle-based implementation of ThreadPersistencePort.
 *
 * All operations run inside tenant-scoped transactions with
 * SET LOCAL app.current_user_id for RLS enforcement.
 */
export class DrizzleThreadPersistenceAdapter implements ThreadPersistencePort {
  constructor(
    private readonly db: Database,
    private readonly actorId: ActorId
  ) {}

  async loadThread(
    ownerUserId: string,
    stateKey: string
  ): Promise<UIMessage[]> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.actorId);

      const rows = await tx
        .select({ messages: aiThreads.messages })
        .from(aiThreads)
        .where(
          and(
            eq(aiThreads.ownerUserId, ownerUserId),
            eq(aiThreads.stateKey, stateKey),
            isNull(aiThreads.deletedAt)
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row) return [];
      return row.messages as UIMessage[];
    });
  }

  async saveThread(
    ownerUserId: string,
    stateKey: string,
    messages: UIMessage[]
  ): Promise<void> {
    // MAX_THREAD_MESSAGES enforcement
    if (messages.length > MAX_THREAD_MESSAGES) {
      throw new Error(
        `Thread exceeds MAX_THREAD_MESSAGES (${MAX_THREAD_MESSAGES}). ` +
          `Got ${messages.length}. Soft delete the thread and start a new one.`
      );
    }

    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.actorId);

      // SERIALIZED_APPENDS: SELECT ... FOR UPDATE locks the row
      const existing = await tx
        .select({
          id: aiThreads.id,
          messages: aiThreads.messages,
        })
        .from(aiThreads)
        .where(
          and(
            eq(aiThreads.ownerUserId, ownerUserId),
            eq(aiThreads.stateKey, stateKey),
            isNull(aiThreads.deletedAt)
          )
        )
        .for("update")
        .limit(1);

      const existingRow = existing[0];
      if (existingRow) {
        const existingMessages = existingRow.messages as UIMessage[];

        // MESSAGES_GROW_ONLY enforcement
        if (messages.length < existingMessages.length) {
          throw new Error(
            `MESSAGES_GROW_ONLY violated: new message count (${messages.length}) ` +
              `is less than existing (${existingMessages.length})`
          );
        }

        await tx
          .update(aiThreads)
          .set({
            messages: sql`${JSON.stringify(messages)}::jsonb`,
            updatedAt: sql`now()`,
          })
          .where(eq(aiThreads.id, existingRow.id));
      } else {
        // Insert new thread
        await tx.insert(aiThreads).values({
          ownerUserId,
          stateKey,
          messages: sql`${JSON.stringify(messages)}::jsonb`,
        });
      }
    });
  }

  async softDelete(ownerUserId: string, stateKey: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.actorId);

      await tx
        .update(aiThreads)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            eq(aiThreads.ownerUserId, ownerUserId),
            eq(aiThreads.stateKey, stateKey),
            isNull(aiThreads.deletedAt)
          )
        );
    });
  }

  async listThreads(
    ownerUserId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<ThreadSummary[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.actorId);

      const rows = await tx
        .select({
          stateKey: aiThreads.stateKey,
          updatedAt: aiThreads.updatedAt,
          messages: aiThreads.messages,
          metadata: aiThreads.metadata,
        })
        .from(aiThreads)
        .where(
          and(
            eq(aiThreads.ownerUserId, ownerUserId),
            isNull(aiThreads.deletedAt)
          )
        )
        .orderBy(desc(aiThreads.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows.map((row) => ({
        stateKey: row.stateKey,
        updatedAt: row.updatedAt,
        messageCount: (row.messages as UIMessage[]).length,
        metadata: row.metadata ?? undefined,
      }));
    });
  }
}
