// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ingestion-core/model`
 * Purpose: Domain types for activity ingestion — purpose-neutral, shared across ledger and governance consumers.
 * Scope: Pure types. Does not contain I/O, business logic, or adapter deps.
 * Invariants:
 * - ActivityEvent is purpose-neutral: no epoch, user, node, receipt, or payout fields.
 * - Adapter-side type only — mapping to DB tables (which add node_id) is the workflow/store's job.
 * - payloadHash is PROVENANCE_REQUIRED (SHA-256 of canonical payload).
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md#source-adapter-interface
 * @public
 */

/**
 * Raw activity event from an external source.
 * Purpose-neutral — consumed by ledger (→ curation → allocations) and governance (→ metrics, alerts).
 * The adapter produces these; the workflow/store maps them to DB rows with node_id, etc.
 */
export interface ActivityEvent {
  /** Canonical URL to the activity artifact */
  readonly artifactUrl: string;

  /** When the activity occurred on the source platform */
  readonly eventTime: Date;

  /** Event classification: "pr_merged", "review_submitted", "message_sent", "issue_closed" */
  readonly eventType: string;
  /**
   * Deterministic from source data. Format: "{source}:{type}:{scope}:{identifier}"
   * Examples: "github:pr:owner/repo:42", "discord:message:guild:channel:msgId"
   */
  readonly id: string;

  /** Source-specific payload. No domain-specific fields — raw provenance data only. */
  readonly metadata: Record<string, unknown>;

  /** SHA-256 of canonical payload fields (PROVENANCE_REQUIRED) */
  readonly payloadHash: string;

  /** Display-only actor name (GitHub username, Discord handle). May change over time. */
  readonly platformLogin?: string;

  /** Stable platform actor ID (GitHub numeric user ID, Discord snowflake). Never changes. */
  readonly platformUserId: string;

  /** Source platform: "github", "discord", etc. */
  readonly source: string;
}

/** Definition of a collectible stream within a source adapter. */
export interface StreamDefinition {
  /** How the cursor advances: ISO timestamp or opaque pagination token */
  readonly cursorType: "timestamp" | "token";

  /** Default polling interval in seconds */
  readonly defaultPollInterval: number;
  /** Stream identifier: "pull_requests", "reviews", "issues", "messages" */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;
}

/** Cursor checkpoint for incremental sync. One per (source, stream, scope). */
export interface StreamCursor {
  /** When this cursor was last used to fetch data */
  readonly retrievedAt: Date;
  /** Which stream this cursor belongs to */
  readonly streamId: string;

  /** Cursor value: ISO timestamp or opaque token */
  readonly value: string;
}

/** Parameters for a collect() call. */
export interface CollectParams {
  /** Resume from this cursor (null = start from window.since) */
  readonly cursor: StreamCursor | null;

  /** Maximum events to return (adapter may return fewer) */
  readonly limit?: number;
  /** Which streams to collect from */
  readonly streams: string[];

  /** Time window to collect within */
  readonly window: { readonly since: Date; readonly until: Date };
}

/** Result of a collect() call. */
export interface CollectResult {
  /** Collected events (may be empty if no new activity) */
  readonly events: readonly ActivityEvent[];

  /** Updated cursor for next incremental fetch */
  readonly nextCursor: StreamCursor;
}
