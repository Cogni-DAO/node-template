// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/application`
 * Purpose: Barrel export for broadcasting use-case orchestration functions.
 * Scope: Re-exports only. Does not contain logic.
 * Invariants: USE_CASES_ARE_TEMPORAL_READY — all exports are pure functions with ports as args.
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

export {
  type ApplyReviewDecisionDeps,
  applyReviewDecision,
} from "./apply-review-decision";
export {
  type OptimizeDraftDeps,
  type OptimizeDraftResult,
  optimizeDraft,
} from "./optimize-draft";
export {
  type PublishPostDeps,
  type PublishPostResult,
  publishPost,
} from "./publish-post";
