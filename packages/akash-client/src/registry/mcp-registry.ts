// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/registry`
 * Purpose: Built-in registry of well-known MCP servers with golden image mappings.
 * Scope: Static data + lookup functions. Does NOT perform network calls.
 * Invariants:
 *   - REGISTRY_FIRST: Resolve from built-in registry before falling back to generic runner.
 *   - GOLDEN_IMAGES: Pre-built images for common servers avoid build-on-deploy.
 *   - IMMUTABLE: Registry entries are frozen at build time.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type { McpServerConfig } from "../port/akash-deploy.schemas.js";

export interface McpRegistryEntry {
  /** Human-readable name */
  name: string;
  /** npm package name */
  package: string;
  /** Pre-built golden image tag (if available) */
  goldenImage: string;
  /** Transport protocol */
  transport: "stdio" | "sse" | "streamable-http";
  /** Default internal port */
  defaultPort: number;
  /** Required environment variables (keys only) */
  requiredEnv: string[];
  /** OAuth scopes if the server needs user authorization */
  oauthScopes: string[];
  /** Default resource profile */
  resources: { cpu: number; memory: string; storage: string };
}

/**
 * Built-in registry of well-known MCP servers.
 * These have pre-built golden images in GHCR for fast deployment.
 */
export const MCP_REGISTRY: ReadonlyMap<string, McpRegistryEntry> = new Map([
  [
    "filesystem",
    {
      name: "Filesystem",
      package: "@modelcontextprotocol/server-filesystem",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/filesystem:latest",
      transport: "stdio",
      defaultPort: 3100,
      requiredEnv: [],
      oauthScopes: [],
      resources: { cpu: 0.5, memory: "256Mi", storage: "1Gi" },
    },
  ],
  [
    "github",
    {
      name: "GitHub",
      package: "@modelcontextprotocol/server-github",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/github:latest",
      transport: "stdio",
      defaultPort: 3101,
      requiredEnv: ["GITHUB_TOKEN"],
      oauthScopes: ["repo", "read:org"],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
  [
    "postgres",
    {
      name: "PostgreSQL",
      package: "@modelcontextprotocol/server-postgres",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/postgres:latest",
      transport: "stdio",
      defaultPort: 3102,
      requiredEnv: ["DATABASE_URL"],
      oauthScopes: [],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
  [
    "memory",
    {
      name: "Memory",
      package: "@modelcontextprotocol/server-memory",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/memory:latest",
      transport: "stdio",
      defaultPort: 3103,
      requiredEnv: [],
      oauthScopes: [],
      resources: { cpu: 0.25, memory: "256Mi", storage: "512Mi" },
    },
  ],
  [
    "fetch",
    {
      name: "Fetch",
      package: "@modelcontextprotocol/server-fetch",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/fetch:latest",
      transport: "stdio",
      defaultPort: 3104,
      requiredEnv: [],
      oauthScopes: [],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
  [
    "brave-search",
    {
      name: "Brave Search",
      package: "@modelcontextprotocol/server-brave-search",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/brave-search:latest",
      transport: "stdio",
      defaultPort: 3105,
      requiredEnv: ["BRAVE_API_KEY"],
      oauthScopes: [],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
  [
    "slack",
    {
      name: "Slack",
      package: "@modelcontextprotocol/server-slack",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/slack:latest",
      transport: "stdio",
      defaultPort: 3106,
      requiredEnv: ["SLACK_BOT_TOKEN"],
      oauthScopes: ["channels:read", "chat:write"],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
  [
    "google-drive",
    {
      name: "Google Drive",
      package: "@modelcontextprotocol/server-gdrive",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/google-drive:latest",
      transport: "stdio",
      defaultPort: 3107,
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      oauthScopes: ["drive.readonly"],
      resources: { cpu: 0.5, memory: "512Mi", storage: "2Gi" },
    },
  ],
  [
    "puppeteer",
    {
      name: "Puppeteer",
      package: "@modelcontextprotocol/server-puppeteer",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/puppeteer:latest",
      transport: "stdio",
      defaultPort: 3108,
      requiredEnv: [],
      oauthScopes: [],
      resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
    },
  ],
  [
    "grafana",
    {
      name: "Grafana",
      package: "mcp/grafana",
      goldenImage: "ghcr.io/cogni-dao/mcp-golden/grafana:latest",
      transport: "stdio",
      defaultPort: 3109,
      requiredEnv: ["GRAFANA_URL", "GRAFANA_API_KEY"],
      oauthScopes: [],
      resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    },
  ],
]);

/** Generic runner image for MCP servers not in the registry */
const GENERIC_MCP_RUNNER_IMAGE =
  "ghcr.io/cogni-dao/mcp-golden/generic-runner:latest";

/**
 * Resolve an MCP server name to a full McpServerConfig.
 * Looks up the built-in registry first, falls back to generic npx runner.
 */
export function resolveMcpServer(
  name: string,
  envOverrides?: Record<string, string>
): McpServerConfig {
  const entry = MCP_REGISTRY.get(name.toLowerCase());

  if (entry) {
    return {
      name: `mcp-${name.toLowerCase()}`,
      image: entry.goldenImage,
      transport: entry.transport,
      port: entry.defaultPort,
      env: envOverrides ?? {},
      resources: entry.resources,
      requiredAuth: entry.oauthScopes,
    };
  }

  // Fallback: assume it's an npm package, use generic runner
  return {
    name: `mcp-${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    image: GENERIC_MCP_RUNNER_IMAGE,
    transport: "stdio",
    port: 3100,
    env: {
      MCP_PACKAGE: name,
      ...(envOverrides ?? {}),
    },
    resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
    requiredAuth: [],
  };
}

/**
 * List all available MCP servers in the registry.
 */
export function listRegisteredMcpServers(): McpRegistryEntry[] {
  return [...MCP_REGISTRY.values()];
}

/**
 * Get required environment variables for an MCP server.
 * Returns empty array for unknown servers.
 */
export function getRequiredEnv(name: string): string[] {
  return MCP_REGISTRY.get(name.toLowerCase())?.requiredEnv ?? [];
}

/**
 * Get OAuth scopes required for an MCP server.
 * Returns empty array for servers that don't need OAuth.
 */
export function getOAuthScopes(name: string): string[] {
  return MCP_REGISTRY.get(name.toLowerCase())?.oauthScopes ?? [];
}
