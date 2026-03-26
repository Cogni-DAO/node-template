// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/smoke.test`
 * Purpose: Smoke tests for the akash-deployer HTTP service.
 * Scope: Tests only. Does NOT contain production code.
 * Invariants: none
 * Side-effects: io
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Inline minimal server creation for testing (avoids env config dependency)
async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const { MockAkashAdapter } = await import(
    "@cogni/akash-client/adapters/mock"
  );
  const { handleLivez, handleReadyz } = await import("./routes/health.js");
  const { createDeployRoutes } = await import("./routes/deploy.js");
  const pino = (await import("pino")).default;

  const log = pino({ level: "silent" });
  const deployer = new MockAkashAdapter();
  const routes = createDeployRoutes(deployer, log);

  const server = createServer(async (req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (path === "/livez") return handleLivez(req, res);
    if (path === "/readyz") return handleReadyz(req, res);
    if (method === "POST" && path === "/api/v1/crews/deploy")
      return routes.deployCrew(req, res);
    if (method === "POST" && path === "/api/v1/crews/preview")
      return routes.previewSdl(req, res);
    if (method === "GET" && path === "/api/v1/mcp/registry")
      return routes.listMcpServers(req, res);

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

describe("akash-deployer service", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const result = await startTestServer();
    server = result.server;
    baseUrl = result.baseUrl;
  });

  afterAll(() => {
    server?.close();
  });

  it("GET /livez returns 200", async () => {
    const res = await fetch(`${baseUrl}/livez`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /readyz returns 200", async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /api/v1/mcp/registry returns server list", async () => {
    const res = await fetch(`${baseUrl}/api/v1/mcp/registry`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: unknown[] };
    expect(body.servers.length).toBeGreaterThanOrEqual(10);
  });

  it("POST /api/v1/crews/preview generates SDL without deploying", async () => {
    const crew = {
      name: "test-crew",
      mission: "Test",
      mcpServers: [],
      agents: [
        {
          name: "agent-test",
          image: "ghcr.io/cogni-dao/openclaw:latest",
          mcpConnections: [],
          env: {},
          resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
          exposeGlobal: true,
        },
      ],
      region: "us-west",
      maxBudgetUakt: "1000000",
    };

    const res = await fetch(`${baseUrl}/api/v1/crews/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crew),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { yaml: string; services: string[] };
    expect(body.yaml).toContain("version:");
    expect(body.services).toContain("agent-test");
  });

  it("POST /api/v1/crews/deploy creates deployment with mock adapter", async () => {
    const crew = {
      name: "deploy-test",
      mission: "Integration test",
      mcpServers: [
        {
          name: "mcp-memory",
          image: "ghcr.io/cogni-dao/mcp-golden/memory:latest",
          transport: "stdio",
          port: 3103,
          env: {},
          resources: { cpu: 0.25, memory: "256Mi", storage: "512Mi" },
          requiredAuth: [],
        },
      ],
      agents: [
        {
          name: "agent-deploy-test",
          image: "ghcr.io/cogni-dao/openclaw:latest",
          mcpConnections: ["mcp-memory"],
          env: {},
          resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
          exposeGlobal: true,
        },
      ],
      region: "us-west",
      maxBudgetUakt: "1000000",
    };

    const res = await fetch(`${baseUrl}/api/v1/crews/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crew),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      deploymentId: string;
      provider: string;
      services: string[];
    };
    expect(body.status).toBe("active");
    expect(body.deploymentId).toBeTruthy();
    expect(body.provider).toContain("akash1provider");
    expect(body.services).toContain("mcp-memory");
    expect(body.services).toContain("agent-deploy-test");
  });

  it("POST /api/v1/crews/deploy rejects invalid JSON", async () => {
    const res = await fetch(`${baseUrl}/api/v1/crews/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});
