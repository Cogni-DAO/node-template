// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/main`
 * Purpose: HTTP server entrypoint for the Akash deployer service.
 * Scope: Server bootstrap — wires config, adapter, routes. Does NOT contain business logic.
 * Invariants:
 *   - HEALTH_FIRST: /livez and /readyz always available, even before full init.
 *   - GRACEFUL_SHUTDOWN: SIGTERM triggers clean disconnect.
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 */

import crypto from "node:crypto";
import { createServer } from "node:http";
import { MockAkashAdapter } from "@cogni/akash-client/adapters/mock";
import pino from "pino";
import { loadConfig } from "./config/env.js";
import { createDeployRoutes } from "./routes/deploy.js";
import { handleLivez, handleReadyz } from "./routes/health.js";

const config = loadConfig();

const pinoOpts: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
};
if (process.env.NODE_ENV !== "production") {
  pinoOpts.transport = { target: "pino/file", options: { destination: 1 } };
}
const log = pino(pinoOpts);

// Wire up the deployer adapter
// TODO: Replace with AkashSdkAdapter at P1 when @akashnetwork/akashjs is integrated
const deployer = new MockAkashAdapter();
const deployRoutes = createDeployRoutes(deployer, log);

/** Constant-time token comparison to prevent timing attacks */
function verifyToken(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Extract crew deployment ID from path like /api/v1/crews/{id} */
const CREW_ID_PATTERN = /^\/api\/v1\/crews\/([^/]+)$/;

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  );
  const method = req.method ?? "GET";
  const path = url.pathname;

  // Health endpoints — always public
  if (path === "/livez") return handleLivez(req, res);
  if (path === "/readyz") return handleReadyz(req, res);

  // Auth check for API endpoints
  if (path.startsWith("/api/")) {
    if (config.INTERNAL_OPS_TOKEN) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (!verifyToken(token, config.INTERNAL_OPS_TOKEN)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
  }

  // Deploy routes — exact matches first, then parameterized
  if (method === "POST" && path === "/api/v1/crews/deploy") {
    return deployRoutes.deployCrew(req, res);
  }
  if (method === "POST" && path === "/api/v1/crews/preview") {
    return deployRoutes.previewSdl(req, res);
  }
  if (method === "GET" && path === "/api/v1/mcp/registry") {
    return deployRoutes.listMcpServers(req, res);
  }

  // Parameterized crew routes
  const crewMatch = CREW_ID_PATTERN.exec(path);
  if (crewMatch) {
    if (method === "GET") return deployRoutes.getDeployment(req, res);
    if (method === "DELETE") return deployRoutes.closeDeployment(req, res);
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(config.PORT, config.HOST, () => {
  log.info(
    { port: config.PORT, host: config.HOST },
    "Akash deployer service started"
  );
});

// Graceful shutdown
const shutdown = () => {
  log.info("Shutting down...");
  server.close(() => {
    log.info("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
