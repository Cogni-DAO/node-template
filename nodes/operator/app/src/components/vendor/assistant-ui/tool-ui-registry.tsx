// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/vendor/assistant-ui/tool-ui-registry`
 * Purpose: Mounts every per-tool assistant-ui renderer once, inside the AssistantRuntimeProvider tree. `makeAssistantToolUI` returns a component whose mount-time effect registers the renderer for a given toolName; rendering the registry is the registration.
 * Scope: Single source of truth for which tools have dedicated UI. Adding a tool UI = adding one line here.
 * Side-effects: none (the children themselves call useAssistantToolUI under the runtime context)
 * Links: tool-ui-vcs-flight-candidate.tsx
 * @public
 */

"use client";

import { VcsFlightCandidateToolUI } from "./tool-ui-vcs-flight-candidate";

export function ToolUIRegistry() {
  return <VcsFlightCandidateToolUI />;
}
