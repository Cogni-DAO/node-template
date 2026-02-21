// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion/github`
 * Purpose: GitHub source adapter — collects merged PRs, submitted reviews, and closed issues via GraphQL.
 * Scope: Implements SourceAdapter from @cogni/ingestion-core. Lives in scheduler-worker per ADAPTERS_NOT_IN_CORE.
 * Invariants:
 * - ACTIVITY_IDEMPOTENT: Deterministic event IDs from source data.
 * - PROVENANCE_REQUIRED: payloadHash (SHA-256), producer, version on every event.
 * - Cursor-based incremental sync — no full-window rescans.
 * - platformUserId = GitHub numeric databaseId (stable), not login (mutable).
 * - Bot authors skipped (no databaseId on Bot/Mannequin actors).
 * Side-effects: HTTP (GitHub GraphQL API)
 * Links: docs/spec/epoch-ledger.md, docs/research/epoch-event-ingestion-pipeline.md
 * @internal
 */

import type {
  ActivityEvent,
  CollectParams,
  CollectResult,
  SourceAdapter,
  StreamDefinition,
} from "@cogni/ingestion-core";
import { buildEventId, hashCanonicalPayload } from "@cogni/ingestion-core";
import { graphql } from "@octokit/graphql";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GitHubAdapterConfig {
  /** GitHub PAT or GitHub App installation token */
  readonly token: string;
  /** Repos to collect from, format: "owner/repo" */
  readonly repos: readonly string[];
  /** Max GraphQL requests per hour (default: 4500 — conservative for PAT's 5000 limit) */
  readonly rateLimitPerHour?: number;
  /** Max events to return per collect() call (default: 500) */
  readonly maxEventsPerCall?: number;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class GitHubRateLimitError extends Error {
  readonly name = "GitHubRateLimitError" as const;

  constructor(
    public readonly retryAfterSeconds: number,
    public readonly endpoint: string
  ) {
    super(
      `GitHub rate limit hit on ${endpoint}, retry after ${retryAfterSeconds}s`
    );
  }
}

// ---------------------------------------------------------------------------
// Internal GraphQL response types
// ---------------------------------------------------------------------------

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GitHubActor {
  __typename: string;
  login: string;
  databaseId?: number; // Only on User, not Bot/Mannequin
}

interface PrNode {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  author: GitHubActor | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
}

interface ReviewNode {
  databaseId: number;
  submittedAt: string;
  state: string;
  author: GitHubActor | null;
}

interface PrWithReviewsNode {
  number: number;
  url: string;
  repository: { nameWithOwner: string };
  reviews: { nodes: ReviewNode[] };
}

interface IssueNode {
  number: number;
  title: string;
  closedAt: string;
  url: string;
  author: GitHubActor | null;
  repository: { nameWithOwner: string };
}

interface SearchResponse<T> {
  search: {
    pageInfo: PageInfo;
    nodes: T[];
  };
}

// ---------------------------------------------------------------------------
// Logger interface (minimal — adapters shouldn't depend on pino directly)
// ---------------------------------------------------------------------------

interface LoggerLike {
  debug(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

const silentLogger: LoggerLike = {
  debug() {},
  warn() {},
};

// ---------------------------------------------------------------------------
// GraphQL queries
// ---------------------------------------------------------------------------

const MERGED_PRS_QUERY = /* GraphQL */ `
  query CollectMergedPRs($query: String!, $cursor: String) {
    search(query: $query, type: ISSUE, first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          mergedAt
          url
          author { __typename login ... on User { databaseId } }
          additions
          deletions
          changedFiles
          repository { nameWithOwner }
        }
      }
    }
  }
`;

const REVIEWS_QUERY = /* GraphQL */ `
  query CollectReviews($query: String!, $cursor: String) {
    search(query: $query, type: ISSUE, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          url
          repository { nameWithOwner }
          reviews(first: 50) {
            nodes {
              databaseId
              submittedAt
              state
              author { __typename login ... on User { databaseId } }
            }
          }
        }
      }
    }
  }
`;

const CLOSED_ISSUES_QUERY = /* GraphQL */ `
  query CollectClosedIssues($query: String!, $cursor: String) {
    search(query: $query, type: ISSUE, first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Issue {
          number
          title
          closedAt
          url
          author { __typename login ... on User { databaseId } }
          repository { nameWithOwner }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GitHubSourceAdapter implements SourceAdapter {
  readonly source = "github" as const;
  readonly version = "0.1.0" as const;

  private readonly gql: typeof graphql;
  private readonly repos: readonly string[];
  private readonly maxEventsPerCall: number;
  private readonly logger: LoggerLike;

  constructor(config: GitHubAdapterConfig, logger?: LoggerLike) {
    this.repos = config.repos;
    this.maxEventsPerCall = config.maxEventsPerCall ?? 500;
    this.logger = logger ?? silentLogger;

    this.gql = graphql.defaults({
      headers: { authorization: `token ${config.token}` },
    });
  }

  streams(): StreamDefinition[] {
    return [
      {
        id: "pull_requests",
        name: "Pull Requests (merged)",
        cursorType: "timestamp",
        defaultPollInterval: 3600,
      },
      {
        id: "reviews",
        name: "PR Reviews submitted",
        cursorType: "timestamp",
        defaultPollInterval: 3600,
      },
      {
        id: "issues",
        name: "Issues closed",
        cursorType: "timestamp",
        defaultPollInterval: 3600,
      },
    ];
  }

  async collect(params: CollectParams): Promise<CollectResult> {
    const { streams, cursor, window } = params;
    const since = cursor ? new Date(cursor.value) : window.since;
    const until = window.until;
    const allEvents: ActivityEvent[] = [];
    let latestTime = since;

    for (const repo of this.repos) {
      if (allEvents.length >= this.maxEventsPerCall) break;

      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        this.logger.warn(`Invalid repo format, expected owner/repo: ${repo}`);
        continue;
      }

      for (const streamId of streams) {
        if (allEvents.length >= this.maxEventsPerCall) break;

        const remaining = this.maxEventsPerCall - allEvents.length;
        const events = await this.collectStream(
          streamId,
          owner,
          repoName,
          since,
          until,
          remaining
        );

        for (const event of events) {
          allEvents.push(event);
          if (event.eventTime > latestTime) {
            latestTime = event.eventTime;
          }
        }
      }
    }

    return {
      events: allEvents,
      nextCursor: {
        streamId: streams[0] ?? "pull_requests",
        value: latestTime.toISOString(),
        retrievedAt: new Date(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private: stream dispatch
  // -------------------------------------------------------------------------

  private async collectStream(
    streamId: string,
    owner: string,
    repoName: string,
    since: Date,
    until: Date,
    limit: number
  ): Promise<ActivityEvent[]> {
    switch (streamId) {
      case "pull_requests":
        return this.collectPullRequests(owner, repoName, since, until, limit);
      case "reviews":
        return this.collectReviews(owner, repoName, since, until, limit);
      case "issues":
        return this.collectIssues(owner, repoName, since, until, limit);
      default:
        this.logger.warn(`Unknown stream: ${streamId}`);
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private: Pull Requests (merged)
  // -------------------------------------------------------------------------

  private async collectPullRequests(
    owner: string,
    repoName: string,
    since: Date,
    until: Date,
    limit: number
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    let pageCursor: string | null = null;
    const searchQuery = `repo:${owner}/${repoName} is:pr is:merged merged:${since.toISOString()}..${until.toISOString()}`;

    do {
      const response = await this.executeQuery<SearchResponse<PrNode>>(
        MERGED_PRS_QUERY,
        { query: searchQuery, cursor: pageCursor }
      );

      for (const pr of response.search.nodes) {
        if (events.length >= limit) break;
        if (!pr.mergedAt) continue; // skip non-PR nodes from union

        const event = await this.normalizePr(owner, repoName, pr);
        if (event) events.push(event);
      }

      pageCursor = response.search.pageInfo.hasNextPage
        ? response.search.pageInfo.endCursor
        : null;
    } while (pageCursor && events.length < limit);

    return events;
  }

  private async normalizePr(
    owner: string,
    repoName: string,
    pr: PrNode
  ): Promise<ActivityEvent | null> {
    if (
      !pr.author ||
      pr.author.__typename !== "User" ||
      !pr.author.databaseId
    ) {
      this.logger.debug(
        `Skipping PR #${pr.number} in ${owner}/${repoName}: author is ${pr.author?.__typename ?? "null"}`
      );
      return null;
    }

    const id = buildEventId("github", "pr", `${owner}/${repoName}`, pr.number);
    const authorId = String(pr.author.databaseId);

    const payloadHash = await hashCanonicalPayload({
      authorId,
      id,
      mergedAt: pr.mergedAt,
    });

    return {
      id,
      source: "github",
      eventType: "pr_merged",
      platformUserId: authorId,
      platformLogin: pr.author.login,
      artifactUrl: pr.url,
      metadata: {
        title: pr.title,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        repo: `${owner}/${repoName}`,
      },
      payloadHash,
      eventTime: new Date(pr.mergedAt),
    };
  }

  // -------------------------------------------------------------------------
  // Private: Reviews
  // -------------------------------------------------------------------------

  private async collectReviews(
    owner: string,
    repoName: string,
    since: Date,
    until: Date,
    limit: number
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    let pageCursor: string | null = null;
    // Fetch PRs that were updated in the window — reviews may exist on recently active PRs
    const searchQuery = `repo:${owner}/${repoName} is:pr is:merged merged:${since.toISOString()}..${until.toISOString()}`;

    do {
      const response = await this.executeQuery<
        SearchResponse<PrWithReviewsNode>
      >(REVIEWS_QUERY, { query: searchQuery, cursor: pageCursor });

      for (const pr of response.search.nodes) {
        if (events.length >= limit) break;
        if (!pr.reviews) continue; // skip non-PR nodes

        for (const review of pr.reviews.nodes) {
          if (events.length >= limit) break;

          // Filter reviews to the time window
          const submittedAt = new Date(review.submittedAt);
          if (submittedAt < since || submittedAt > until) continue;

          const event = await this.normalizeReview(
            owner,
            repoName,
            pr.number,
            review
          );
          if (event) events.push(event);
        }
      }

      pageCursor = response.search.pageInfo.hasNextPage
        ? response.search.pageInfo.endCursor
        : null;
    } while (pageCursor && events.length < limit);

    return events;
  }

  private async normalizeReview(
    owner: string,
    repoName: string,
    prNumber: number,
    review: ReviewNode
  ): Promise<ActivityEvent | null> {
    if (
      !review.author ||
      review.author.__typename !== "User" ||
      !review.author.databaseId
    ) {
      this.logger.debug(
        `Skipping review ${review.databaseId} on PR #${prNumber} in ${owner}/${repoName}: author is ${review.author?.__typename ?? "null"}`
      );
      return null;
    }

    const id = buildEventId(
      "github",
      "review",
      `${owner}/${repoName}`,
      prNumber,
      review.databaseId
    );
    const authorId = String(review.author.databaseId);

    const payloadHash = await hashCanonicalPayload({
      authorId,
      id,
      state: review.state,
      submittedAt: review.submittedAt,
    });

    return {
      id,
      source: "github",
      eventType: "review_submitted",
      platformUserId: authorId,
      platformLogin: review.author.login,
      artifactUrl: `https://github.com/${owner}/${repoName}/pull/${prNumber}#pullrequestreview-${review.databaseId}`,
      metadata: {
        prNumber,
        state: review.state,
        repo: `${owner}/${repoName}`,
      },
      payloadHash,
      eventTime: new Date(review.submittedAt),
    };
  }

  // -------------------------------------------------------------------------
  // Private: Issues (closed)
  // -------------------------------------------------------------------------

  private async collectIssues(
    owner: string,
    repoName: string,
    since: Date,
    until: Date,
    limit: number
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    let pageCursor: string | null = null;
    const searchQuery = `repo:${owner}/${repoName} is:issue is:closed closed:${since.toISOString()}..${until.toISOString()}`;

    do {
      const response = await this.executeQuery<SearchResponse<IssueNode>>(
        CLOSED_ISSUES_QUERY,
        { query: searchQuery, cursor: pageCursor }
      );

      for (const issue of response.search.nodes) {
        if (events.length >= limit) break;
        if (!issue.closedAt) continue; // skip non-Issue nodes

        const event = await this.normalizeIssue(owner, repoName, issue);
        if (event) events.push(event);
      }

      pageCursor = response.search.pageInfo.hasNextPage
        ? response.search.pageInfo.endCursor
        : null;
    } while (pageCursor && events.length < limit);

    return events;
  }

  private async normalizeIssue(
    owner: string,
    repoName: string,
    issue: IssueNode
  ): Promise<ActivityEvent | null> {
    if (
      !issue.author ||
      issue.author.__typename !== "User" ||
      !issue.author.databaseId
    ) {
      this.logger.debug(
        `Skipping issue #${issue.number} in ${owner}/${repoName}: author is ${issue.author?.__typename ?? "null"}`
      );
      return null;
    }

    const id = buildEventId(
      "github",
      "issue",
      `${owner}/${repoName}`,
      issue.number
    );
    const authorId = String(issue.author.databaseId);

    const payloadHash = await hashCanonicalPayload({
      authorId,
      closedAt: issue.closedAt,
      id,
    });

    return {
      id,
      source: "github",
      eventType: "issue_closed",
      platformUserId: authorId,
      platformLogin: issue.author.login,
      artifactUrl: issue.url,
      metadata: {
        title: issue.title,
        repo: `${owner}/${repoName}`,
      },
      payloadHash,
      eventTime: new Date(issue.closedAt),
    };
  }

  // -------------------------------------------------------------------------
  // Private: GraphQL execution with rate limit handling
  // -------------------------------------------------------------------------

  private async executeQuery<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    try {
      return await this.gql<T>(query, variables);
    } catch (error: unknown) {
      if (isGraphQLResponseError(error) && isRateLimited(error)) {
        const retryAfter = extractRetryAfter(error);
        throw new GitHubRateLimitError(retryAfter, "graphql");
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Error inspection helpers
// ---------------------------------------------------------------------------

interface GraphQLResponseError {
  status: number;
  headers: Record<string, string>;
}

function isGraphQLResponseError(error: unknown): error is GraphQLResponseError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as GraphQLResponseError).status === "number"
  );
}

function isRateLimited(error: GraphQLResponseError): boolean {
  return error.status === 403 || error.status === 429;
}

function extractRetryAfter(error: GraphQLResponseError): number {
  const header = error.headers?.["retry-after"];
  if (header) {
    const seconds = Number.parseInt(header, 10);
    if (!Number.isNaN(seconds)) return seconds;
  }
  // Default: wait 60 seconds if no Retry-After header
  return 60;
}
