// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/application/publish-post`
 * Purpose: Publish an approved platform post via PublishPort. Idempotent.
 * Scope: Pure orchestration. Takes ports as args. Does not perform I/O directly.
 * Invariants:
 *   - USE_CASES_ARE_TEMPORAL_READY: pure function, ports as args, no HTTP/framework deps
 *   - PUBLISH_IS_IDEMPOTENT: no-op if externalId already set
 *   - STATE_TRANSITIONS_ENFORCED: validates post is in approved status
 * Side-effects: none (delegates to ports)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { ActorId } from "@cogni/ids";

import type { BroadcastLedgerWorkerPort } from "../ports/broadcast-ledger.port";
import type { PublishPort } from "../ports/publish.port";
import type { ContentMessageId, PlatformPost, PlatformPostId } from "../types";

export interface PublishPostDeps {
  readonly ledger: BroadcastLedgerWorkerPort;
  readonly publisher: PublishPort;
}

export interface PublishPostResult {
  readonly post: PlatformPost;
  readonly published: boolean;
  readonly skipped: boolean;
}

/**
 * Publish an approved platform post.
 *
 * 1. Fetches and validates post is `approved`
 * 2. Checks idempotency (already has externalId → skip)
 * 3. Transitions to `publishing`
 * 4. Calls PublishPort.publish()
 * 5. Finalizes with result (or error on failure)
 *
 * @throws Error if post not found, wrong status, or platform mismatch
 */
export async function publishPost(
  deps: PublishPostDeps,
  actorId: ActorId,
  messageId: ContentMessageId,
  postId: PlatformPostId
): Promise<PublishPostResult> {
  const { ledger, publisher } = deps;

  // 1. Fetch post
  const posts = await ledger.getPlatformPosts(actorId, messageId);
  const post = posts.find((p) => p.id === postId);

  if (!post) {
    throw new Error(`PlatformPost '${postId}' not found`);
  }

  // 2. Idempotency — PUBLISH_IS_IDEMPOTENT
  if (post.externalId) {
    return { post, published: false, skipped: true };
  }

  // 3. Status check
  if (post.status !== "approved") {
    throw new Error(
      `Cannot publish post in status '${post.status}' (expected 'approved')`
    );
  }

  // 4. Platform match
  if (publisher.platform !== post.platform) {
    throw new Error(
      `Publisher platform '${publisher.platform}' does not match post platform '${post.platform}'`
    );
  }

  // 5. Transition to publishing
  await ledger.updatePlatformPostStatus(actorId, postId, "publishing");

  // 6. Publish
  try {
    const result = await publisher.publish(post);

    await ledger.finalizePlatformPost(actorId, postId, {
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      publishedAt: new Date(),
    });

    const updatedPosts = await ledger.getPlatformPosts(actorId, messageId);
    const updatedPost = updatedPosts.find((p) => p.id === postId) ?? post;

    return { post: updatedPost, published: true, skipped: false };
  } catch (error) {
    await ledger.updatePlatformPostStatus(actorId, postId, "failed");
    await ledger.finalizePlatformPost(actorId, postId, {
      errorMessage:
        error instanceof Error ? error.message : "Unknown publish error",
    });

    throw error;
  }
}
