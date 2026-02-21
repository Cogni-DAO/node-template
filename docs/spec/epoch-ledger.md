---
id: epoch-ledger-spec
type: spec
title: "Epoch Ledger: Weekly Activity Pipeline for Credit Payouts"
status: draft
spec_state: draft
trust: draft
summary: "Epoch-based ledger where source adapters ingest contribution activity (GitHub, Discord), the system proposes credit allocations via weight policy, and an admin finalizes the distribution. Payouts are deterministic and recomputable from stored data."
read_when: Working on credit payouts, activity ingestion, epoch lifecycle, weight policy, source adapters, or the ledger API.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-02-20
verified:
tags: [governance, transparency, payments, ledger]
---

# Epoch Ledger: Weekly Activity Pipeline for Credit Payouts

> The system is a **transparent activity-to-payout pipeline**. Every week it collects contribution activity from configured sources (GitHub, Discord), attributes events to contributors via identity bindings, proposes a credit distribution using a weight policy, and lets an admin finalize the result. Payouts are deterministic and recomputable from stored data. No server-held signing keys in V0.

## Key References

|              |                                                                                           |                                   |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------- |
| **Project**  | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Project roadmap                   |
| **Spike**    | [spike.0082](../../work/items/spike.0082.transparency-log-design.md)                      | Original design research          |
| **Research** | [epoch-event-ingestion-pipeline](../research/epoch-event-ingestion-pipeline.md)           | Ingestion pipeline research       |
| **Spec**     | [billing-evolution](./billing-evolution.md)                                               | Existing billing/credit system    |
| **Spec**     | [architecture](./architecture.md)                                                         | System architecture               |
| **Spec**     | [decentralized-identity](./decentralized-identity.md)                                     | Identity bindings (user_bindings) |

## Core Invariants

| Rule                     | Constraint                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACTIVITY_APPEND_ONLY     | DB trigger rejects UPDATE/DELETE on `activity_events`. Once ingested, activity records are immutable facts.                                                                                                                  |
| ACTIVITY_IDEMPOTENT      | `activity_events.id` is deterministic from source data (e.g., `github:pr:owner/repo:42`). Re-ingestion of the same event is a no-op (PK conflict → skip).                                                                    |
| POOL_IMMUTABLE           | DB trigger rejects UPDATE/DELETE on `epoch_pool_components`. Once recorded, a pool component's algorithm, inputs, and amount cannot be changed.                                                                              |
| IDENTITY_BEST_EFFORT     | Activity events carry `platform_user_id` and optional `platform_login`. Resolution to `user_id` via `user_bindings` is best-effort. Unresolved events have `user_id = NULL` and are excluded from allocation until resolved. |
| ADMIN_FINALIZES_ONCE     | An admin reviews proposed allocations, optionally adjusts `final_units`, then triggers finalize. Single action closes the epoch — no per-event approval workflow.                                                            |
| WEIGHTS_INTEGER_ONLY     | All weight values are integer milli-units (e.g., 8000 for PR merged, 500 for Discord message). No floating point anywhere (ALL_MATH_BIGINT).                                                                                 |
| PAYOUT_DETERMINISTIC     | Given final allocations + pool components → the payout statement is byte-for-byte reproducible.                                                                                                                              |
| ALL_MATH_BIGINT          | No floating point in unit or credit calculations. All math uses BIGINT with largest-remainder rounding.                                                                                                                      |
| EPOCH_CLOSE_IDEMPOTENT   | Closing a closed epoch returns the existing statement. No error, no mutation.                                                                                                                                                |
| ONE_OPEN_EPOCH           | Partial unique index enforces at most one epoch with `status = 'open'` per `node_id`.                                                                                                                                        |
| EPOCH_WINDOW_UNIQUE      | `UNIQUE(node_id, period_start, period_end)` prevents duplicate epochs for the same time window per node. Re-collection uses the existing epoch.                                                                              |
| CURATION_FREEZE_ON_CLOSE | DB trigger rejects INSERT/UPDATE/DELETE on `activity_curation` when the referenced epoch has `status = 'closed'`. Curation is mutable during review, immutable after close.                                                  |
| NODE_SCOPED              | All ledger tables include `node_id UUID NOT NULL`. Per node-operator-contract spec, prevents collisions in multi-node scenarios.                                                                                             |
| POOL_REPRODUCIBLE        | `pool_total_credits = SUM(epoch_pool_components.amount_credits)`. Each component stores algorithm version + inputs + amount.                                                                                                 |
| POOL_UNIQUE_PER_TYPE     | `UNIQUE(epoch_id, component_id)` — each component type appears at most once per epoch.                                                                                                                                       |
| POOL_REQUIRES_BASE       | At least one `base_issuance` component must exist before epoch finalize is allowed.                                                                                                                                          |
| WRITES_VIA_TEMPORAL      | All write operations (collect, finalize) execute in Temporal workflows via the existing `scheduler-worker` service. Next.js routes return 202 + workflow ID.                                                                 |
| PROVENANCE_REQUIRED      | Every activity event includes `producer`, `producer_version`, `payload_hash`, `retrieved_at`. Audit trail for reproducibility.                                                                                               |
| CURSOR_STATE_PERSISTED   | Source adapters use `source_cursors` table for incremental sync. Avoids full-window rescans and handles pagination/rate limits.                                                                                              |
| ADAPTERS_NOT_IN_CORE     | Source adapters live in `services/scheduler-worker/` behind a port interface. `packages/ledger-core/` contains only pure domain logic (types, rules, errors).                                                                |

## Design

### System Architecture

**Next.js** handles authentication (SIWE), authorization (admin check), read queries (direct DB), and write request enqueuing (start Temporal workflow, return 202).

**Temporal worker** (`services/scheduler-worker/`) handles all write/compute actions: activity collection via source adapters, identity resolution, allocation computation, epoch finalization. All workflows are idempotent via deterministic workflow IDs. The worker imports pure domain logic from `@cogni/ledger-core` and DB operations from `@cogni/db-client`.

**`packages/ledger-core/`** contains pure domain logic shared between the app and the worker: model types, `computePayouts()`, `computeProposedAllocations()`, and error classes. `src/core/ledger/public.ts` re-exports from this package so app code uses `@/core/ledger`.

**Postgres** stores the append-only activity events with DB-trigger enforcement of immutability.

### Auth Model (V0 — Simplified)

SIWE wallet login provides `{ id, walletAddress }` in the session. Write routes check a simple admin flag — no multi-role `ledger_issuers` table in V0.

Admin capability required for:

- Triggering activity collection (or let Temporal cron handle it)
- Adjusting allocation `final_units`
- Triggering epoch finalize
- Recording pool components

Read routes are public — anyone can view epochs, activity, allocations, and payout statements.

### Activity Ingestion

Source adapters collect contribution activity from external systems and normalize it into `activity_events`. Each adapter:

1. **Connects** to one external system via official OSS client (`@octokit/graphql`, `discord.js`)
2. **Fetches** events since last cursor (or within the epoch time window)
3. **Normalizes** to `ActivityEvent` with deterministic ID, provenance fields, and platform identity
4. **Inserts** idempotently (PK conflict = skip)

Identity resolution happens after ingestion: lookup `user_bindings` (from [decentralized-identity spec](./decentralized-identity.md)) to map `(source, platform_user_id)` → `user_id`. Unresolved events are flagged for admin attention.

### Weight Policy

Credit allocation uses a simple per-event-type weight configuration stored as integer milli-units:

```jsonc
// Example weight_config (stored in epoch.weight_config JSONB)
{
  "github:pr_merged": 8000, // 8.000 units
  "github:review_submitted": 2000, // 2.000 units
  "github:issue_closed": 1000, // 1.000 units
  "discord:message_sent": 500, // 0.500 units
}
```

Proposed allocation per user = SUM of weights for their attributed events. The weight config is pinned per epoch (stored in the epoch row) for reproducibility.

### Epoch Lifecycle

```
1. OPEN          Temporal cron (weekly) or admin triggers collection
                 → Creates epoch with period_start/period_end + weight_config
                 → Runs source adapters → activity_events
                 → Resolves identities → updates user_id on events
                 → Computes proposed allocations → epoch_allocations

2. REVIEW        Admin reviews proposed allocations via API/UI
                 → Adjusts final_units where needed (PATCH)
                 → Resolves unattributed events (link identities)
                 → Records pool components

3. FINALIZE      Admin triggers finalize
                 → Reads epoch_allocations (final_units, falling back to proposed_units)
                 → Reads pool components → pool_total_credits
                 → computePayouts(allocations, pool_total) → payout_statement
                 → Closes epoch
```

### Payout Computation

Unchanged from the original design. Given finalized allocations and a total pool:

1. Collect `final_units` per user (fall back to `proposed_units` if `final_units` is NULL)
2. Compute each user's share: `user_units / total_units`
3. Distribute `pool_total_credits` proportionally using BIGINT arithmetic
4. Apply largest-remainder rounding to ensure exact sum equals pool total
5. Output: `[{ user_id, total_units, share, amount_credits }]`

The allocation set hash (SHA-256 of canonical allocation data, sorted by user_id) pins the exact input set. Combined with `pool_total_credits` and `weight_config`, the payout is fully deterministic and reproducible.

### Pool Model

Unchanged. Each epoch's credit budget is the sum of independently computed pool components:

- **`base_issuance`** — constant amount per epoch (bootstraps early-stage work)
- **`kpi_bonus_v0`** — computed from DAO-defined KPI snapshots with pinned algorithm
- **`top_up`** — explicit governance allocation with evidence link

Each component stores `algorithm_version`, `inputs_json`, `amount_credits`, and `evidence_ref`.

### Verification

`GET /api/v1/ledger/verify/epoch/:id` performs independent verification from **stored data only** (not re-fetching from GitHub/Discord, which may be private or non-deterministic):

1. Fetch all `activity_events` for the epoch
2. Recompute proposed allocations from events + stored `weight_config`
3. Read `epoch_allocations` (final_units)
4. Recompute payouts from allocations + pool components
5. Compare recomputed values against stored statement
6. Return verification report

## Schema

### `epochs` — one open epoch at a time per node

| Column               | Type         | Notes                                                  |
| -------------------- | ------------ | ------------------------------------------------------ |
| `id`                 | BIGSERIAL PK |                                                        |
| `node_id`            | UUID         | NOT NULL — per NODE_SCOPED                             |
| `status`             | TEXT         | CHECK IN (`'open'`, `'closed'`)                        |
| `period_start`       | TIMESTAMPTZ  | Epoch coverage start (NOT NULL)                        |
| `period_end`         | TIMESTAMPTZ  | Epoch coverage end (NOT NULL)                          |
| `weight_config`      | JSONB        | Milli-unit weights used for this epoch (NOT NULL)      |
| `pool_total_credits` | BIGINT       | Sum of pool components (set at close, NULL while open) |
| `opened_at`          | TIMESTAMPTZ  |                                                        |
| `closed_at`          | TIMESTAMPTZ  | NULL while open                                        |
| `created_at`         | TIMESTAMPTZ  |                                                        |

Constraints:

- Partial unique index `UNIQUE (node_id, status) WHERE status = 'open'` enforces ONE_OPEN_EPOCH per node
- `UNIQUE(node_id, period_start, period_end)` enforces EPOCH_WINDOW_UNIQUE

### `activity_events` — append-only contribution records (Layer 1)

| Column             | Type        | Notes                                                             |
| ------------------ | ----------- | ----------------------------------------------------------------- |
| `node_id`          | UUID        | NOT NULL — part of composite PK (NODE_SCOPED)                     |
| `id`               | TEXT        | Deterministic from source (e.g., `github:pr:org/repo:42`)         |
| `source`           | TEXT        | NOT NULL — `github`, `discord`                                    |
| `event_type`       | TEXT        | NOT NULL — `pr_merged`, `review_submitted`, etc.                  |
| `platform_user_id` | TEXT        | NOT NULL — GitHub numeric ID, Discord snowflake                   |
| `platform_login`   | TEXT        | Display name (github username, discord handle)                    |
| `artifact_url`     | TEXT        | Canonical link to the activity                                    |
| `metadata`         | JSONB       | Source-specific payload                                           |
| `payload_hash`     | TEXT        | NOT NULL — SHA-256 of canonical payload (PROVENANCE_REQUIRED)     |
| `producer`         | TEXT        | NOT NULL — Adapter name (PROVENANCE_REQUIRED)                     |
| `producer_version` | TEXT        | NOT NULL — Adapter version (PROVENANCE_REQUIRED)                  |
| `event_time`       | TIMESTAMPTZ | NOT NULL — When the activity happened                             |
| `retrieved_at`     | TIMESTAMPTZ | NOT NULL — When adapter fetched from source (PROVENANCE_REQUIRED) |
| `ingested_at`      | TIMESTAMPTZ | DB insert time                                                    |

Composite PK: `(node_id, id)`. No `epoch_id` — epoch membership assigned at curation layer. No `user_id` — identity resolution lands in `activity_curation.user_id` (truly immutable raw log).

DB trigger rejects UPDATE/DELETE (ACTIVITY_APPEND_ONLY).

Indexes: `(node_id, event_time)`, `(source, event_type)`, `(platform_user_id)`

### `activity_curation` — identity resolution + admin decisions (Layer 2)

| Column                  | Type             | Notes                                            |
| ----------------------- | ---------------- | ------------------------------------------------ |
| `id`                    | UUID PK          |                                                  |
| `node_id`               | UUID             | NOT NULL (NODE_SCOPED)                           |
| `epoch_id`              | BIGINT FK→epochs | Assigns epoch membership to an event             |
| `event_id`              | TEXT             | FK→activity_events.id                            |
| `user_id`               | TEXT FK→users    | Resolved cogni user (NULL = unresolved)          |
| `included`              | BOOLEAN          | NOT NULL DEFAULT true — admin can exclude spam   |
| `weight_override_milli` | BIGINT           | Override weight_config for this event (nullable) |
| `note`                  | TEXT             | Admin rationale                                  |
| `created_at`            | TIMESTAMPTZ      |                                                  |
| `updated_at`            | TIMESTAMPTZ      |                                                  |

Constraint: `UNIQUE(epoch_id, event_id)`

DB trigger rejects INSERT/UPDATE/DELETE when `epochs.status = 'closed'` (CURATION_FREEZE_ON_CLOSE). Mutable during review, frozen after close.

### `epoch_allocations` — per-user credit distribution

| Column            | Type             | Notes                                              |
| ----------------- | ---------------- | -------------------------------------------------- |
| `id`              | UUID PK          |                                                    |
| `node_id`         | UUID             | NOT NULL (NODE_SCOPED)                             |
| `epoch_id`        | BIGINT FK→epochs |                                                    |
| `user_id`         | TEXT FK→users    | NOT NULL                                           |
| `proposed_units`  | BIGINT NOT NULL  | Computed from weight policy                        |
| `final_units`     | BIGINT           | Admin-set (NULL = not yet finalized, use proposed) |
| `override_reason` | TEXT             | Why admin changed it                               |
| `activity_count`  | INT NOT NULL     | Number of events attributed to this user           |
| `created_at`      | TIMESTAMPTZ      |                                                    |
| `updated_at`      | TIMESTAMPTZ      |                                                    |

Constraint: `UNIQUE(epoch_id, user_id)`

### `source_cursors` — adapter sync state

| Column         | Type        | Notes                                      |
| -------------- | ----------- | ------------------------------------------ |
| `node_id`      | UUID        | NOT NULL (NODE_SCOPED)                     |
| `source`       | TEXT        | `github`, `discord`                        |
| `stream`       | TEXT        | `pull_requests`, `reviews`, `messages`     |
| `scope`        | TEXT        | `cogni-dao/cogni-template`, `guild:123456` |
| `cursor_value` | TEXT        | Timestamp or opaque pagination token       |
| `retrieved_at` | TIMESTAMPTZ | When this cursor was last used             |

Primary key: `(node_id, source, stream, scope)`

### `epoch_pool_components` — immutable, append-only, pinned inputs

Unchanged from original spec. See [original schema](#pool-model).

| Column              | Type             | Notes                                          |
| ------------------- | ---------------- | ---------------------------------------------- |
| `id`                | UUID PK          |                                                |
| `node_id`           | UUID             | NOT NULL (NODE_SCOPED)                         |
| `epoch_id`          | BIGINT FK→epochs |                                                |
| `component_id`      | TEXT             | e.g. `base_issuance`, `kpi_bonus_v0`, `top_up` |
| `algorithm_version` | TEXT             | Git SHA or semver of the algorithm             |
| `inputs_json`       | JSONB            | Snapshotted KPI values used for computation    |
| `amount_credits`    | BIGINT           | Computed credit amount for this component      |
| `evidence_ref`      | TEXT             | Link to KPI source or governance vote          |
| `computed_at`       | TIMESTAMPTZ      |                                                |

DB trigger rejects UPDATE/DELETE (POOL_IMMUTABLE).
Constraint: `UNIQUE(epoch_id, component_id)` (POOL_UNIQUE_PER_TYPE).

### `payout_statements` — one per closed epoch, derived artifact (Layer 3)

| Column                    | Type                      | Notes                                               |
| ------------------------- | ------------------------- | --------------------------------------------------- |
| `id`                      | UUID PK                   |                                                     |
| `node_id`                 | UUID                      | NOT NULL (NODE_SCOPED)                              |
| `epoch_id`                | BIGINT FK→epochs          | UNIQUE(node_id, epoch_id) — one statement per epoch |
| `allocation_set_hash`     | TEXT                      | SHA-256 of canonical finalized allocations          |
| `pool_total_credits`      | BIGINT                    | Must match epoch's pool_total_credits               |
| `payouts_json`            | JSONB                     | `[{user_id, total_units, share, amount_credits}]`   |
| `supersedes_statement_id` | UUID FK→payout_statements | For post-signing corrections (nullable)             |
| `created_at`              | TIMESTAMPTZ               |                                                     |

Post-signing corrections use amendment statements (`supersedes_statement_id`), never reopen-and-edit.

### `statement_signatures` — client-side EIP-191 signatures (schema only)

| Column          | Type                      | Notes                        |
| --------------- | ------------------------- | ---------------------------- |
| `id`            | UUID PK                   |                              |
| `node_id`       | UUID                      | NOT NULL (NODE_SCOPED)       |
| `statement_id`  | UUID FK→payout_statements |                              |
| `signer_wallet` | TEXT                      | NOT NULL                     |
| `signature`     | TEXT                      | NOT NULL — EIP-191 signature |
| `signed_at`     | TIMESTAMPTZ               | NOT NULL                     |

Constraint: `UNIQUE(statement_id, signer_wallet)`

Signing UX/API is a follow-up task. Table + types defined for schema completeness.

## Source Adapter Interface

```typescript
// Port definition (src/ports/source-adapter.port.ts)

export interface SourceAdapter {
  readonly source: string; // "github", "discord"
  readonly version: string; // bump on schema changes

  streams(): StreamDefinition[];

  /**
   * Collect activity events. Idempotent (deterministic IDs).
   * Uses cursor for incremental sync. Returns events + next cursor.
   */
  collect(params: {
    streams: string[];
    cursor: StreamCursor | null;
    window: { since: Date; until: Date };
    limit?: number;
  }): Promise<{ events: ActivityEvent[]; nextCursor: StreamCursor }>;

  /** Optional webhook handler for real-time fast-path (GitHub). */
  handleWebhook?(payload: unknown): Promise<ActivityEvent[]>;
}

export interface ActivityEvent {
  id: string; // deterministic: "github:pr:owner/repo:42"
  source: string;
  eventType: string;
  platformUserId: string; // GitHub numeric ID, Discord snowflake
  platformLogin?: string; // display name
  artifactUrl: string;
  metadata: Record<string, unknown>;
  payloadHash: string; // SHA-256 of canonical payload
  eventTime: Date;
}

export interface StreamDefinition {
  id: string; // "pull_requests", "reviews", "messages"
  name: string;
  cursorType: "timestamp" | "token";
  defaultPollInterval: number; // seconds
}

export interface StreamCursor {
  streamId: string;
  value: string;
  retrievedAt: Date;
}
```

Adapters live in `services/scheduler-worker/src/adapters/ingestion/` (ADAPTERS_NOT_IN_CORE). They use official OSS clients: `@octokit/graphql` for GitHub, `discord.js` for Discord.

## API

### Write Routes (SIWE + admin check → Temporal workflow → 202)

| Method | Route                                       | Purpose                                            |
| ------ | ------------------------------------------- | -------------------------------------------------- |
| POST   | `/api/v1/ledger/epochs/collect`             | Trigger activity collection for new/existing epoch |
| PATCH  | `/api/v1/ledger/epochs/:id/allocations`     | Admin adjusts final_units for users                |
| POST   | `/api/v1/ledger/epochs/:id/pool-components` | Record a pool component for the epoch              |
| POST   | `/api/v1/ledger/epochs/:id/finalize`        | Finalize epoch → compute payouts                   |

### Read Routes (public)

| Method | Route                                   | Purpose                                      |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/ledger/epochs`                 | List all epochs                              |
| GET    | `/api/v1/ledger/epochs/:id/activity`    | Activity events for an epoch                 |
| GET    | `/api/v1/ledger/epochs/:id/allocations` | Proposed + final allocations                 |
| GET    | `/api/v1/ledger/epochs/:id/statement`   | Payout statement for a closed epoch          |
| GET    | `/api/v1/ledger/verify/epoch/:id`       | Recompute payouts from stored data + compare |

## Temporal Workflows

### CollectEpochWorkflow

1. Create or find epoch for the target time window (EPOCH_WINDOW_UNIQUE)
2. Check no epoch currently open for a different window (ONE_OPEN_EPOCH)
3. For each registered source adapter:
   - Activity: load cursor from `source_cursors`
   - Activity: `adapter.collect({ streams, cursor, window })` → events
   - Activity: insert `activity_events` (idempotent by PK)
   - Activity: save cursor to `source_cursors`
4. Activity: resolve identities — lookup `user_bindings` for each `(source, platform_user_id)` → set `user_id`
5. Activity: compute proposed allocations from events + weight_config → insert `epoch_allocations`

Deterministic workflow ID: `ledger-collect-{periodStart}-{periodEnd}`

### FinalizeEpochWorkflow

1. Verify epoch exists and is open
2. If epoch already closed, return existing statement (EPOCH_CLOSE_IDEMPOTENT)
3. Verify at least one `base_issuance` pool component exists (POOL_REQUIRES_BASE)
4. Read `epoch_allocations` — use `final_units` where set, fall back to `proposed_units`
5. Read pool components, compute `pool_total_credits = SUM(amount_credits)`
6. `computePayouts(allocations, pool_total)` — BIGINT, largest-remainder
7. Compute `allocation_set_hash`
8. Atomic transaction: set `pool_total_credits` on epoch, update status to `'closed'`, insert payout statement
9. Return statement

Deterministic workflow ID: `ledger-finalize-{epochId}`

## V1+ Deferred Features

The following are explicitly deferred from V0 and will be designed when needed:

- **Per-receipt wallet signing** (EIP-191, SIGNATURE_DOMAIN_BOUND) — V1: receipts as signed artifacts
- **`ledger_issuers` role system** (can_issue, can_approve, can_close_epoch) — V1: multi-role authorization
- **Receipt approval lifecycle** (proposed → approved → revoked, LATEST_EVENT_WINS) — V1: per-receipt workflows
- **Cryptographic verification** — V0 verifies by recomputing from stored data; V1 adds signature verification
- **Merkle trees / inclusion proofs** — V1+
- **Statement signing** (DAO multisig) — V1+
- **UI pages** — V1+
- **DID/VC alignment** — V2+
- **Automated webhook fast-path** (GitHub `handleWebhook`) — V1: real-time ingestion

## Goal

Enable transparent, verifiable credit distribution where contribution activity is automatically collected, valued via explicit weight policy, and finalized by an admin. Anyone can recompute the payout table from stored data.

## Non-Goals

- Algorithmic valuation (SourceCred-style scoring) — weights are transparent, admin adjustable
- Server-held signing keys
- Full RBAC system (V0 uses simple admin check)
- Real-time streaming (poll-based collection sufficient for weekly epochs)

## Related

- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [billing-evolution](./billing-evolution.md) — Existing credit/billing system
- [billing-ingest](./billing-ingest.md) — Callback-driven billing pipeline
- [architecture](./architecture.md) — System architecture
- [sourcecred](./sourcecred.md) — SourceCred as-built (being superseded)
- [decentralized-identity](./decentralized-identity.md) — User identity bindings (`user_id` is canonical)
- [ai-governance-data](./ai-governance-data.md) — Autonomous governance agents (separate concern)
