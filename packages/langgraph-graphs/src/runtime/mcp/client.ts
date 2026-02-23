// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/mcp/client`
 * Purpose: Create LangChain tools from external MCP servers.
 * Scope: Spike — bypasses ToolRunner pipeline. Does NOT handle policy, billing, or redaction.
 * Invariants:
 *   - SPIKE_ONLY: This does NOT flow through ToolRunner (no policy, no billing, no redaction)
 *   - MCP tools are prefixed with server name to avoid collisions
 *   - Connection errors are logged and skipped (don't break the agent)
 * Side-effects: IO (connects to MCP servers, spawns subprocesses for stdio transport)
 * Links: {@link ../types.ts McpServersConfig}
 * @internal
 */

import { readFileSync } from "node:fs";

import type { StructuredToolInterface } from "@langchain/core/tools";

import type { McpServerConfig, McpServersConfig } from "./types";

/**
 * Load tools from configured MCP servers.
 *
 * Returns LangChain StructuredToolInterface[] ready to merge with
 * existing tools in createReactAgent.
 *
 * Spike: tools bypass our ToolRunner pipeline entirely.
 * Path B (proj.agentic-interop) will create McpToolSource implementing ToolSourcePort.
 *
 * @param config - Map of server name → transport config
 * @returns LangChain tools from all reachable MCP servers
 */
export async function loadMcpTools(
  config: McpServersConfig
): Promise<StructuredToolInterface[]> {
  if (Object.keys(config).length === 0) {
    return [];
  }

  // Dynamic import to avoid loading MCP deps when not configured
  const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");

  // Convert our config to @langchain/mcp-adapters Connection format.
  // We build plain objects matching the Connection schema then cast,
  // because the Zod-inferred Connection type is hard to construct incrementally.
  const connections: Record<string, unknown> = {};

  for (const [name, serverConfig] of Object.entries(config)) {
    switch (serverConfig.transport) {
      case "stdio":
        connections[name] = {
          transport: "stdio" as const,
          command: serverConfig.command,
          args: serverConfig.args ? [...serverConfig.args] : [],
          ...(serverConfig.env && { env: { ...serverConfig.env } }),
        };
        break;
      case "http":
        connections[name] = {
          transport: "http" as const,
          url: serverConfig.url,
          ...(serverConfig.headers && {
            headers: { ...serverConfig.headers },
          }),
        };
        break;
      case "sse":
        connections[name] = {
          transport: "sse" as const,
          url: serverConfig.url,
          ...(serverConfig.headers && {
            headers: { ...serverConfig.headers },
          }),
        };
        break;
    }
  }

  // Zod-inferred ClientConfig type is hard to construct incrementally from our types
  const clientConfig = {
    mcpServers: connections,
    prefixToolNameWithServerName: true,
    onConnectionError: "ignore",
  };
  // biome-ignore lint/suspicious/noExplicitAny: cast needed — our config objects match the Zod schema at runtime
  const client = new MultiServerMCPClient(clientConfig as any);

  try {
    const tools = await client.getTools();
    // Note: we do NOT close the client here — tools need active connections
    // to execute. The client will be GC'd when the tools are no longer referenced.
    // For production (Path B), we'd manage client lifecycle explicitly.
    return tools as StructuredToolInterface[];
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
    console.error("[mcp-client] Failed to load MCP tools:", error);
    return [];
  }
}

/**
 * Parse MCP server config from environment variable.
 *
 * Expects MCP_SERVERS env var as JSON matching McpServersConfig shape:
 * ```json
 * {
 *   "grafana": {
 *     "transport": "stdio",
 *     "command": "docker",
 *     "args": ["run", "--rm", "-i", "mcp/grafana"]
 *   }
 * }
 * ```
 *
 * Also supports .mcp.json format (Claude Code config) via MCP_CONFIG_PATH:
 * ```json
 * {
 *   "mcpServers": {
 *     "grafana": {
 *       "command": "docker",
 *       "args": ["run", "--rm", "-i", "mcp/grafana"]
 *     }
 *   }
 * }
 * ```
 *
 * @returns Parsed config, or empty object if not configured
 */
export function parseMcpConfigFromEnv(): McpServersConfig {
  // Direct JSON config takes priority
  // biome-ignore lint/style/noProcessEnv: env-based config is the design
  const serversJson = process.env.MCP_SERVERS;
  if (serversJson) {
    try {
      return JSON.parse(serversJson) as McpServersConfig;
    } catch {
      // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
      console.error("[mcp-client] Failed to parse MCP_SERVERS env var as JSON");
      return {};
    }
  }

  // Fall back to .mcp.json file path
  // biome-ignore lint/style/noProcessEnv: env-based config is the design
  const configPath = process.env.MCP_CONFIG_PATH;
  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));

      // Support .mcp.json format: { mcpServers: { ... } }
      const servers = raw.mcpServers ?? raw;

      // Convert .mcp.json format (no transport field) to our format
      const config: Record<string, McpServerConfig> = {};
      for (const [name, rawServer] of Object.entries(
        servers as Record<string, Record<string, unknown>>
      )) {
        if (rawServer.command) {
          config[name] = {
            transport: "stdio" as const,
            command: rawServer.command as string,
            args: rawServer.args as readonly string[] | undefined,
            env: rawServer.env as Readonly<Record<string, string>> | undefined,
          };
        } else if (rawServer.url) {
          config[name] = {
            transport: "http" as const,
            url: rawServer.url as string,
            headers: rawServer.headers as
              | Readonly<Record<string, string>>
              | undefined,
          };
        }
      }
      return config;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
      console.error(
        `[mcp-client] Failed to read MCP config from ${configPath}:`,
        error
      );
      return {};
    }
  }

  return {};
}
