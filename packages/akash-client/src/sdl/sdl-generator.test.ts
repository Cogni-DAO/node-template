// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/sdl/sdl-generator.test`
 * Purpose: Unit tests for SDL generation from CrewConfig.
 * Scope: Tests only. Does NOT contain production code.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { CrewConfig } from "../port/akash-deploy.schemas.js";
import { generateSdl } from "./sdl-generator.js";

describe("generateSdl", () => {
  const minimalCrew: CrewConfig = {
    name: "test-crew",
    mission: "Test deployment",
    mcpServers: [],
    agents: [
      {
        name: "agent-test",
        image: "ghcr.io/cogni-dao/openclaw:latest",
        mcpConnections: [],
        env: {},
        resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
        exposeGlobal: true,
      },
    ],
    region: "us-west",
    maxBudgetUakt: "1000000",
  };

  it("generates valid SDL with a single agent", () => {
    const result = generateSdl(minimalCrew);

    expect(result.services).toContain("agent-test");
    expect(result.estimatedCostPerBlock).toBe("200");
    expect(result.yaml).toContain("version:");

    // SDL should parse as valid YAML
    const parsed = parse(result.yaml) as Record<string, unknown>;
    expect(parsed.version).toBe("2.0");
    expect(parsed.services).toBeDefined();
    expect(parsed.profiles).toBeDefined();
    expect(parsed.deployment).toBeDefined();
  });

  it("generates SDL with MCP servers connected to agents", () => {
    const crew: CrewConfig = {
      name: "research-crew",
      mission: "Research deployment",
      mcpServers: [
        {
          name: "mcp-github",
          image: "ghcr.io/cogni-dao/mcp-golden/github:latest",
          transport: "stdio",
          port: 3101,
          env: { GITHUB_TOKEN: "test-token" },
          resources: { cpu: 0.5, memory: "512Mi", storage: "1Gi" },
          requiredAuth: ["repo"],
        },
        {
          name: "mcp-filesystem",
          image: "ghcr.io/cogni-dao/mcp-golden/filesystem:latest",
          transport: "stdio",
          port: 3100,
          env: {},
          resources: { cpu: 0.5, memory: "256Mi", storage: "1Gi" },
          requiredAuth: [],
        },
      ],
      agents: [
        {
          name: "agent-research",
          image: "ghcr.io/cogni-dao/openclaw:latest",
          mcpConnections: ["mcp-github", "mcp-filesystem"],
          env: {},
          resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
          exposeGlobal: true,
        },
      ],
      region: "us-west",
      maxBudgetUakt: "1000000",
    };

    const result = generateSdl(crew);

    expect(result.services).toHaveLength(3);
    expect(result.services).toContain("mcp-github");
    expect(result.services).toContain("mcp-filesystem");
    expect(result.services).toContain("agent-research");

    // Total cost: 100 + 100 + 200 = 400
    expect(result.estimatedCostPerBlock).toBe("400");

    // Parse and verify structure
    const parsed = parse(result.yaml) as {
      services: Record<string, { env?: string[]; expose: unknown[] }>;
    };

    // Agent should have MCP_SERVERS env var
    const agentEnv = parsed.services["agent-research"]?.env;
    expect(agentEnv).toBeDefined();
    expect(agentEnv?.some((e: string) => e.startsWith("MCP_SERVERS="))).toBe(
      true
    );

    // MCP GitHub should have GITHUB_TOKEN env
    const githubEnv = parsed.services["mcp-github"]?.env;
    expect(githubEnv).toBeDefined();
    expect(githubEnv?.some((e: string) => e.startsWith("GITHUB_TOKEN="))).toBe(
      true
    );

    // MCP servers should expose only to agents, not globally
    const githubExpose = parsed.services["mcp-github"]?.expose;
    expect(githubExpose).toBeDefined();
  });

  it("handles agent with soulMd", () => {
    const crew: CrewConfig = {
      ...minimalCrew,
      agents: [
        {
          name: "agent-custom",
          image: "ghcr.io/cogni-dao/openclaw:latest",
          soulMd: btoa("You are a helpful research assistant."),
          mcpConnections: [],
          env: {},
          resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
          exposeGlobal: true,
        },
      ],
    };

    const result = generateSdl(crew);
    const parsed = parse(result.yaml) as {
      services: Record<string, { env?: string[] }>;
    };

    const agentEnv = parsed.services["agent-custom"]?.env;
    expect(agentEnv?.some((e: string) => e.startsWith("SOUL_MD="))).toBe(true);
  });
});
