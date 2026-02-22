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

import type { UncuratedEvent } from "@cogni/ledger-core";

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
 * scopeId is NOT in input — uses injected deps.scopeId only.
 */
export interface EnsureEpochInput {
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
  readonly weightConfig: Record<string, number>;
}

/**
 * Output from ensureEpochForWindow activity.
 */
export interface EnsureEpochOutput {
  readonly epochId: string; // bigint serialized as string for Temporal
  readonly status: string;
  readonly isNew: boolean;
  readonly weightConfig: Record<string, number>;
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
  readonly producerVersion: string;
}

/**
 * Input for insertEvents activity.
 */
export interface InsertEventsInput {
  readonly events: ActivityEvent[];
  readonly producerVersion: string;
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
 * Input for curateAndResolve activity.
 * epochId is the sole input — activity loads epoch row for period dates.
 */
export interface CurateAndResolveInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Output from curateAndResolve activity.
 */
export interface CurateAndResolveOutput {
  readonly totalEvents: number;
  readonly newCurations: number;
  readonly resolved: number;
  readonly unresolved: number;
}

/**
 * Creates ledger activity functions with injected dependencies.
 * Follows the same DI pattern as createActivities() in activities/index.ts.
 */
export function createLedgerActivities(deps: LedgerActivityDeps) {
  const { ledgerStore, sourceAdapters, nodeId, scopeId, logger } = deps;

  /**
   * Creates or returns an existing epoch for the given time window.
   * Looks up by window (any status), not just open epochs — handles finalized epochs.
   * Pins weightConfig on first create; returns existing config if epoch already exists.
   */
  async function ensureEpochForWindow(
    input: EnsureEpochInput
  ): Promise<EnsureEpochOutput> {
    const { periodStart, periodEnd, weightConfig } = input;
    logger.info(
      { periodStart, periodEnd, scopeId },
      "Ensuring epoch for window"
    );

    // Check if an epoch already exists for this window (any status)
    const existing = await ledgerStore.getEpochByWindow(
      nodeId,
      scopeId,
      new Date(periodStart),
      new Date(periodEnd)
    );
    if (existing) {
      // Weight config drift detection — log warning but use pinned config
      if (
        JSON.stringify(weightConfig) !== JSON.stringify(existing.weightConfig)
      ) {
        logger.warn(
          {
            epochId: existing.id.toString(),
            inputWeights: weightConfig,
            pinnedWeights: existing.weightConfig,
          },
          "Weight config drift detected — using pinned config from epoch creation"
        );
      }

      logger.info(
        { epochId: existing.id.toString(), status: existing.status },
        "Found existing epoch for window"
      );
      return {
        epochId: existing.id.toString(),
        status: existing.status,
        isNew: false,
        weightConfig: existing.weightConfig,
      };
    }

    // Create new epoch — DB constraint ensures EPOCH_WINDOW_UNIQUE.
    // Race: another worker may create the same epoch between our read and write.
    // On unique constraint violation, re-query and return the existing epoch.
    try {
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
        weightConfig: epoch.weightConfig,
      };
    } catch (err) {
      // Unique constraint violation — another worker created the epoch concurrently
      const raceEpoch = await ledgerStore.getEpochByWindow(
        nodeId,
        scopeId,
        new Date(periodStart),
        new Date(periodEnd)
      );
      if (raceEpoch) {
        logger.info(
          { epochId: raceEpoch.id.toString(), status: raceEpoch.status },
          "Epoch created by concurrent worker — using existing"
        );
        return {
          epochId: raceEpoch.id.toString(),
          status: raceEpoch.status,
          isNew: false,
          weightConfig: raceEpoch.weightConfig,
        };
      }
      // Not a race condition — rethrow original error
      throw err;
    }
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
        producerVersion: "unknown",
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
      producerVersion: adapter.version,
    };
  }

  /**
   * Stores events via ledgerStore. Idempotent via onConflictDoNothing on PK.
   */
  async function insertEvents(input: InsertEventsInput): Promise<void> {
    const { events, producerVersion } = input;
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
        producerVersion,
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

    // Lexicographic comparison works for ISO-8601 timestamps (all cursor values are ISO dates).
    // If cursor format changes (e.g., opaque pagination tokens), this comparison must be updated.
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

  /**
   * Curates events and resolves platform identities for an epoch.
   * Two-phase writes: INSERT new curation rows, UPDATE userId on existing unresolved rows.
   * CURATION_AUTO_POPULATE: never overwrites admin-set included/weight_override_milli/note.
   * IDENTITY_BEST_EFFORT: unresolved events get userId=null, never dropped.
   */
  async function curateAndResolve(
    input: CurateAndResolveInput
  ): Promise<CurateAndResolveOutput> {
    const epochId = BigInt(input.epochId);

    // 1. Load epoch → get period dates
    const epoch = await ledgerStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(`curateAndResolve: epoch ${input.epochId} not found`);
    }

    // 2. Get uncurated events (delta: only events needing work)
    const uncurated: UncuratedEvent[] = await ledgerStore.getUncuratedEvents(
      nodeId,
      epochId,
      epoch.periodStart,
      epoch.periodEnd
    );

    if (uncurated.length === 0) {
      logger.info({ epochId: input.epochId }, "No uncurated events — skipping");
      return { totalEvents: 0, newCurations: 0, resolved: 0, unresolved: 0 };
    }

    // 3. Collect unique platformUserIds by source
    const idsBySource = new Map<string, Set<string>>();
    for (const { event } of uncurated) {
      const ids = idsBySource.get(event.source) ?? new Set();
      ids.add(event.platformUserId);
      idsBySource.set(event.source, ids);
    }

    // 4. Batch resolve identities per source
    // V0: only github provider supported
    const resolvedMap = new Map<string, string>();
    for (const [source, ids] of idsBySource) {
      if (source === "github") {
        const result = await ledgerStore.resolveIdentities("github", [...ids]);
        for (const [extId, userId] of result) {
          resolvedMap.set(extId, userId);
        }
      }
      // TODO: add discord etc. when sources expand
    }

    // 5. Two-phase writes
    let newCurations = 0;
    let resolved = 0;
    let unresolved = 0;

    for (const { event, hasExistingCuration } of uncurated) {
      const resolvedUserId = resolvedMap.get(event.platformUserId) ?? null;

      if (!hasExistingCuration) {
        // Phase 1: INSERT new curation row (ON CONFLICT DO NOTHING for race safety)
        // Uses insertCurationDoNothing — NOT upsertCuration which overwrites all fields
        await ledgerStore.insertCurationDoNothing([
          {
            nodeId,
            epochId,
            eventId: event.id,
            userId: resolvedUserId,
            included: true,
          },
        ]);
        newCurations++;
      } else if (resolvedUserId) {
        // Phase 2: UPDATE userId on existing unresolved row
        await ledgerStore.updateCurationUserId(
          epochId,
          event.id,
          resolvedUserId
        );
      }

      if (resolvedUserId) {
        resolved++;
      } else {
        unresolved++;
      }
    }

    logger.info(
      {
        epochId: input.epochId,
        totalEvents: uncurated.length,
        newCurations,
        resolved,
        unresolved,
      },
      "Curation and identity resolution complete"
    );

    return {
      totalEvents: uncurated.length,
      newCurations,
      resolved,
      unresolved,
    };
  }

  return {
    ensureEpochForWindow,
    loadCursor,
    collectFromSource,
    insertEvents,
    saveCursor,
    curateAndResolve,
  };
}

/** Type alias for workflow proxy usage */
export type LedgerActivities = ReturnType<typeof createLedgerActivities>;
