// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/registry/mcp-registry.test`
 * Purpose: Unit tests for MCP server registry lookup and resolution.
 * Scope: Tests only. Does NOT contain production code.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { describe, expect, it } from "vitest";
import {
  getOAuthScopes,
  getRequiredEnv,
  listRegisteredMcpServers,
  MCP_REGISTRY,
  resolveMcpServer,
} from "./mcp-registry.js";

describe("MCP Registry", () => {
  it("has at least 10 registered servers", () => {
    expect(MCP_REGISTRY.size).toBeGreaterThanOrEqual(10);
  });

  it("resolves known MCP server to golden image", () => {
    const config = resolveMcpServer("github");

    expect(config.name).toBe("mcp-github");
    expect(config.image).toContain("mcp-golden/github");
    expect(config.port).toBe(3101);
  });

  it("resolves unknown server to generic runner", () => {
    const config = resolveMcpServer("some-custom-server");

    expect(config.name).toBe("mcp-some-custom-server");
    expect(config.image).toContain("generic-runner");
    expect(config.env.MCP_PACKAGE).toBe("some-custom-server");
  });

  it("lists all registered servers", () => {
    const servers = listRegisteredMcpServers();
    expect(servers.length).toBeGreaterThanOrEqual(10);
    expect(servers.some((s) => s.name === "GitHub")).toBe(true);
    expect(servers.some((s) => s.name === "Filesystem")).toBe(true);
  });

  it("returns required env vars for servers that need them", () => {
    expect(getRequiredEnv("github")).toContain("GITHUB_TOKEN");
    expect(getRequiredEnv("filesystem")).toHaveLength(0);
    expect(getRequiredEnv("unknown")).toHaveLength(0);
  });

  it("returns OAuth scopes for servers that need them", () => {
    expect(getOAuthScopes("github")).toContain("repo");
    expect(getOAuthScopes("slack")).toContain("chat:write");
    expect(getOAuthScopes("filesystem")).toHaveLength(0);
  });

  it("applies env overrides when resolving", () => {
    const config = resolveMcpServer("github", { GITHUB_TOKEN: "test123" });
    expect(config.env.GITHUB_TOKEN).toBe("test123");
  });
});
