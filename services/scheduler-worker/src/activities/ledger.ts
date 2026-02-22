// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/ledger`
 * Purpose: Temporal Activities for ledger epoch collection — cursor-based ingestion from source adapters.
 * Scope: Plain async functions that perform I/O (DB, GitHub API). Called by CollectEpochWorkflow.
 * Invariants:
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each collect() call
 *   - Per NODE_SCOPED: All operations pass nodeId + scopeId from deps
 *   - Per TEMPORAL_DETERMINISM: Activities contain all I/O; workflows call only these proxies
 * Side-effects: IO (database, GitHub API)
 * Links: docs/spec/epoch-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import type { ActivityEvent } from "@cogni/ingestion-core";

import type { Logger } from "../observability/logger.js";
import type { ActivityLedgerStore, SourceAdapter } from "../ports/index.js";

/**
 * Dependencies injected into ledger activities at worker creation.
 */
export interface LedgerActivityDeps {
  readonly ledgerStore: ActivityLedgerStore;
  readonly sourceAdapters: ReadonlyMap<string, SourceAdapter>;
  readonly nodeId: string;
  readonly scopeId: string;
  readonly logger: Logger;
}

/**
 * Input for ensureEpochForWindow activity.
 */
export interface EnsureEpochInput {
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
  readonly scopeId: string;
  readonly weightConfig: Record<string, number>;
}

/**
 * Output from ensureEpochForWindow activity.
 */
export interface EnsureEpochOutput {
  readonly epochId: string; // bigint serialized as string for Temporal
  readonly status: string;
  readonly isNew: boolean;
}

/**
 * Input for loadCursor activity.
 */
export interface LoadCursorInput {
  readonly source: string;
  readonly stream: string;
  readonly sourceRef: string;
}

/**
 * Input for collectFromSource activity.
 */
export interface CollectFromSourceInput {
  readonly source: string;
  readonly streams: string[];
  readonly cursorValue: string | null;
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
}

/**
 * Output from collectFromSource activity.
 */
export interface CollectFromSourceOutput {
  readonly events: ActivityEvent[];
  readonly nextCursorValue: string;
  readonly nextCursorStreamId: string;
}

/**
 * Input for insertEvents activity.
 */
export interface InsertEventsInput {
  readonly events: ActivityEvent[];
}

/**
 * Input for saveCursor activity.
 */
export interface SaveCursorInput {
  readonly source: string;
  readonly stream: string;
  readonly sourceRef: string;
  readonly cursorValue: string;
}

/**
 * Creates ledger activity functions with injected dependencies.
 * Follows the same DI pattern as createActivities() in activities/index.ts.
 */
export function createLedgerActivities(deps: LedgerActivityDeps) {
  const { ledgerStore, sourceAdapters, nodeId, scopeId, logger } = deps;

  /**
   * Creates or returns an existing epoch for the given time window.
   * Idempotent via EPOCH_WINDOW_UNIQUE constraint.
   */
  async function ensureEpochForWindow(
    input: EnsureEpochInput
  ): Promise<EnsureEpochOutput> {
    const { periodStart, periodEnd, weightConfig } = input;
    logger.info(
      { periodStart, periodEnd, scopeId },
      "Ensuring epoch for window"
    );

    // Check if an epoch already exists for this window
    const existing = await ledgerStore.getOpenEpoch(nodeId, scopeId);
    if (existing) {
      const existingStart = existing.periodStart.toISOString();
      const existingEnd = existing.periodEnd.toISOString();
      if (existingStart === periodStart && existingEnd === periodEnd) {
        logger.info(
          { epochId: existing.id.toString(), status: existing.status },
          "Found existing epoch for window"
        );
        return {
          epochId: existing.id.toString(),
          status: existing.status,
          isNew: false,
        };
      }
    }

    // Create new epoch — DB constraint ensures EPOCH_WINDOW_UNIQUE
    const epoch = await ledgerStore.createEpoch({
      nodeId,
      scopeId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      weightConfig,
    });

    logger.info(
      { epochId: epoch.id.toString(), status: epoch.status },
      "Created new epoch"
    );

    return {
      epochId: epoch.id.toString(),
      status: epoch.status,
      isNew: true,
    };
  }

  /**
   * Loads cursor from source_cursors for incremental sync.
   * Returns null if no cursor exists (first collection).
   */
  async function loadCursor(input: LoadCursorInput): Promise<string | null> {
    const { source, stream, sourceRef } = input;
    logger.info({ source, stream, sourceRef }, "Loading cursor");

    const cursor = await ledgerStore.getCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef
    );

    if (cursor) {
      logger.info(
        { source, stream, cursorValue: cursor.cursorValue },
        "Cursor loaded"
      );
      return cursor.cursorValue;
    }

    logger.info({ source, stream }, "No cursor found, starting fresh");
    return null;
  }

  /**
   * Calls adapter.collect() to fetch events from the external source.
   * Rate limit errors throw and Temporal retries with backoff.
   */
  async function collectFromSource(
    input: CollectFromSourceInput
  ): Promise<CollectFromSourceOutput> {
    const { source, streams, cursorValue, periodStart, periodEnd } = input;
    logger.info(
      { source, streams, hasCursor: !!cursorValue },
      "Collecting from source"
    );

    const adapter = sourceAdapters.get(source);
    if (!adapter) {
      logger.warn({ source }, "No adapter found for source, skipping");
      return {
        events: [],
        nextCursorValue: cursorValue ?? new Date(periodStart).toISOString(),
        nextCursorStreamId: streams[0] ?? source,
      };
    }

    const result = await adapter.collect({
      streams,
      cursor: cursorValue
        ? {
            streamId: streams[0] ?? source,
            value: cursorValue,
            retrievedAt: new Date(),
          }
        : null,
      window: { since: new Date(periodStart), until: new Date(periodEnd) },
    });

    logger.info(
      {
        source,
        eventCount: result.events.length,
        nextCursor: result.nextCursor.value,
      },
      "Collection complete"
    );

    return {
      events: result.events as ActivityEvent[],
      nextCursorValue: result.nextCursor.value,
      nextCursorStreamId: result.nextCursor.streamId,
    };
  }

  /**
   * Stores events via ledgerStore. Idempotent via onConflictDoNothing on PK.
   */
  async function insertEvents(input: InsertEventsInput): Promise<void> {
    const { events } = input;
    if (events.length === 0) return;

    logger.info({ count: events.length }, "Inserting activity events");

    await ledgerStore.insertActivityEvents(
      events.map((e) => ({
        id: e.id,
        nodeId,
        scopeId,
        source: e.source,
        eventType: e.eventType,
        platformUserId: e.platformUserId,
        platformLogin: e.platformLogin ?? null,
        artifactUrl: e.artifactUrl ?? null,
        metadata: e.metadata ?? null,
        payloadHash: e.payloadHash,
        producer: e.source,
        producerVersion: "0.1.0",
        eventTime: e.eventTime,
        retrievedAt: new Date(),
      }))
    );

    logger.info({ count: events.length }, "Events inserted");
  }

  /**
   * Upserts cursor with monotonic advancement — never goes backwards.
   * cursor = max(existing, new) ensures crash-restart safety.
   */
  async function saveCursor(input: SaveCursorInput): Promise<void> {
    const { source, stream, sourceRef, cursorValue } = input;
    logger.info({ source, stream, cursorValue }, "Saving cursor");

    // Load existing to enforce monotonic advancement
    const existing = await ledgerStore.getCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef
    );

    const effectiveValue =
      existing && existing.cursorValue > cursorValue
        ? existing.cursorValue
        : cursorValue;

    await ledgerStore.upsertCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef,
      effectiveValue
    );

    logger.info(
      { source, stream, cursorValue: effectiveValue },
      "Cursor saved"
    );
  }

  return {
    ensureEpochForWindow,
    loadCursor,
    collectFromSource,
    insertEvents,
    saveCursor,
  };
}

/** Type alias for workflow proxy usage */
export type LedgerActivities = ReturnType<typeof createLedgerActivities>;
