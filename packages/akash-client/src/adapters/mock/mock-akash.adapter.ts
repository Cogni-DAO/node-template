// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/adapters/mock`
 * Purpose: In-memory mock for AkashDeployPort, used in tests and local dev.
 * Scope: Test adapter — no network or CLI dependencies. Does NOT call the Akash CLI.
 * Invariants:
 *   - IN_MEMORY: All state held in Maps, no persistence.
 *   - DETERMINISTIC: Same inputs produce predictable outputs.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type { AkashDeployPort } from "../../port/akash-deploy.port.js";
import type {
  Bid,
  CrewConfig,
  DeploymentInfo,
  SdlOutput,
} from "../../port/akash-deploy.schemas.js";
import { generateSdl } from "../../sdl/sdl-generator.js";

export class MockAkashAdapter implements AkashDeployPort {
  readonly deployments = new Map<string, DeploymentInfo>();
  readonly sdls = new Map<string, string>();
  private deploymentCounter = 1000;

  generateSdl(crew: CrewConfig): SdlOutput {
    return generateSdl(crew);
  }

  async createDeployment(sdlYaml: string): Promise<DeploymentInfo> {
    const dseq = (++this.deploymentCounter).toString();
    const deploymentId = `akash1mock000000000000000000000000000/${dseq}`;
    const now = new Date().toISOString();

    const info: DeploymentInfo = {
      deploymentId,
      status: "pending",
      crewName: "",
      endpoints: {},
      createdAt: now,
      updatedAt: now,
    };

    this.deployments.set(deploymentId, info);
    this.sdls.set(deploymentId, sdlYaml);

    return info;
  }

  async listBids(deploymentId: string): Promise<Bid[]> {
    if (!this.deployments.has(deploymentId)) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    // Return mock bids from 3 providers
    return [
      {
        provider: "akash1provider-alpha",
        price: { amount: "150", denom: "uakt" },
        state: "open",
      },
      {
        provider: "akash1provider-beta",
        price: { amount: "120", denom: "uakt" },
        state: "open",
      },
      {
        provider: "akash1provider-gamma",
        price: { amount: "180", denom: "uakt" },
        state: "open",
      },
    ];
  }

  async acceptBid(
    deploymentId: string,
    provider: string
  ): Promise<DeploymentInfo> {
    const existing = this.deployments.get(deploymentId);
    if (!existing) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    const updated: DeploymentInfo = {
      ...existing,
      status: "active",
      provider,
      leaseId: `${deploymentId}/1/1/${provider}`,
      updatedAt: new Date().toISOString(),
    };

    this.deployments.set(deploymentId, updated);
    return updated;
  }

  async sendManifest(deploymentId: string, _sdlYaml: string): Promise<void> {
    if (!this.deployments.has(deploymentId)) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    // No-op in mock — manifest "sent" successfully
  }

  async getDeployment(deploymentId: string): Promise<DeploymentInfo> {
    const info = this.deployments.get(deploymentId);
    if (!info) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    // If active, generate mock endpoints
    if (info.status === "active" && Object.keys(info.endpoints).length === 0) {
      const sdl = this.sdls.get(deploymentId);
      if (sdl) {
        info.endpoints = {
          "agent-default": `https://${deploymentId.split("/")[1]}.provider.akash.mock:443`,
        };
      }
    }

    return info;
  }

  async closeDeployment(deploymentId: string): Promise<DeploymentInfo> {
    const existing = this.deployments.get(deploymentId);
    if (!existing) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    const updated: DeploymentInfo = {
      ...existing,
      status: "closed",
      updatedAt: new Date().toISOString(),
    };

    this.deployments.set(deploymentId, updated);
    return updated;
  }

  async updateDeployment(
    deploymentId: string,
    sdlYaml: string
  ): Promise<DeploymentInfo> {
    const existing = this.deployments.get(deploymentId);
    if (!existing) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.sdls.set(deploymentId, sdlYaml);

    const updated: DeploymentInfo = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    this.deployments.set(deploymentId, updated);
    return updated;
  }

  /** Test helper: reset all state */
  reset(): void {
    this.deployments.clear();
    this.sdls.clear();
    this.deploymentCounter = 1000;
  }
}
