// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/agent-catalog`
 * Purpose: Port interface for agent discovery (listing available agents).
 * Scope: Defines AgentCatalogPort contract for discovery-only operations. Does not handle execution.
 * Invariants:
 *   - DISCOVERY_NO_EXECUTION_DEPS: Discovery does not require execution infrastructure
 *   - P0_AGENT_GRAPH_IDENTITY: agentId === graphId (one agent per graph)
 *   - UI_ONLY_TALKS_TO_PORT: UI calls listAgents() via port; does not know providers
 * Side-effects: none (interface only)
 * Links: AGENT_DISCOVERY.md, ai.agents.v1.contract.ts
 * @public
 */

/**
 * Agent capabilities exposed in descriptor.
 * Used for UI display and feature gating.
 */
export interface AgentCapabilities {
  /** Whether the agent supports streaming responses */
  readonly supportsStreaming: boolean;
  /** Whether the agent supports tool execution */
  readonly supportsTools: boolean;
  /** Whether the agent supports thread persistence (memory) */
  readonly supportsMemory: boolean;
}

/**
 * Agent descriptor for discovery and UI display.
 * Returned by AgentCatalogPort.listAgents().
 *
 * Per P0_AGENT_GRAPH_IDENTITY: agentId === graphId in P0.
 * P1+: agentId becomes stable and may reference multiple assistants per graph.
 *
 * graphId format is "${providerId}:${graphName}" (e.g., "langgraph:poet").
 */
export interface AgentDescriptor {
  /**
   * Stable agent identifier.
   * P0: equals graphId (one agent per graph).
   * P1+: stable across assistant variants.
   */
  readonly agentId: string;
  /**
   * Internal graph reference for routing.
   * Format: "${providerId}:${graphName}" (e.g., "langgraph:poet").
   */
  readonly graphId: string;
  /** Human-readable name for UI display */
  readonly displayName: string;
  /** Description of what this agent does */
  readonly description: string;
  /** Agent capabilities */
  readonly capabilities: AgentCapabilities;
}

/**
 * Port interface for agent discovery.
 *
 * Per DISCOVERY_NO_EXECUTION_DEPS: discovery is decoupled from execution.
 * Implementations do not require CompletionStreamFn or execution infrastructure.
 *
 * Per UI_ONLY_TALKS_TO_PORT: UI calls this port; does not know providers.
 */
export interface AgentCatalogPort {
  /**
   * List all available agents from all providers.
   * Used for discovery and UI agent selector.
   *
   * @returns Array of agent descriptors
   */
  listAgents(): readonly AgentDescriptor[];
}
