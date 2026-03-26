// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client`
 * Purpose: Akash Network deployment client — SDL generation, lifecycle management, MCP registry.
 * Scope: Public API surface. Does NOT contain adapter implementations.
 * Invariants: Adapters imported via subpath exports, not from root.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

// Port types
// Schema types
export type {
  AgentConfig,
  AkashDeployPort,
  Bid,
  CrewConfig,
  DeploymentInfo,
  DeploymentStatus,
  McpServerConfig,
  ResourceProfile,
  SdlOutput,
} from "./port/index.js";
// Schemas
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
} from "./port/index.js";
export type { McpRegistryEntry } from "./registry/mcp-registry.js";

// MCP registry
export {
  getOAuthScopes,
  getRequiredEnv,
  listRegisteredMcpServers,
  MCP_REGISTRY,
  resolveMcpServer,
} from "./registry/mcp-registry.js";
// SDL generator (pure function)
export { generateSdl } from "./sdl/sdl-generator.js";
