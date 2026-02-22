// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion`
 * Purpose: Barrel export for activity source adapters.
 * Scope: Re-exports adapter implementations. New adapters (Discord, etc.) added here.
 * Side-effects: none
 * @internal
 */

export {
  type GitHubAdapterConfig,
  GitHubSourceAdapter,
} from "./github";

export {
  type GitHubAppConfig,
  GitHubAppTokenProvider,
} from "./github-auth";

export { createGitHubClient, type GitHubClient } from "./octokit-client";
