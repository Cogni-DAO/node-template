// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/port/schemas`
 * Purpose: Zod schemas for Akash deployment types, crew configs, and SDL structures.
 * Scope: Validation schemas — no runtime logic. Does NOT perform I/O.
 * Invariants: SCHEMAS_ARE_SOURCE_OF_TRUTH
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

import { z } from "zod";

// ── Resource profiles ──

export const resourceProfileSchema = z.object({
  cpu: z.number().min(0.1).describe("CPU units (e.g., 0.5 = half core)"),
  memory: z.string().describe("Memory size (e.g., '512Mi', '1Gi')"),
  storage: z.string().describe("Storage size (e.g., '1Gi', '10Gi')"),
});

export type ResourceProfile = z.infer<typeof resourceProfileSchema>;

// ── MCP Server definition ──

export const mcpTransportSchema = z.enum(["stdio", "sse", "streamable-http"]);

export const mcpServerConfigSchema = z.object({
  name: z.string().describe("Service name (DNS-safe, e.g., 'mcp-github')"),
  image: z
    .string()
    .describe(
      "Container image (e.g., 'ghcr.io/cogni-dao/mcp-golden/github:latest')"
    ),
  transport: mcpTransportSchema.default("stdio"),
  port: z.number().default(3100).describe("Internal service port"),
  env: z.record(z.string()).default({}).describe("Environment variables"),
  resources: resourceProfileSchema.default({
    cpu: 0.5,
    memory: "512Mi",
    storage: "1Gi",
  }),
  requiredAuth: z
    .array(z.string())
    .default([])
    .describe("OAuth scopes or tokens required"),
});

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

// ── Agent definition ──

export const agentConfigSchema = z.object({
  name: z.string().describe("Agent service name (e.g., 'agent-research')"),
  image: z.string().default("ghcr.io/cogni-dao/openclaw:latest"),
  soulMd: z.string().optional().describe("Base64-encoded SOUL.md content"),
  mcpConnections: z
    .array(z.string())
    .default([])
    .describe("MCP service names this agent connects to"),
  env: z.record(z.string()).default({}),
  resources: resourceProfileSchema.default({
    cpu: 1,
    memory: "1Gi",
    storage: "2Gi",
  }),
  exposeGlobal: z
    .boolean()
    .default(true)
    .describe("Whether to expose agent endpoint globally"),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

// ── Crew (deployment unit) ──

export const crewConfigSchema = z.object({
  name: z.string().describe("Crew name (e.g., 'research-crew')"),
  mission: z.string().optional().describe("Natural language mission statement"),
  mcpServers: z.array(mcpServerConfigSchema).default([]),
  agents: z.array(agentConfigSchema).min(1, "At least one agent required"),
  region: z
    .string()
    .default("us-west")
    .describe("Preferred Akash provider region"),
  maxBudgetUakt: z.string().default("1000000").describe("Max budget in uakt"),
});

export type CrewConfig = z.infer<typeof crewConfigSchema>;

// ── Deployment state ──

export const deploymentStatusSchema = z.enum([
  "pending",
  "bidding",
  "active",
  "closing",
  "closed",
  "error",
]);

export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

export const deploymentInfoSchema = z.object({
  deploymentId: z.string().describe("Akash deployment ID (owner/dseq)"),
  status: deploymentStatusSchema,
  crewName: z.string(),
  provider: z.string().optional().describe("Akash provider address"),
  leaseId: z.string().optional(),
  endpoints: z
    .record(z.string())
    .default({})
    .describe("Service name -> external URL"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  txHash: z.string().optional(),
});

export type DeploymentInfo = z.infer<typeof deploymentInfoSchema>;

// ── Lease / bid ──

export const bidSchema = z.object({
  provider: z.string(),
  price: z.object({
    amount: z.string(),
    denom: z.string(),
  }),
  state: z.string(),
});

export type Bid = z.infer<typeof bidSchema>;

// ── SDL generation output ──

export const sdlOutputSchema = z.object({
  yaml: z.string().describe("Raw SDL YAML string"),
  services: z.array(z.string()).describe("Service names in the SDL"),
  estimatedCostPerBlock: z
    .string()
    .describe("Estimated cost per block in uakt"),
});

export type SdlOutput = z.infer<typeof sdlOutputSchema>;
