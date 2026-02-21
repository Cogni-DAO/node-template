// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/tests/fixtures/github-graphql.fixtures`
 * Purpose: Mock GitHub GraphQL API response fixtures for unit tests.
 * Scope: Test-only helpers for constructing mock GraphQL responses. Does not contain production logic or network I/O.
 * Side-effects: none
 * @internal
 */

export function makePrNode(overrides: {
  number: number;
  mergedAt: string;
  authorLogin?: string;
  authorDatabaseId?: number;
  authorTypename?: string;
  repo?: string;
}) {
  const [owner, repoName] = (
    overrides.repo ?? "cogni-dao/cogni-template"
  ).split("/");
  return {
    number: overrides.number,
    title: `PR #${overrides.number}`,
    mergedAt: overrides.mergedAt,
    url: `https://github.com/${owner}/${repoName}/pull/${overrides.number}`,
    author: {
      __typename: overrides.authorTypename ?? "User",
      login: overrides.authorLogin ?? "testuser",
      databaseId: overrides.authorDatabaseId ?? 12345,
    },
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    repository: { nameWithOwner: `${owner}/${repoName}` },
  };
}

export function makeReviewNode(overrides: {
  databaseId: number;
  submittedAt: string;
  state?: string;
  authorLogin?: string;
  authorDatabaseId?: number;
  authorTypename?: string;
}) {
  return {
    databaseId: overrides.databaseId,
    submittedAt: overrides.submittedAt,
    state: overrides.state ?? "APPROVED",
    author: {
      __typename: overrides.authorTypename ?? "User",
      login: overrides.authorLogin ?? "reviewer1",
      databaseId: overrides.authorDatabaseId ?? 67890,
    },
  };
}

export function makePrWithReviewsNode(overrides: {
  number: number;
  reviews: ReturnType<typeof makeReviewNode>[];
  repo?: string;
}) {
  const repoFull = overrides.repo ?? "cogni-dao/cogni-template";
  const [owner, repoName] = repoFull.split("/");
  return {
    number: overrides.number,
    url: `https://github.com/${owner}/${repoName}/pull/${overrides.number}`,
    repository: { nameWithOwner: repoFull },
    reviews: { nodes: overrides.reviews },
  };
}

export function makeIssueNode(overrides: {
  number: number;
  closedAt: string;
  authorLogin?: string;
  authorDatabaseId?: number;
  authorTypename?: string;
  repo?: string;
}) {
  const repoFull = overrides.repo ?? "cogni-dao/cogni-template";
  const [owner, repoName] = repoFull.split("/");
  return {
    number: overrides.number,
    title: `Issue #${overrides.number}`,
    closedAt: overrides.closedAt,
    url: `https://github.com/${owner}/${repoName}/issues/${overrides.number}`,
    author: {
      __typename: overrides.authorTypename ?? "User",
      login: overrides.authorLogin ?? "issueauthor",
      databaseId: overrides.authorDatabaseId ?? 11111,
    },
    repository: { nameWithOwner: repoFull },
  };
}

export function wrapSearchResponse<T>(
  nodes: T[],
  hasNextPage = false,
  endCursor: string | null = null
) {
  return {
    search: {
      pageInfo: { hasNextPage, endCursor },
      nodes,
    },
  };
}
