// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/sdl`
 * Purpose: Generate Akash SDL YAML from CrewConfig.
 * Scope: Pure function — takes crew config, returns SDL string. Does NOT perform network calls.
 * Invariants:
 *   - VALID_SDL: Output must parse as valid Akash SDL v2.0.
 *   - INTERNAL_NETWORKING: MCP servers only expose to agents, not globally.
 *   - DETERMINISTIC: Same input always produces same output.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import { stringify } from "yaml";
import type {
  AgentConfig,
  CrewConfig,
  McpServerConfig,
  SdlOutput,
} from "../port/akash-deploy.schemas.js";

interface SdlService {
  image: string;
  env?: string[];
  expose: SdlExpose[];
}

interface SdlExpose {
  port: number;
  proto: string;
  to: SdlExposeTo[];
}

interface SdlExposeTo {
  service?: string;
  global?: boolean;
}

interface SdlResources {
  cpu: { units: number };
  memory: { size: string };
  storage: { size: string };
}

interface SdlPricing {
  denom: string;
  amount: number;
}

function envRecordToList(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

function buildMcpService(
  mcp: McpServerConfig,
  agentNames: string[]
): { service: SdlService; resources: SdlResources; pricing: SdlPricing } {
  const envList = envRecordToList(mcp.env);

  // MCP servers expose only to agents that reference them, not globally
  const consumers = agentNames.map((name) => ({ service: name }));

  return {
    service: {
      image: mcp.image,
      ...(envList.length > 0 ? { env: envList } : {}),
      expose: [
        {
          port: mcp.port,
          proto: "tcp",
          to: consumers,
        },
      ],
    },
    resources: {
      cpu: { units: mcp.resources.cpu },
      memory: { size: mcp.resources.memory },
      storage: { size: mcp.resources.storage },
    },
    pricing: { denom: "uakt", amount: 100 },
  };
}

function buildAgentService(
  agent: AgentConfig,
  mcpServers: McpServerConfig[]
): { service: SdlService; resources: SdlResources; pricing: SdlPricing } {
  // Build MCP_SERVERS connection string: "name:port,name:port"
  const connectedMcps = mcpServers.filter((m) =>
    agent.mcpConnections.includes(m.name)
  );
  const mcpConnectionString = connectedMcps
    .map((m) => `${m.name}:${m.port}`)
    .join(",");

  const envMap: Record<string, string> = { ...agent.env };
  if (mcpConnectionString) {
    envMap.MCP_SERVERS = mcpConnectionString;
  }
  if (agent.soulMd) {
    envMap.SOUL_MD = agent.soulMd;
  }

  const envList = envRecordToList(envMap);

  const expose: SdlExpose[] = [];
  if (agent.exposeGlobal) {
    expose.push({
      port: 8080,
      proto: "tcp",
      to: [{ global: true }],
    });
  }

  return {
    service: {
      image: agent.image,
      ...(envList.length > 0 ? { env: envList } : {}),
      expose,
    },
    resources: {
      cpu: { units: agent.resources.cpu },
      memory: { size: agent.resources.memory },
      storage: { size: agent.resources.storage },
    },
    pricing: { denom: "uakt", amount: 200 },
  };
}

/**
 * Generate Akash SDL YAML from a crew configuration.
 *
 * The SDL defines all services (MCP servers + agents) in a single deployment
 * group with shared internal networking. MCP servers are only accessible to
 * agents within the deployment; agents can optionally expose endpoints globally.
 */
export function generateSdl(crew: CrewConfig): SdlOutput {
  const services: Record<string, SdlService> = {};
  const compute: Record<string, { resources: SdlResources }> = {};
  const pricing: Record<string, SdlPricing> = {};
  const deployment: Record<string, { default: { count: number } }> = {};
  const serviceNames: string[] = [];

  const agentNames = crew.agents.map((a) => a.name);

  // Build MCP server services
  for (const mcp of crew.mcpServers) {
    const result = buildMcpService(mcp, agentNames);
    services[mcp.name] = result.service;
    compute[mcp.name] = { resources: result.resources };
    pricing[mcp.name] = result.pricing;
    deployment[mcp.name] = { default: { count: 1 } };
    serviceNames.push(mcp.name);
  }

  // Build agent services
  for (const agent of crew.agents) {
    const result = buildAgentService(agent, crew.mcpServers);
    services[agent.name] = result.service;
    compute[agent.name] = { resources: result.resources };
    pricing[agent.name] = result.pricing;
    deployment[agent.name] = { default: { count: 1 } };
    serviceNames.push(agent.name);
  }

  const sdl = {
    version: "2.0",
    services,
    profiles: {
      compute,
      placement: {
        default: {
          pricing: Object.fromEntries(
            Object.entries(pricing).map(([name, p]) => [name, p])
          ),
        },
      },
    },
    deployment,
  };

  // Calculate estimated cost per block (sum of all service pricing)
  const totalCostPerBlock = Object.values(pricing).reduce(
    (sum, p) => sum + p.amount,
    0
  );

  return {
    yaml: stringify(sdl),
    services: serviceNames,
    estimatedCostPerBlock: totalCostPerBlock.toString(),
  };
}
