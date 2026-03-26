// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/routes/health`
 * Purpose: Health check endpoints (livez + readyz).
 * Scope: HTTP handlers — no business logic. Does NOT access external services.
 * Invariants: none
 * Side-effects: io
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export function handleLivez(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}

export function handleReadyz(_req: IncomingMessage, res: ServerResponse): void {
  // TODO: Check Akash RPC connectivity, wallet balance, etc.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      checks: {
        akash_rpc: "ok",
        wallet: "ok",
      },
    })
  );
}
