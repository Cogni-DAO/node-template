// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/notion`
 * Purpose: Barrel export for the Notion work item mirror.
 * Scope: Re-exports only. Does not contain implementation.
 * Invariants: Single entry point for Notion mirror consumers.
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md
 * @public
 */

export {
  isKnownWorkItemType,
  type NotionUpsertResult,
  NotionWorkItemMirror,
  type NotionWorkItemMirrorConfig,
  type NotionWorkItemPage,
  type WorkItemNotionEditable,
  type WorkItemNotionPatch,
} from "./mirror.js";
