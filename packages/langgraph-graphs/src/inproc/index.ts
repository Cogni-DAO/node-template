// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/inproc`
 * Purpose: Barrel export for InProc graph execution.
 * Scope: Re-exports runner and types. Does NOT import from src/.
 * Invariants: PACKAGES_NO_SRC_IMPORTS
 * Side-effects: none
 * Links: LANGGRAPH_AI.md
 * @public
 */

// Runner
export { createInProcChatRunner } from "./runner";

// Types
export type {
  CompletionFn,
  GraphResult,
  InProcGraphRequest,
  InProcRunnerOptions,
  Message,
  ToolExecFn,
  ToolExecResult,
} from "./types";
