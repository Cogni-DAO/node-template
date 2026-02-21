import type { CollectParams } from "@cogni/ingestion-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type GitHubAdapterConfig,
  GitHubRateLimitError,
  GitHubSourceAdapter,
} from "../src/adapters/ingestion/github";
import {
  makeIssueNode,
  makePrNode,
  makePrWithReviewsNode,
  makeReviewNode,
  wrapSearchResponse,
} from "./fixtures/github-graphql.fixtures";

// ---------------------------------------------------------------------------
// Mock @octokit/graphql
// ---------------------------------------------------------------------------

const mockGraphqlFn = vi.fn();

vi.mock("@octokit/graphql", () => ({
  graphql: {
    defaults: () => mockGraphqlFn,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(
  overrides?: Partial<GitHubAdapterConfig>
): GitHubSourceAdapter {
  return new GitHubSourceAdapter({
    token: "ghp_test_token_1234",
    repos: ["cogni-dao/cogni-template"],
    ...overrides,
  });
}

const baseWindow = {
  since: new Date("2026-01-01T00:00:00Z"),
  until: new Date("2026-01-08T00:00:00Z"),
};

function makeCollectParams(overrides?: Partial<CollectParams>): CollectParams {
  return {
    streams: ["pull_requests"],
    cursor: null,
    window: baseWindow,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubSourceAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("streams()", () => {
    it("returns three stream definitions", () => {
      const adapter = makeAdapter();
      const streams = adapter.streams();
      expect(streams).toHaveLength(3);
      expect(streams.map((s) => s.id)).toEqual([
        "pull_requests",
        "reviews",
        "issues",
      ]);
    });

    it("all streams use timestamp cursors", () => {
      const adapter = makeAdapter();
      for (const stream of adapter.streams()) {
        expect(stream.cursorType).toBe("timestamp");
      }
    });
  });

  describe("collect() — pull requests", () => {
    it("produces deterministic event IDs", async () => {
      const pr = makePrNode({
        number: 42,
        mergedAt: "2026-01-05T12:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.id).toBe(
        "github:pr:cogni-dao/cogni-template:42"
      );
    });

    it("produces deterministic payload hashes", async () => {
      const pr = makePrNode({
        number: 42,
        mergedAt: "2026-01-05T12:00:00Z",
        authorDatabaseId: 12345,
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));
      const adapter1 = makeAdapter();
      const result1 = await adapter1.collect(makeCollectParams());

      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));
      const adapter2 = makeAdapter();
      const result2 = await adapter2.collect(makeCollectParams());

      expect(result1.events[0]?.payloadHash).toBe(
        result2.events[0]?.payloadHash
      );
      expect(result1.events[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("uses numeric databaseId as platformUserId, not login", async () => {
      const pr = makePrNode({
        number: 1,
        mergedAt: "2026-01-02T00:00:00Z",
        authorLogin: "someuser",
        authorDatabaseId: 99999,
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events[0]?.platformUserId).toBe("99999");
      expect(result.events[0]?.platformLogin).toBe("someuser");
    });

    it("skips bot authors", async () => {
      const botPr = makePrNode({
        number: 10,
        mergedAt: "2026-01-03T00:00:00Z",
        authorTypename: "Bot",
        authorDatabaseId: undefined,
      });
      const userPr = makePrNode({
        number: 11,
        mergedAt: "2026-01-04T00:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([botPr, userPr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.id).toBe(
        "github:pr:cogni-dao/cogni-template:11"
      );
    });

    it("sets eventType to pr_merged", async () => {
      const pr = makePrNode({
        number: 1,
        mergedAt: "2026-01-02T00:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events[0]?.eventType).toBe("pr_merged");
      expect(result.events[0]?.source).toBe("github");
    });
  });

  describe("collect() — cursor advancement", () => {
    it("advances cursor to latest eventTime", async () => {
      const pr1 = makePrNode({
        number: 1,
        mergedAt: "2026-01-02T00:00:00Z",
      });
      const pr2 = makePrNode({
        number: 2,
        mergedAt: "2026-01-05T00:00:00Z",
      });
      const pr3 = makePrNode({
        number: 3,
        mergedAt: "2026-01-03T00:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr1, pr2, pr3]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.nextCursor.value).toBe("2026-01-05T00:00:00.000Z");
    });

    it("uses window.until when no events returned", async () => {
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([]));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events).toHaveLength(0);
      // cursor stays at window.since (no events to advance it)
      expect(result.nextCursor.value).toBe(baseWindow.since.toISOString());
    });

    it("resumes from cursor value when provided", async () => {
      const pr = makePrNode({
        number: 5,
        mergedAt: "2026-01-06T00:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const cursorTime = "2026-01-04T00:00:00Z";
      await adapter.collect(
        makeCollectParams({
          cursor: {
            streamId: "pull_requests",
            value: cursorTime,
            retrievedAt: new Date(),
          },
        })
      );

      // The GraphQL query should use the cursor time (with millis), not window.since
      const callArgs = mockGraphqlFn.mock.calls[0];
      const queryStr = callArgs?.[1]?.query as string;
      // Cursor time gets parsed to Date then .toISOString() → adds .000Z
      expect(queryStr).toContain("2026-01-04T00:00:00.000Z");
      expect(queryStr).not.toContain(
        `${baseWindow.since.toISOString().split("T")[0]}T00:00:00.000Z..`
      ); // not from window.since
    });
  });

  describe("collect() — pagination", () => {
    it("follows pagination when hasNextPage is true", async () => {
      const page1Pr = makePrNode({
        number: 1,
        mergedAt: "2026-01-02T00:00:00Z",
      });
      const page2Pr = makePrNode({
        number: 2,
        mergedAt: "2026-01-03T00:00:00Z",
      });

      mockGraphqlFn
        .mockResolvedValueOnce(
          wrapSearchResponse([page1Pr], true, "cursor-page-1")
        )
        .mockResolvedValueOnce(wrapSearchResponse([page2Pr], false, null));

      const adapter = makeAdapter();
      const result = await adapter.collect(makeCollectParams());

      expect(result.events).toHaveLength(2);
      expect(mockGraphqlFn).toHaveBeenCalledTimes(2);

      // Second call should use the endCursor from first page
      const secondCallArgs = mockGraphqlFn.mock.calls[1];
      expect(secondCallArgs?.[1]?.cursor).toBe("cursor-page-1");
    });

    it("respects maxEventsPerCall limit", async () => {
      const prs = Array.from({ length: 5 }, (_, i) =>
        makePrNode({
          number: i + 1,
          mergedAt: `2026-01-0${i + 2}T00:00:00Z`,
        })
      );
      mockGraphqlFn.mockResolvedValueOnce(
        wrapSearchResponse(prs, true, "more-pages")
      );

      const adapter = makeAdapter({ maxEventsPerCall: 3 });
      const result = await adapter.collect(makeCollectParams());

      expect(result.events).toHaveLength(3);
      // Should NOT make a second call since limit was reached
      expect(mockGraphqlFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("collect() — reviews", () => {
    it("collects reviews with deterministic IDs", async () => {
      const review = makeReviewNode({
        databaseId: 555,
        submittedAt: "2026-01-03T10:00:00Z",
      });
      const prWithReviews = makePrWithReviewsNode({
        number: 42,
        reviews: [review],
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([prWithReviews]));

      const adapter = makeAdapter();
      const result = await adapter.collect(
        makeCollectParams({ streams: ["reviews"] })
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.id).toBe(
        "github:review:cogni-dao/cogni-template:42:555"
      );
      expect(result.events[0]?.eventType).toBe("review_submitted");
    });

    it("filters reviews outside the time window", async () => {
      const inWindow = makeReviewNode({
        databaseId: 1,
        submittedAt: "2026-01-03T00:00:00Z",
      });
      const beforeWindow = makeReviewNode({
        databaseId: 2,
        submittedAt: "2025-12-01T00:00:00Z",
      });
      const afterWindow = makeReviewNode({
        databaseId: 3,
        submittedAt: "2026-02-01T00:00:00Z",
      });
      const pr = makePrWithReviewsNode({
        number: 10,
        reviews: [inWindow, beforeWindow, afterWindow],
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(
        makeCollectParams({ streams: ["reviews"] })
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.id).toContain(":1"); // only inWindow review
    });

    it("skips bot review authors", async () => {
      const botReview = makeReviewNode({
        databaseId: 100,
        submittedAt: "2026-01-03T00:00:00Z",
        authorTypename: "Bot",
        authorDatabaseId: undefined,
      });
      const pr = makePrWithReviewsNode({
        number: 20,
        reviews: [botReview],
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([pr]));

      const adapter = makeAdapter();
      const result = await adapter.collect(
        makeCollectParams({ streams: ["reviews"] })
      );

      expect(result.events).toHaveLength(0);
    });
  });

  describe("collect() — issues", () => {
    it("collects closed issues with deterministic IDs", async () => {
      const issue = makeIssueNode({
        number: 99,
        closedAt: "2026-01-04T15:00:00Z",
      });
      mockGraphqlFn.mockResolvedValueOnce(wrapSearchResponse([issue]));

      const adapter = makeAdapter();
      const result = await adapter.collect(
        makeCollectParams({ streams: ["issues"] })
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.id).toBe(
        "github:issue:cogni-dao/cogni-template:99"
      );
      expect(result.events[0]?.eventType).toBe("issue_closed");
    });
  });

  describe("collect() — rate limiting", () => {
    it("throws GitHubRateLimitError on 403", async () => {
      mockGraphqlFn.mockRejectedValueOnce({
        status: 403,
        headers: { "retry-after": "120" },
      });

      const adapter = makeAdapter();
      await expect(adapter.collect(makeCollectParams())).rejects.toThrow(
        GitHubRateLimitError
      );
    });

    it("throws GitHubRateLimitError on 429", async () => {
      mockGraphqlFn.mockRejectedValueOnce({
        status: 429,
        headers: { "retry-after": "60" },
      });

      const adapter = makeAdapter();
      const error = await adapter
        .collect(makeCollectParams())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GitHubRateLimitError);
      expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(60);
    });

    it("extracts retryAfterSeconds from header", async () => {
      mockGraphqlFn.mockRejectedValueOnce({
        status: 403,
        headers: { "retry-after": "300" },
      });

      const adapter = makeAdapter();
      const error = await adapter
        .collect(makeCollectParams())
        .catch((e: unknown) => e);

      expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(300);
    });

    it("defaults to 60s when no Retry-After header", async () => {
      mockGraphqlFn.mockRejectedValueOnce({
        status: 403,
        headers: {},
      });

      const adapter = makeAdapter();
      const error = await adapter
        .collect(makeCollectParams())
        .catch((e: unknown) => e);

      expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(60);
    });

    it("propagates non-rate-limit errors as-is", async () => {
      const networkError = new Error("ECONNREFUSED");
      mockGraphqlFn.mockRejectedValueOnce(networkError);

      const adapter = makeAdapter();
      await expect(adapter.collect(makeCollectParams())).rejects.toThrow(
        "ECONNREFUSED"
      );
    });
  });

  describe("collect() — multiple streams", () => {
    it("collects from multiple streams in one call", async () => {
      const pr = makePrNode({
        number: 1,
        mergedAt: "2026-01-02T00:00:00Z",
      });
      const review = makeReviewNode({
        databaseId: 100,
        submittedAt: "2026-01-03T00:00:00Z",
      });
      const prWithReviews = makePrWithReviewsNode({
        number: 1,
        reviews: [review],
      });
      const issue = makeIssueNode({
        number: 50,
        closedAt: "2026-01-04T00:00:00Z",
      });

      mockGraphqlFn
        .mockResolvedValueOnce(wrapSearchResponse([pr])) // PRs
        .mockResolvedValueOnce(wrapSearchResponse([prWithReviews])) // Reviews
        .mockResolvedValueOnce(wrapSearchResponse([issue])); // Issues

      const adapter = makeAdapter();
      const result = await adapter.collect(
        makeCollectParams({
          streams: ["pull_requests", "reviews", "issues"],
        })
      );

      expect(result.events).toHaveLength(3);
      expect(result.events.map((e) => e.eventType)).toEqual([
        "pr_merged",
        "review_submitted",
        "issue_closed",
      ]);
    });
  });
});
