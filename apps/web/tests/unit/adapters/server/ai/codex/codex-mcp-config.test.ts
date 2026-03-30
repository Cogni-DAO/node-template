// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { McpServersConfig } from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";
import {
  buildScopedEnv,
  generateConfigToml,
  mcpServersToCodexConfig,
} from "@/adapters/server/ai/codex/codex-mcp-config";

describe("generateConfigToml", () => {
  it("returns undefined for empty config", () => {
    expect(generateConfigToml({})).toBeUndefined();
  });

  it("generates valid TOML for a single HTTP server", () => {
    const toml = generateConfigToml({
      grafana: { url: "http://grafana-mcp:8000/mcp" },
    });
    expect(toml).toBe(
      '[mcp_servers.grafana]\nurl = "http://grafana-mcp:8000/mcp"\n'
    );
  });

  it("generates TOML for multiple servers", () => {
    const toml = generateConfigToml({
      grafana: { url: "http://grafana-mcp:8000/mcp" },
      playwright: { url: "http://playwright-mcp:3000/mcp" },
    });
    expect(toml).toContain("[mcp_servers.grafana]");
    expect(toml).toContain("[mcp_servers.playwright]");
    expect(toml).toContain('url = "http://grafana-mcp:8000/mcp"');
    expect(toml).toContain('url = "http://playwright-mcp:3000/mcp"');
  });

  it("includes bearer_token_env_var when set", () => {
    const toml = generateConfigToml({
      grafana: {
        url: "http://grafana-mcp:8000/mcp",
        bearerTokenEnvVar: "GRAFANA_SERVICE_ACCOUNT_TOKEN",
      },
    });
    expect(toml).toContain(
      'bearer_token_env_var = "GRAFANA_SERVICE_ACCOUNT_TOKEN"'
    );
  });
});

describe("buildScopedEnv", () => {
  it("only includes whitelisted env vars", () => {
    const env: Record<string, string> = {
      HOME: "/home/user",
      PATH: "/usr/bin",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://secret",
      LITELLM_MASTER_KEY: "sk-secret",
      AUTH_SECRET: "top-secret",
    };
    const scoped = buildScopedEnv(env);
    expect(scoped.HOME).toBe("/home/user");
    expect(scoped.PATH).toBe("/usr/bin");
    expect(scoped.NODE_ENV).toBe("production");
    expect(scoped).not.toHaveProperty("DATABASE_URL");
    expect(scoped).not.toHaveProperty("LITELLM_MASTER_KEY");
    expect(scoped).not.toHaveProperty("AUTH_SECRET");
  });

  it("includes bearer token env vars from MCP config", () => {
    const env: Record<string, string> = {
      HOME: "/home/user",
      PATH: "/usr/bin",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_abc123",
      DATABASE_URL: "postgres://secret",
    };
    const scoped = buildScopedEnv(env, {
      grafana: {
        url: "http://grafana-mcp:8000/mcp",
        bearerTokenEnvVar: "GRAFANA_SERVICE_ACCOUNT_TOKEN",
      },
    });
    expect(scoped.GRAFANA_SERVICE_ACCOUNT_TOKEN).toBe("glsa_abc123");
    expect(scoped).not.toHaveProperty("DATABASE_URL");
  });

  it("handles undefined env values gracefully", () => {
    const env: Record<string, string | undefined> = {
      HOME: "/home/user",
      MISSING_VAR: undefined,
    };
    const scoped = buildScopedEnv(env);
    expect(scoped.HOME).toBe("/home/user");
    expect(scoped).not.toHaveProperty("MISSING_VAR");
  });
});

describe("mcpServersToCodexConfig", () => {
  it("converts HTTP servers to CodexMcpConfig", () => {
    const servers: McpServersConfig = {
      grafana: {
        transport: "http",
        url: "http://grafana-mcp:8000/mcp",
      },
      playwright: {
        transport: "http",
        url: "http://playwright-mcp:3000/mcp",
      },
    };
    const config = mcpServersToCodexConfig(servers);
    expect(config).toEqual({
      grafana: { url: "http://grafana-mcp:8000/mcp" },
      playwright: { url: "http://playwright-mcp:3000/mcp" },
    });
  });

  it("converts SSE servers", () => {
    const servers: McpServersConfig = {
      grafana: {
        transport: "sse",
        url: "http://grafana-mcp:8000/sse",
      },
    };
    const config = mcpServersToCodexConfig(servers);
    expect(config).toEqual({
      grafana: { url: "http://grafana-mcp:8000/sse" },
    });
  });

  it("skips stdio servers", () => {
    const servers: McpServersConfig = {
      everything: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    };
    const config = mcpServersToCodexConfig(servers);
    expect(config).toBeUndefined();
  });

  it("returns undefined when no servers are present", () => {
    expect(mcpServersToCodexConfig({})).toBeUndefined();
  });

  it("mixes HTTP and stdio — only HTTP included", () => {
    const servers: McpServersConfig = {
      grafana: {
        transport: "http",
        url: "http://grafana-mcp:8000/mcp",
      },
      everything: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    };
    const config = mcpServersToCodexConfig(servers);
    expect(config).toEqual({
      grafana: { url: "http://grafana-mcp:8000/mcp" },
    });
  });
});
