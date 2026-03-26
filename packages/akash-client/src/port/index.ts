// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/port/index`
 * Purpose: Barrel export for Akash deploy port types and schemas.
 * Scope: Re-exports only. Does NOT implement logic.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

export type { AkashDeployPort } from "./akash-deploy.port.js";
export type {
  AgentConfig,
  Bid,
  CrewConfig,
  DeploymentInfo,
  DeploymentStatus,
  McpServerConfig,
  ResourceProfile,
  SdlOutput,
} from "./akash-deploy.schemas.js";
export {
  agentConfigSchema,
  bidSchema,
  crewConfigSchema,
  deploymentInfoSchema,
  deploymentStatusSchema,
  mcpServerConfigSchema,
  mcpTransportSchema,
  resourceProfileSchema,
  sdlOutputSchema,
} from "./akash-deploy.schemas.js";
