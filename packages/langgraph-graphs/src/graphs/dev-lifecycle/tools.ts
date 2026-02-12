// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/dev-lifecycle/tools`
 * Purpose: Tool IDs for dev-lifecycle graph (single source of truth).
 * Scope: Exports tool capability metadata. Does NOT enforce policy.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: This is THE list of tools dev-lifecycle can use
 *   - CAPABILITY_NOT_POLICY: These are capabilities, not authorization
 * Side-effects: none
 * Links: development-lifecycle.md
 * @public
 */

import {
  GET_CURRENT_TIME_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  WEB_SEARCH_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs for dev-lifecycle graph.
 * All agents share the full toolset — repo access + web search + time.
 */
export const DEV_LIFECYCLE_TOOL_IDS = [
  GET_CURRENT_TIME_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  WEB_SEARCH_NAME,
] as const;

export type DevLifecycleToolId = (typeof DEV_LIFECYCLE_TOOL_IDS)[number];
