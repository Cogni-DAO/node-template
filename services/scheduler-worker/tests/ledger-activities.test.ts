// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker/tests/ledger-activities.test`
 * Purpose: Unit tests for ledger activity functions.
 * Scope: Tests each activity in isolation with mocked store/adapter.
 * @internal
 */

import type {
  ActivityEvent,
  CollectResult,
  SourceAdapter,
} from "@cogni/ingestion-core";
import type {
  ActivityLedgerStore,
  LedgerEpoch,
  LedgerSourceCursor,
} from "@cogni/ledger-core";
import { describe, expect, it, vi } from "vitest";

import { createLedgerActivities } from "../src/activities/ledger.js";

const NODE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SCOPE_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => mockLogger,
} as unknown as Parameters<typeof createLedgerActivities>[0]["logger"];

function makeMockStore(
  overrides: Partial<ActivityLedgerStore> = {}
): ActivityLedgerStore {
  return {
    createEpoch: vi.fn(),
    getOpenEpoch: vi.fn().mockResolvedValue(null),
    getEpoch: vi.fn(),
    listEpochs: vi.fn(),
    closeEpoch: vi.fn(),
    insertActivityEvents: vi.fn(),
    getActivityForWindow: vi.fn(),
    upsertCuration: vi.fn(),
    getCurationForEpoch: vi.fn(),
    getUnresolvedCuration: vi.fn(),
    insertAllocations: vi.fn(),
    updateAllocationFinalUnits: vi.fn(),
    getAllocationsForEpoch: vi.fn(),
    upsertCursor: vi.fn(),
    getCursor: vi.fn().mockResolvedValue(null),
    insertPoolComponent: vi.fn(),
    getPoolComponentsForEpoch: vi.fn(),
    insertPayoutStatement: vi.fn(),
    getStatementForEpoch: vi.fn(),
    insertStatementSignature: vi.fn(),
    getSignaturesForStatement: vi.fn(),
    ...overrides,
  } as ActivityLedgerStore;
}

function makeMockAdapter(events: ActivityEvent[] = []): SourceAdapter {
  return {
    source: "github",
    version: "0.3.0",
    streams: () => [
      {
        id: "pull_requests",
        name: "PRs",
        cursorType: "timestamp" as const,
        defaultPollInterval: 3600,
      },
    ],
    collect: vi.fn().mockResolvedValue({
      events,
      nextCursor: {
        streamId: "pull_requests",
        value: "2026-02-22T00:00:00.000Z",
        retrievedAt: new Date(),
      },
    } satisfies CollectResult),
  };
}

function makeEpoch(overrides: Partial<LedgerEpoch> = {}): LedgerEpoch {
  return {
    id: 1n,
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    status: "open",
    periodStart: new Date("2026-02-15T00:00:00Z"),
    periodEnd: new Date("2026-02-22T00:00:00Z"),
    weightConfig: { "github:pr_merged": 1000 },
    poolTotalCredits: null,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(id = "github:pr:test/repo:1"): ActivityEvent {
  return {
    id,
    source: "github",
    eventType: "pr_merged",
    platformUserId: "12345",
    platformLogin: "testuser",
    artifactUrl: "https://github.com/test/repo/pull/1",
    metadata: { title: "Test PR" },
    payloadHash: "abc123",
    eventTime: new Date("2026-02-20T12:00:00Z"),
  };
}

describe("createLedgerActivities", () => {
  it("returns all expected activity functions", () => {
    const activities = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    expect(activities.ensureEpochForWindow).toBeTypeOf("function");
    expect(activities.loadCursor).toBeTypeOf("function");
    expect(activities.collectFromSource).toBeTypeOf("function");
    expect(activities.insertEvents).toBeTypeOf("function");
    expect(activities.saveCursor).toBeTypeOf("function");
  });
});

describe("ensureEpochForWindow", () => {
  it("creates a new epoch when none exists", async () => {
    const epoch = makeEpoch();
    const store = makeMockStore({
      getOpenEpoch: vi.fn().mockResolvedValue(null),
      createEpoch: vi.fn().mockResolvedValue(epoch),
    });

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await ensureEpochForWindow({
      periodStart: "2026-02-15T00:00:00.000Z",
      periodEnd: "2026-02-22T00:00:00.000Z",
      scopeId: SCOPE_ID,
      weightConfig: { "github:pr_merged": 1000 },
    });

    expect(result.isNew).toBe(true);
    expect(result.epochId).toBe("1");
    expect(store.createEpoch).toHaveBeenCalledOnce();
  });

  it("returns existing epoch when window matches", async () => {
    const epoch = makeEpoch();
    const store = makeMockStore({
      getOpenEpoch: vi.fn().mockResolvedValue(epoch),
    });

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await ensureEpochForWindow({
      periodStart: epoch.periodStart.toISOString(),
      periodEnd: epoch.periodEnd.toISOString(),
      scopeId: SCOPE_ID,
      weightConfig: { "github:pr_merged": 1000 },
    });

    expect(result.isNew).toBe(false);
    expect(result.epochId).toBe("1");
    expect(store.createEpoch).not.toHaveBeenCalled();
  });
});

describe("loadCursor", () => {
  it("returns null when no cursor exists", async () => {
    const store = makeMockStore();
    const { loadCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await loadCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
    });

    expect(result).toBeNull();
  });

  it("returns cursor value when one exists", async () => {
    const cursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-20T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(cursor),
    });

    const { loadCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await loadCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
    });

    expect(result).toBe("2026-02-20T00:00:00Z");
  });
});

describe("collectFromSource", () => {
  it("returns empty events when no adapter exists for source", async () => {
    const { collectFromSource } = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await collectFromSource({
      source: "discord",
      streams: ["messages"],
      cursorValue: null,
      periodStart: "2026-02-15T00:00:00Z",
      periodEnd: "2026-02-22T00:00:00Z",
    });

    expect(result.events).toHaveLength(0);
  });

  it("calls adapter.collect() and returns events", async () => {
    const event = makeEvent();
    const adapter = makeMockAdapter([event]);
    const adapters = new Map<string, SourceAdapter>([["github", adapter]]);

    const { collectFromSource } = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: adapters,
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await collectFromSource({
      source: "github",
      streams: ["pull_requests"],
      cursorValue: null,
      periodStart: "2026-02-15T00:00:00Z",
      periodEnd: "2026-02-22T00:00:00Z",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("github:pr:test/repo:1");
    expect(adapter.collect).toHaveBeenCalledOnce();
  });
});

describe("insertEvents", () => {
  it("does nothing when events array is empty", async () => {
    const store = makeMockStore();
    const { insertEvents } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await insertEvents({ events: [] });

    expect(store.insertActivityEvents).not.toHaveBeenCalled();
  });

  it("maps events and calls store.insertActivityEvents", async () => {
    const store = makeMockStore();
    const { insertEvents } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await insertEvents({ events: [makeEvent()] });

    expect(store.insertActivityEvents).toHaveBeenCalledOnce();
    const args = vi.mocked(store.insertActivityEvents).mock.calls[0][0];
    expect(args[0].nodeId).toBe(NODE_ID);
    expect(args[0].scopeId).toBe(SCOPE_ID);
    expect(args[0].source).toBe("github");
  });
});

describe("saveCursor", () => {
  it("saves cursor when no existing cursor", async () => {
    const store = makeMockStore();
    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-20T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-20T00:00:00Z"
    );
  });

  it("enforces monotonic cursor — keeps later value", async () => {
    const existingCursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-21T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(existingCursor),
    });

    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    // Try to save an earlier cursor — should keep the existing later one
    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-19T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-21T00:00:00Z" // kept existing, later value
    );
  });

  it("advances cursor when new value is later", async () => {
    const existingCursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-19T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(existingCursor),
    });

    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-21T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-21T00:00:00Z" // advanced to new, later value
    );
  });
});
