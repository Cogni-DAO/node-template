// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/port`
 * Purpose: Port interface for Akash Network deployment lifecycle.
 * Scope: Port interface only — no runtime dependencies. Does NOT contain adapter implementations.
 * Invariants:
 *   - LIFECYCLE_COMPLETE: Port covers create, update, close, and query.
 *   - SDL_FROM_CREW: SDL generation is separate from deployment submission.
 *   - PROVIDER_MARKETPLACE: Bid selection is explicit, not automatic.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type {
  Bid,
  CrewConfig,
  DeploymentInfo,
  SdlOutput,
} from "./akash-deploy.schemas.js";

/**
 * Port for managing Akash Network deployments.
 * Adapters: AkashCliAdapter (shell out to `akash` CLI), MockAkashAdapter (testing).
 */
export interface AkashDeployPort {
  /** Generate Akash SDL YAML from a crew configuration */
  generateSdl(crew: CrewConfig): SdlOutput;

  /** Submit a deployment to the Akash network. Returns deployment info with ID. */
  createDeployment(sdlYaml: string): Promise<DeploymentInfo>;

  /** List bids from providers for a pending deployment */
  listBids(deploymentId: string): Promise<Bid[]>;

  /** Accept a specific provider's bid, creating a lease */
  acceptBid(deploymentId: string, provider: string): Promise<DeploymentInfo>;

  /** Send the manifest to the winning provider so containers start */
  sendManifest(deploymentId: string, sdlYaml: string): Promise<void>;

  /** Get current deployment status and endpoints */
  getDeployment(deploymentId: string): Promise<DeploymentInfo>;

  /** Close a deployment (stops containers, releases escrow) */
  closeDeployment(deploymentId: string): Promise<DeploymentInfo>;

  /** Update a running deployment with new SDL */
  updateDeployment(
    deploymentId: string,
    sdlYaml: string
  ): Promise<DeploymentInfo>;
}

/**
 * Implements ClusterProvider from node-launch spec using Akash SDL.
 * This is the bridge between the generic provisioning workflow and Akash-specific deployment.
 */
export interface AkashClusterProvider {
  /** Akash doesn't have clusters — returns RPC connection info */
  ensureCluster(env: string): Promise<AkashConnection>;

  /** Create a deployment (analogous to k8s namespace) */
  createNamespace(
    conn: AkashConnection,
    name: string,
    crew: CrewConfig
  ): Promise<DeploymentInfo>;

  /** Update deployment SDL */
  applyManifests(
    conn: AkashConnection,
    deploymentId: string,
    sdlYaml: string
  ): Promise<void>;

  /** Inject secrets as env vars in deployment */
  createSecret(
    conn: AkashConnection,
    deploymentId: string,
    data: Record<string, string>
  ): Promise<void>;
}

export interface AkashConnection {
  rpcEndpoint: string;
  chainId: string;
  walletAddress: string;
}
