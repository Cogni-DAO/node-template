// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/codex/codex-mcp-config`
 * Purpose: Generate Codex-native config.toml for MCP server access.
 * Scope: Converts parsed MCP server config (from parseMcpConfigFromEnv) into Codex SDK config.toml format.
 *   Only handles HTTP/SSE MCP servers (stdio not supported by Codex SDK MCP).
 * Invariants:
 *   - CODEX_ENV_SCOPED: Only whitelisted env vars are passed to Codex subprocess
 *   - NO_SECRETS_IN_CONTEXT: Auth via bearer_token_env_var names, values via scoped env whitelist
 *   - MCP_POLICY_SINGLE_SOURCE: Config generated from parseMcpConfigFromEnv, not duplicated
 * Side-effects: none (pure config generation)
 * Links: https://developers.openai.com/codex/mcp, bug.0232
 * @internal
 */

import type { McpServersConfig } from "@cogni/langgraph-graphs";

/**
 * MCP server config entry for Codex config.toml.
 * Maps from our McpServerConfig (parseMcpConfigFromEnv output) to Codex SDK format.
 */
export interface CodexMcpServerEntry {
  readonly url: string;
  readonly bearerTokenEnvVar?: string;
}

/**
 * Full Codex MCP config: server name → entry.
 * Passed to CodexLlmAdapter at construction time.
 */
export type CodexMcpConfig = Record<string, CodexMcpServerEntry>;

/**
 * Env vars that Codex subprocess is allowed to inherit.
 * Everything else is stripped to prevent secret leakage.
 *
 * CODEX_ENV_SCOPED: Codex subprocess must NOT see DATABASE_URL, LITELLM_MASTER_KEY,
 * AUTH_SECRET, or any other server-side secret.
 */
const ENV_WHITELIST = new Set([
  "HOME",
  "PATH",
  "NODE_ENV",
  "TERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "USER",
  "SHELL",
]);

/**
 * Generate Codex config.toml content for MCP server access.
 *
 * Codex SDK reads `$HOME/.codex/config.toml` for MCP server configuration:
 * ```toml
 * [mcp_servers.grafana]
 * url = "http://grafana-mcp:8000/mcp"
 *
 * [mcp_servers.playwright]
 * url = "http://playwright-mcp:3000/mcp"
 * ```
 *
 * @param config - MCP server entries (server name → url + optional auth)
 * @returns TOML string for config.toml, or undefined if no servers
 */
export function generateConfigToml(config: CodexMcpConfig): string | undefined {
  const entries = Object.entries(config);
  if (entries.length === 0) return undefined;

  const sections: string[] = [];
  for (const [name, entry] of entries) {
    const lines = [`[mcp_servers.${name}]`, `url = "${entry.url}"`];
    if (entry.bearerTokenEnvVar) {
      lines.push(`bearer_token_env_var = "${entry.bearerTokenEnvVar}"`);
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n") + "\n";
}

/**
 * Build a scoped env record for Codex subprocess.
 *
 * Only whitelisted env vars + any vars referenced by MCP bearer_token_env_var
 * are included. Everything else is stripped.
 *
 * @param currentEnv - Full process.env
 * @param mcpConfig - MCP config with optional bearerTokenEnvVar references
 * @returns Scoped env record safe for Codex subprocess
 */
export function buildScopedEnv(
  currentEnv: Record<string, string | undefined>,
  mcpConfig?: CodexMcpConfig
): Record<string, string> {
  const scoped: Record<string, string> = {};

  // Copy whitelisted vars
  for (const key of ENV_WHITELIST) {
    const val = currentEnv[key];
    if (val != null) scoped[key] = val;
  }

  // Copy any env vars referenced by MCP bearer_token_env_var
  if (mcpConfig) {
    for (const entry of Object.values(mcpConfig)) {
      if (entry.bearerTokenEnvVar) {
        const val = currentEnv[entry.bearerTokenEnvVar];
        if (val != null) scoped[entry.bearerTokenEnvVar] = val;
      }
    }
  }

  return scoped;
}

/**
 * Convert McpServersConfig (from parseMcpConfigFromEnv) to CodexMcpConfig.
 *
 * Only HTTP/SSE servers are included — Codex SDK MCP doesn't support stdio transports.
 * Headers with "Authorization: Bearer ..." are converted to bearer_token_env_var references.
 *
 * @param mcpServers - Parsed MCP server config from parseMcpConfigFromEnv()
 * @returns CodexMcpConfig with HTTP/SSE servers only, or undefined if none
 */
export function mcpServersToCodexConfig(
  mcpServers: McpServersConfig
): CodexMcpConfig | undefined {
  const config: Record<string, CodexMcpServerEntry> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.transport === "http" || server.transport === "sse") {
      config[name] = { url: server.url };
    }
    // stdio transports skipped — Codex SDK MCP only supports HTTP endpoints
  }

  return Object.keys(config).length > 0 ? config : undefined;
}
