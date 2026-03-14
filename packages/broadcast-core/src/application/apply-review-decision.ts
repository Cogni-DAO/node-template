// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/application/apply-review-decision`
 * Purpose: Validate and apply a review decision to a platform post.
 * Scope: Pure orchestration. Takes ports as args. Does not perform I/O directly.
 * Invariants:
 *   - USE_CASES_ARE_TEMPORAL_READY: pure function, ports as args, no HTTP/framework deps
 *   - STATE_TRANSITIONS_ENFORCED: validates post is in pending_review
 *   - Ownership validation: post must belong to the given message
 * Side-effects: none (delegates to ports)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { UserId } from "@cogni/ids";

import type { BroadcastLedgerUserPort } from "../ports/broadcast-ledger.port";
import type {
  ContentMessageId,
  PlatformPost,
  PlatformPostId,
  ReviewDecision,
} from "../types";

export interface ApplyReviewDecisionDeps {
  readonly ledger: BroadcastLedgerUserPort;
}

/**
 * Validate and apply a review decision to a platform post.
 *
 * 1. Validates the post belongs to the given message (ownership check)
 * 2. Validates the post is in `pending_review` status
 * 3. Validates `edited` decision has `editedBody`
 * 4. Applies the decision
 *
 * @throws Error if post not found, doesn't belong to message, or wrong status
 */
export async function applyReviewDecision(
  deps: ApplyReviewDecisionDeps,
  callerUserId: UserId,
  messageId: ContentMessageId,
  postId: PlatformPostId,
  decision: ReviewDecision,
  editedBody?: string
): Promise<PlatformPost> {
  const { ledger } = deps;

  // 1. Ownership check — fetch posts for this message, verify postId is among them
  const posts = await ledger.getPlatformPosts(callerUserId, messageId);
  const post = posts.find((p) => p.id === postId);

  if (!post) {
    throw new Error(
      `PlatformPost '${postId}' not found for message '${messageId}'`
    );
  }

  // 2. Status check
  if (post.status !== "pending_review") {
    throw new Error(
      `Cannot review post in status '${post.status}' (expected 'pending_review')`
    );
  }

  // 3. Edited requires editedBody
  if (decision === "edited" && !editedBody) {
    throw new Error("Review decision 'edited' requires editedBody");
  }

  // 4. Apply
  return ledger.updatePlatformPostReview(
    callerUserId,
    postId,
    decision,
    editedBody
  );
}
