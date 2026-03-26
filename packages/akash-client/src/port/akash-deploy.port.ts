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
 * Adapters: MockAkashAdapter (testing), AkashSdkAdapter (P1, in services/).
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
