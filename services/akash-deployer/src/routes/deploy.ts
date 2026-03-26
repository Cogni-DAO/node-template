// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/routes/deploy`
 * Purpose: Crew deployment API endpoints.
 * Scope: HTTP handlers — delegates to AkashDeployPort. Does NOT contain deployment logic directly.
 * Invariants: none
 * Side-effects: io
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AkashDeployPort, CrewConfig } from "@cogni/akash-client";
import {
  crewConfigSchema,
  listRegisteredMcpServers,
} from "@cogni/akash-client";
import type { Logger } from "pino";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createDeployRoutes(deployer: AkashDeployPort, log: Logger) {
  return {
    /** POST /api/v1/crews/deploy — Deploy a new crew to Akash */
    async deployCrew(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const crew = crewConfigSchema.parse(parsed);

        log.info(
          {
            crewName: crew.name,
            agents: crew.agents.length,
            mcps: crew.mcpServers.length,
          },
          "Deploying crew"
        );

        // 1. Generate SDL
        const sdl = deployer.generateSdl(crew);
        log.info(
          { services: sdl.services, estimatedCost: sdl.estimatedCostPerBlock },
          "SDL generated"
        );

        // 2. Create deployment
        const deployment = await deployer.createDeployment(sdl.yaml);
        log.info(
          { deploymentId: deployment.deploymentId },
          "Deployment created"
        );

        // 3. Wait for bids (in production, this would be async/webhook)
        const bids = await deployer.listBids(deployment.deploymentId);
        log.info({ bidCount: bids.length }, "Received bids");

        if (bids.length === 0) {
          jsonResponse(res, 202, {
            status: "pending_bids",
            deploymentId: deployment.deploymentId,
            sdl: sdl.yaml,
            message: "Deployment created, waiting for provider bids",
          });
          return;
        }

        // 4. Accept cheapest bid
        const sorted = bids.sort(
          (a, b) => Number(a.price.amount) - Number(b.price.amount)
        );
        const cheapestBid = sorted[0];
        if (!cheapestBid) throw new Error("No bids available");
        const lease = await deployer.acceptBid(
          deployment.deploymentId,
          cheapestBid.provider
        );
        log.info(
          { provider: cheapestBid.provider, price: cheapestBid.price },
          "Bid accepted"
        );

        // 5. Send manifest
        await deployer.sendManifest(deployment.deploymentId, sdl.yaml);
        log.info("Manifest sent to provider");

        jsonResponse(res, 201, {
          status: "active",
          deploymentId: deployment.deploymentId,
          provider: cheapestBid.provider,
          leaseId: lease.leaseId,
          services: sdl.services,
          estimatedCostPerBlock: sdl.estimatedCostPerBlock,
        });
      } catch (err) {
        log.error({ err }, "Failed to deploy crew");
        if (err instanceof SyntaxError) {
          jsonResponse(res, 400, { error: "Invalid JSON body" });
        } else if (err instanceof Error && err.name === "ZodError") {
          jsonResponse(res, 400, {
            error: "Invalid crew config",
            details: err.message,
          });
        } else {
          jsonResponse(res, 500, {
            error: "Deployment failed",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    },

    /** GET /api/v1/crews/:deploymentId — Get deployment status */
    async getDeployment(
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      try {
        const url = new URL(
          req.url ?? "/",
          `http://${req.headers.host ?? "localhost"}`
        );
        const deploymentId = url.pathname.split("/").pop();
        if (!deploymentId) {
          jsonResponse(res, 400, { error: "Missing deployment ID" });
          return;
        }

        const deployment = await deployer.getDeployment(
          decodeURIComponent(deploymentId)
        );
        jsonResponse(res, 200, deployment);
      } catch (err) {
        log.error({ err }, "Failed to get deployment");
        jsonResponse(res, 500, {
          error: "Failed to get deployment",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },

    /** DELETE /api/v1/crews/:deploymentId — Close a deployment */
    async closeDeployment(
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      try {
        const url = new URL(
          req.url ?? "/",
          `http://${req.headers.host ?? "localhost"}`
        );
        const deploymentId = url.pathname.split("/").pop();
        if (!deploymentId) {
          jsonResponse(res, 400, { error: "Missing deployment ID" });
          return;
        }

        const deployment = await deployer.closeDeployment(
          decodeURIComponent(deploymentId)
        );
        log.info({ deploymentId }, "Deployment closed");
        jsonResponse(res, 200, deployment);
      } catch (err) {
        log.error({ err }, "Failed to close deployment");
        jsonResponse(res, 500, {
          error: "Failed to close deployment",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },

    /** POST /api/v1/crews/preview — Generate SDL without deploying */
    async previewSdl(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const crew = crewConfigSchema.parse(parsed) as CrewConfig;
        const sdl = deployer.generateSdl(crew);

        jsonResponse(res, 200, {
          yaml: sdl.yaml,
          services: sdl.services,
          estimatedCostPerBlock: sdl.estimatedCostPerBlock,
        });
      } catch (err) {
        log.error({ err }, "Failed to generate SDL preview");
        if (err instanceof SyntaxError) {
          jsonResponse(res, 400, { error: "Invalid JSON body" });
        } else {
          jsonResponse(res, 400, {
            error: "Invalid crew config",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    },

    /** GET /api/v1/mcp/registry — List available MCP servers */
    listMcpServers(_req: IncomingMessage, res: ServerResponse): void {
      const servers = listRegisteredMcpServers();
      jsonResponse(res, 200, { servers });
    },
  };
}
