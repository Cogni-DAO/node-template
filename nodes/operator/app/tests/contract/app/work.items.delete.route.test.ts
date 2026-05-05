// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/work.items.delete.route`
 * Purpose: Route-level contract tests for DELETE /api/v1/work/items/:id.
 * Scope: Verifies auth, success, not-found, and backend-not-ready translation.
 *   Uses next-test-api-route-handler with mocked container + session.
 * Invariants:
 *   - AUTH_REQUIRED: 401 when no session.
 *   - DELETE_SUCCESS_RETURNS_ID: success body matches contract.
 *   - DELETE_MISSING_RETURNS_404: adapter false → 404, not 500.
 *   - DELETE_NOT_CONFIGURED_RETURNS_503: DoltgresNotConfiguredError → 503.
 * Side-effects: none
 * Links: nodes/operator/app/src/app/api/v1/work/items/[id]/route.ts
 * @internal
 */

import { TEST_SESSION_USER_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as session from "@/app/_lib/auth/session";
import * as appHandler from "@/app/api/v1/work/items/[id]/route";

const deleteMock = vi.fn();

vi.mock("@/bootstrap/container", () => {
  const log = {
    child: vi.fn(() => log),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  return {
    getContainer: vi.fn(() => ({
      log,
      clock: { now: vi.fn(() => new Date("2026-05-05T00:00:00Z")) },
      config: { unhandledErrorPolicy: "rethrow" },
      workItemQuery: { list: vi.fn(), get: vi.fn() },
      doltgresWorkItems: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        patch: vi.fn(),
        delete: deleteMock,
      },
    })),
  };
});

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn().mockResolvedValue(TEST_SESSION_USER_1),
}));

describe("DELETE /api/v1/work/items/:id", () => {
  beforeEach(() => {
    deleteMock.mockReset();
    vi.mocked(session.getSessionUser).mockResolvedValue(TEST_SESSION_USER_1);
  });

  it("returns {id, deleted: true} on success", async () => {
    deleteMock.mockResolvedValue(true);
    await testApiHandler({
      appHandler,
      params: { id: "bug.0002" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "bug.0002", deleted: true });
      },
    });
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it("returns 404 when adapter reports row missing", async () => {
    deleteMock.mockResolvedValue(false);
    await testApiHandler({
      appHandler,
      params: { id: "bug.9999" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 503 when Doltgres is not configured", async () => {
    const err = new Error("doltgres backend not configured");
    err.name = "DoltgresNotConfiguredError";
    deleteMock.mockRejectedValue(err);
    await testApiHandler({
      appHandler,
      params: { id: "bug.0002" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(503);
      },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(session.getSessionUser).mockResolvedValue(null);
    await testApiHandler({
      appHandler,
      params: { id: "bug.0002" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });
});
