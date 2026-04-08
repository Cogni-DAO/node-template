// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/public.graphs`
 * Purpose: Contract tests for GET /api/v1/public/graphs endpoint.
 * Scope: Validates response shape, graph_name catalog, hint field, cache headers.
 * Invariants: 200 always (static); hint field present; graph list non-empty.
 * Side-effects: none
 * Links: /api/v1/public/graphs route
 * @public
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock rate limiter to always allow requests
vi.mock("@/bootstrap/http/rateLimiter", () => ({
  publicApiLimiter: { consume: vi.fn(() => true) },
  extractClientIp: vi.fn(() => "test-ip"),
  TokenBucketRateLimiter: vi.fn(),
}));

// Mock container
vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    log: {
      child: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    clock: { now: () => new Date() },
    config: {
      unhandledErrorPolicy: "rethrow",
      rateLimitBypass: {
        enabled: false,
        headerName: "x-stack-test",
        headerValue: "1",
      },
      DEPLOY_ENVIRONMENT: "test",
    },
  })),
}));

import { GET } from "@/app/api/v1/public/graphs/route";

function makeReq() {
  return new NextRequest("http://localhost:3000/api/v1/public/graphs");
}

describe("GET /api/v1/public/graphs contract tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with graphs array", async () => {
    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("graphs");
    expect(Array.isArray(data.graphs)).toBe(true);
    expect(data.graphs.length).toBeGreaterThan(0);
  });

  it("each graph entry has graph_name and description", async () => {
    const res = await GET(makeReq());
    const data = await res.json();

    for (const graph of data.graphs) {
      expect(graph).toHaveProperty("graph_name");
      expect(typeof graph.graph_name).toBe("string");
      expect(graph).toHaveProperty("description");
      expect(typeof graph.description).toBe("string");
    }
  });

  it("includes poet graph (primary demo target)", async () => {
    const res = await GET(makeReq());
    const data = await res.json();

    const poet = data.graphs.find(
      (g: { graph_name: string }) => g.graph_name === "poet"
    );
    expect(poet).toBeDefined();
  });

  it("includes hint field pointing to models endpoint", async () => {
    const res = await GET(makeReq());
    const data = await res.json();

    expect(data).toHaveProperty("hint");
    expect(data.hint).toContain("/api/v1/public/models");
  });

  it("includes cache-control header", async () => {
    const res = await GET(makeReq());

    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=300");
  });
});
