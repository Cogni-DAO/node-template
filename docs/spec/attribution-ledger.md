---
id: attribution-ledger-spec
type: spec
title: "Attribution Ledger: Weekly Attribution Pipeline for Credit Statements"
status: draft
spec_state: active
trust: draft
summary: "Epoch-based attribution pipeline with three plugin surfaces: source adapters ingest contribution activity, epoch enrichers produce typed evaluations from selected receipts, and allocation algorithms distribute credits. Statements are deterministic and recomputable from stored data."
read_when: Working on credit statements, activity ingestion, epoch enrichers, epoch evaluations, epoch lifecycle, weight policy, source adapters, allocation algorithms, or the attribution API.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-02-20
verified: 2026-03-01
tags: [governance, transparency, payments, attribution]
---

# Attribution Ledger: Weekly Attribution Pipeline for Credit Statements

> The system is a **transparent activity-to-statement pipeline** with three plugin surfaces. Every week: (1) **source adapters** collect contribution activity from configured sources, (2) **epoch enrichers** produce typed evaluations from selected receipts (e.g., work-item links, quality scores), and (3) **allocation algorithms** distribute credits using weight policy and enricher evaluations. An admin finalizes the result. Statements are deterministic and recomputable from stored data. No server-held signing keys in V0.

## Key References

|              |                                                                                           |                                                            |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Project**  | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Project roadmap                                            |
| **Spike**    | [spike.0082](../../work/items/spike.0082.transparency-log-design.md)                      | Original design research                                   |
| **Research** | [epoch-event-ingestion-pipeline](../research/epoch-event-ingestion-pipeline.md)           | Ingestion pipeline research                                |
| **Spec**     | [billing-evolution](./billing-evolution.md)                                               | Existing billing/credit system                             |
| **Spec**     | [architecture](./architecture.md)                                                         | System architecture                                        |
| **Spec**     | [decentralized-identity](./decentralized-user-identity.md)                                | Identity bindings (user_bindings)                          |
| **Spec**     | [identity-model](./identity-model.md)                                                     | All identity primitives (node_id, scope_id, user_id, etc.) |

## Core Invariants

| Rule                             | Constraint                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| RECEIPT_APPEND_ONLY              | DB trigger rejects UPDATE/DELETE on `ingestion_receipts`. Once ingested, receipt records are immutable facts.                                                                                                                                                                                                                                                                           |
| RECEIPT_IDEMPOTENT               | `ingestion_receipts.id` is deterministic from source data (e.g., `github:pr:owner/repo:42`). Re-ingestion of the same receipt is a no-op (PK conflict → skip).                                                                                                                                                                                                                          |
| POOL_IMMUTABLE                   | DB trigger rejects UPDATE/DELETE on `epoch_pool_components`. Once recorded, a pool component's algorithm, inputs, and amount cannot be changed.                                                                                                                                                                                                                                         |
| IDENTITY_BEST_EFFORT             | Ingestion receipts carry `platform_user_id` and optional `platform_login`. Resolution to `user_id` via `user_bindings` is best-effort. Unresolved receipts keep `user_id = NULL` in selection, but claimant-share evaluations preserve them as identity claimants so attribution remains visible and can resolve later when bindings appear.                                            |
| ADMIN_FINALIZES_ONCE             | An admin reviews proposed allocations, optionally adjusts `final_units`, then triggers finalize. Single action closes the epoch — no per-event approval workflow.                                                                                                                                                                                                                       |
| APPROVERS_PER_SCOPE              | Each scope declares its own `approvers[]` list. Epoch finalize requires 1-of-N EIP-191 signature from the scope's approvers. V0: single scope, single approver in repo-spec. Multi-scope: each `.cogni/projects/*.yaml` carries its own list.                                                                                                                                           |
| SIGNATURE_SCOPE_BOUND            | Signed message must include `node_id + scope_id + allocation_set_hash`. Prevents cross-scope and cross-node signature replay.                                                                                                                                                                                                                                                           |
| EPOCH_THREE_PHASE                | Epochs progress through `open → review → finalized`. No backward transitions. `open`: ingest + select. `review`: ingestion closed, selection still allowed. `finalized`: immutable forever.                                                                                                                                                                                             |
| INGESTION_CLOSED_ON_REVIEW       | App-level enforcement — `CollectEpochWorkflow` exits when `epoch.status != 'open'`. No DB trigger on `ingestion_receipts` (V0) because `ingestion_receipts` has no `epoch_id` column; epoch membership is determined at the selection layer. Raw facts locked once review begins; late arrivals rejected. Selection (inclusion, weight overrides, identity resolution) remains mutable. |
| WEIGHTS_INTEGER_ONLY             | All weight values are integer milli-units (e.g., 8000 for PR merged, 500 for Discord message). No floating point anywhere (ALL_MATH_BIGINT).                                                                                                                                                                                                                                            |
| STATEMENT_DETERMINISTIC          | Given final allocations + pool components → the epoch statement is byte-for-byte reproducible.                                                                                                                                                                                                                                                                                          |
| ALL_MATH_BIGINT                  | No floating point in unit or credit calculations. All math uses BIGINT with largest-remainder rounding.                                                                                                                                                                                                                                                                                 |
| EPOCH_FINALIZE_IDEMPOTENT        | Finalizing a finalized epoch returns the existing statement. No error, no mutation.                                                                                                                                                                                                                                                                                                     |
| ONE_OPEN_EPOCH                   | Partial unique index `WHERE status = 'open'` enforces at most one open epoch per `(node_id, scope_id)` pair. Review epochs coexist with the next open epoch — no schedule deadlock.                                                                                                                                                                                                     |
| EPOCH_WINDOW_UNIQUE              | `UNIQUE(node_id, scope_id, period_start, period_end)` prevents duplicate epochs for the same time window per scope. Re-collection uses the existing epoch.                                                                                                                                                                                                                              |
| SELECTION_FREEZE_ON_FINALIZE     | DB trigger rejects INSERT/UPDATE/DELETE on `epoch_selection` when the referenced epoch has `status = 'finalized'`. Selection is mutable during `open` and `review`, immutable only after finalize.                                                                                                                                                                                      |
| SELECTION_AUTO_POPULATE          | Auto-population inserts selection rows for new receipts and updates `user_id` only on rows where it's NULL. Never overwrites admin-set fields (`included`, `weight_override_milli`, `note`). Delta processing: skip receipts already selected with a resolved `user_id`.                                                                                                                |
| NODE_SCOPED                      | All attribution tables include `node_id UUID NOT NULL`. Per node-operator-contract spec, prevents collisions in multi-node scenarios.                                                                                                                                                                                                                                                   |
| SCOPE_SCOPED                     | All epoch-level tables include `scope_id UUID NOT NULL`. `scope_id` identifies the governance/statement domain (project) within a node. Derived deterministically: `uuidv5(node_id, scope_key)`. See [Project Scoping](#project-scoping).                                                                                                                                               |
| RECEIPT_SCOPE_AGNOSTIC           | Ingestion receipts carry no `scope_id` — they are global facts. Scope is assigned at the selection layer via epoch membership. One receipt can be selected into multiple scope-specific epochs.                                                                                                                                                                                         |
| EVALUATION_LOCKED_IMMUTABLE      | DB trigger rejects UPDATE/DELETE on `epoch_evaluations` rows with `status='locked'`. Locked evaluations are immutable facts. INSERT of new locked rows is allowed (during `closeIngestionWithEvaluations`).                                                                                                                                                                             |     |
| POOL_REPRODUCIBLE                | `pool_total_credits = SUM(epoch_pool_components.amount_credits)`. Each component stores algorithm version + inputs + amount.                                                                                                                                                                                                                                                            |
| POOL_UNIQUE_PER_TYPE             | `UNIQUE(epoch_id, component_id)` — each component type appears at most once per epoch.                                                                                                                                                                                                                                                                                                  |
| POOL_REQUIRES_BASE               | At least one `base_issuance` component must exist before epoch finalize is allowed.                                                                                                                                                                                                                                                                                                     |
| WRITES_VIA_TEMPORAL              | All write operations (collect, finalize) execute in Temporal workflows via the existing `scheduler-worker` service. Next.js routes return 202 + workflow ID.                                                                                                                                                                                                                            |
| PROVENANCE_REQUIRED              | Every ingestion receipt includes `producer`, `producer_version`, `payload_hash`, `retrieved_at`. Audit trail for reproducibility.                                                                                                                                                                                                                                                       |
| SCOPE_GATED_QUERIES              | `DrizzleAttributionAdapter` takes `scopeId` at construction. Every epochId-based read/write calls `resolveEpochScoped(epochId)` — `WHERE id = $epochId AND scope_id = $scopeId`. Scope mismatches throw `EpochNotFoundError` (indistinguishable from missing epoch). No port signature changes; scope is an adapter-internal concern.                                                   |
| CURSOR_STATE_PERSISTED           | Source adapters use `ingestion_cursors` table for incremental sync. Avoids full-window rescans and handles pagination/rate limits.                                                                                                                                                                                                                                                      |
| ADAPTERS_NOT_IN_CORE             | Source adapters live in `services/scheduler-worker/` behind a port interface. `packages/attribution-ledger/` contains only pure domain logic (types, rules, errors).                                                                                                                                                                                                                    |
| EVALUATION_UNIQUE_PER_REF_STATUS | `UNIQUE(epoch_id, evaluation_ref, status)` — one draft + one locked row per evaluation ref per epoch. Drafts overwritten via UPSERT; locked evaluations written once at `closeIngestionWithEvaluations`.                                                                                                                                                                                |
| EVALUATION_FINAL_ATOMIC          | Locked evaluation writes + `evaluations_hash` computation + epoch `open→review` transition happen in a single DB transaction. No partial finalization. If any step fails, nothing commits.                                                                                                                                                                                              |
| STATEMENT_FROM_FINAL_ONLY        | `computeProposedAllocations` for statement purposes MUST consume only `status='locked'` evaluations. Draft evaluations are explicitly excluded from any binding computation.                                                                                                                                                                                                            |
| CANONICAL_JSON                   | All payload and inputs hashing uses `canonicalJsonStringify()` — sorted keys at every depth, no whitespace, BigInt serialized as string. Defined once in `packages/attribution-ledger/src/hashing.ts`, used everywhere.                                                                                                                                                                 |
| INPUTS_HASH_COMPLETE             | Each enricher defines its own `inputs_hash` covering ALL meaningful dependencies consumed. Canonically serialized before hashing. If any input changes, `inputs_hash` changes, and the system knows the evaluation is stale.                                                                                                                                                            |
| PAYLOAD_HASH_COVERS_CONTENT      | `payload_hash` = SHA-256 of `canonicalJsonStringify(payload)`. Stored in DB regardless of inline vs. object storage. `evaluations_hash` on the epoch uses `payload_hash`, never re-serializes.                                                                                                                                                                                          |
| ENRICHER_SNAPSHOT_RULE           | Enrichers may do I/O (read files, call APIs), but anything learned from outside the attribution store MUST be snapshotted into the evaluation payload (or referenced by content-hash). If it's not in the evaluation, it doesn't exist for scoring. No live reads during allocation.                                                                                                    |
| EVALUATION_REF_NAMESPACED        | Evaluation refs follow `org.type.version` format (e.g., `cogni.work_item_links.v0`, `cogni.echo.v0`). Regex: `/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.v\d+$/`. Prevents cross-team collisions.                                                                                                                                                                                               |
| WEIGHT_PINNING                   | Weight config is set at epoch creation. Subsequent collection runs use the existing epoch's `weight_config`, not the input-derived config. Config drift logs a warning. `weight_config_hash` (SHA-256 of canonical JSON) is computed and locked at `closeIngestion` as the reproducibility anchor.                                                                                      |
| CONFIG_LOCKED_AT_REVIEW          | At `closeIngestion` (open→review), the epoch's `weight_config_hash` and `allocation_algo_ref` are computed and locked. These fields are NULL while open and immutable after review. All subsequent verification and statement computation uses these locked snapshots.                                                                                                                  |
| ALLOCATION_ALGO_PINNED           | `allocation_algo_ref` is NULL while epoch is open, set at `closeIngestion`. `computeProposedAllocations(algoRef, events, weightConfig)` dispatches to the correct versioned algorithm. Same inputs + same algoRef → identical output. V0: `weight-sum-v0` (simple per-event-type weight sum). Future: content-addressable ref.                                                          |
| ALLOCATION_PRESERVES_OVERRIDES   | Periodic recomputation (upsert) updates only `proposed_units` and `activity_count`. Never touches admin-set `final_units` or `override_reason`. Stale allocations (user no longer in proposed set) are auto-removed only if `final_units IS NULL` — admin overrides are never auto-deleted.                                                                                             |
| POOL_LOCKED_AT_REVIEW            | No new pool component inserts after `closeIngestion` (open→review). `component_id` validated against V0 allowlist: `base_issuance`, `kpi_bonus_v0`, `top_up`. Application-level enforcement.                                                                                                                                                                                            |
| EPOCH_WINDOW_DETERMINISTIC       | Epoch boundaries computed by `computeEpochWindowV1()` — pure function, Monday-aligned UTC, anchored to 2026-01-05. Same `(asOf, epochLengthDays)` always yields the same window.                                                                                                                                                                                                        |

## Project Scoping

The attribution ledger uses two orthogonal scoping keys:

- **`node_id`** (UUID) — Deployment identity. Identifies the running instance. One node = one database, one set of infrastructure, one `docker compose up`. Never overloaded for governance semantics. See [identity-model spec](./identity-model.md).
- **`scope_id`** (UUID) — Governance/statement domain. Identifies which **project** an epoch, its activity, and its statements belong to. Derived deterministically as `uuidv5(node_id, scope_key)` where `scope_key` is the human-readable slug (e.g., `'default'`). A project is a human-defined ownership boundary (e.g., "chat service", "shared infrastructure", "code review daemon") with its own DAO, weight policy, and payment rails.

**Terminology:** "Project" is the human concept. `scope_id` is the canonical database key. `scope_id` is not necessarily a filesystem path — path-based routing is one resolver strategy, but scopes can also be assigned by repository, by label, or by explicit declaration.

**V0 default:** All nodes start with a single scope: `scope_key = 'default'`, `scope_id = uuidv5(node_id, 'default')`. The scope UUID is declared in `repo-spec.yaml`. Multi-scope support activates when `.cogni/projects/*.yaml` manifests are added.

**Composite invariants:**

- `ONE_OPEN_EPOCH` → `UNIQUE(node_id, scope_id) WHERE status = 'open'`
- `EPOCH_WINDOW_UNIQUE` → `UNIQUE(node_id, scope_id, period_start, period_end)`
- Workflow IDs include scope: `ledger-collect-{scopeId}-{periodStart}-{periodEnd}`

**Scope resolution at ingestion:**

1. Activity event arrives (e.g., a merged PR touching `apps/chat/src/thread.ts`)
2. Resolver maps the event to a `scope_id` using project manifest rules (file path patterns, repository name, explicit labels)
3. If the resolved `scope_id` is not in the current manifest set, the event is **rejected** (not silently dropped, not assigned to default)
4. Events touching files in multiple scopes generate **one event per scope** (the same PR can attribute to multiple projects)

**Scope validation:** The `scope_id` on every `ingestion_receipts` row must reference a scope UUID declared in `.cogni/projects/*.yaml` (or match the node's `scope_id` from `repo-spec.yaml` for V0 default scope). This is enforced at the application layer during ingestion — not via FK constraint, since manifests are YAML files, not DB rows.

## Design

### System Architecture

**Next.js** handles authentication (SIWE), authorization (admin check), read queries (direct DB), and write request enqueuing (start Temporal workflow, return 202).

**Temporal worker** (`services/scheduler-worker/`) handles all write/compute actions: activity collection via source adapters, identity resolution, allocation computation, epoch finalization. All workflows are idempotent via deterministic workflow IDs. The worker imports pure domain logic from `@cogni/attribution-ledger` and DB operations from `@cogni/db-client`.

**`packages/attribution-ledger/`** contains pure domain logic shared between the app and the worker: model types, `computeStatementItems()`, `computeProposedAllocations()`, and error classes. `src/core/attribution/public.ts` re-exports from this package so app code uses `@/core/attribution`.

**Postgres** stores the append-only ingestion receipts with DB-trigger enforcement of immutability.

### Auth Model (V0 — Simplified)

SIWE wallet login provides `{ id, walletAddress }` in the session. Authorization is a per-scope wallet allowlist — no multi-role `ledger_issuers` table in V0.

**Approver configuration** follows the repo-spec pattern (committed to repo, no env override, same as `node_id` and `dao_contract`):

```yaml
# .cogni/repo-spec.yaml — V0 default scope
ledger:
  approvers:
    - "0xYourWalletAddress"
```

V0 has one scope (`default`), so `ledger.approvers` in repo-spec.yaml is the single source of truth. When multi-scope activates, each `.cogni/projects/*.yaml` carries its own `ledger.approvers[]` list, overriding the repo-spec default for that scope.

Loaded via `getLedgerConfig()` in `repoSpec.server.ts`, validated by Zod schema (array of EVM addresses), cached at startup.

Admin capability (wallet must be in scope's `approvers[]`) required for:

- Triggering activity collection (or let Temporal cron handle it)
- Adjusting allocation `final_units`
- Triggering epoch finalize
- Recording pool components
- Signing epoch statements (EIP-191, required before finalize)

Public read routes expose closed-epoch data only (epochs list, allocations, statements). Ingestion receipts (PII fields: platformUserId, platformLogin, artifactUrl) require SIWE authentication. Open/current epoch data requires SIWE authentication.

### Pipeline Architecture — Three Plugin Surfaces

The attribution pipeline has three composable extension points. Each surface has a stable contract; new implementations slot in without touching core code.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CollectEpochWorkflow                                │
│                                                                             │
│  1. SOURCE ADAPTERS          SourceAdapter → IngestionReceipt[]             │
│     "What happened?"         GitHub, Discord, manual...                     │
│     Standardized receipt:    id, source, eventType, platformUserId,         │
│                              metadata (bag of facts), payloadHash           │
│                                                                             │
│  2. EPOCH ENRICHERS          Enricher activity → EpochEvaluation            │
│     "What does it mean?"     work-item-linker, echo, ai-scorer...           │
│     Reads selected receipts  Each evaluation: evaluationRef, algoRef,       │
│     + external context.      inputsHash, payloadHash, payload               │
│     Emits typed evaluations. Draft = UI/estimates.                          │
│     Draft on each pass,      Locked = statements.                           │
│     locked at close.         Stored in epoch_evaluations table.             │
│                                                                             │
│  3. ALLOCATION ALGORITHMS    algoRef dispatch → ProposedAllocation[]        │
│     "Who gets what?"         weight-sum-v0, work-item-budget-v0...          │
│     Pure function.           Consumes selected receipts + locked evals.     │
│     No I/O. Deterministic.   Same inputs + same algoRef → identical output. │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Surface 1 (Source Adapters)** is fully implemented. See [Source Adapter Interface](#source-adapter-interface).

**Surface 2 (Epoch Enrichers)** is the enrichment layer between "raw facts collected" and "allocation computed." Enrichers run as Temporal activities, consuming selected receipts via `getSelectedReceiptsWithMetadata()` and producing typed `EpochEvaluation` rows. Each enricher defines its own `evaluation_ref` (namespaced: `cogni.work_item_links.v0`), `algo_ref`, `inputs_hash` composition, and payload shape. The pipeline validates evaluation envelopes (ref format, hash format) but treats payloads as opaque — payload shape is per-plugin.

**Surface 3 (Allocation Algorithms)** dispatches by `algoRef`. V0: `weight-sum-v0` ignores evaluations. Future: `work-item-budget-v0` reads `cogni.work_item_links.v0` evaluations.

### Evaluation Lifecycle (Draft/Locked)

All three layers run continuously throughout an epoch:

- **Ingestion** — adapters collect events on each scheduled pass
- **Enrichment** — enrichers re-run on each pass, emitting `status='draft'` evaluations. Drafts power the UI (provisional work-item links, projected allocations). Drafts are overwritten on each pass (UPSERT by `epoch_id + evaluation_ref + status='draft'`).
- **Allocation** — can run against draft evaluations for UI projections (labeled provisional)

At **closeIngestion** (EVALUATION_FINAL_ATOMIC):

1. Enrichers run one final time against the complete selected receipt set
2. Locked evaluations written as NEW rows (`status='locked'`) alongside existing drafts
3. In a **single DB transaction**: insert locked evaluations + compute `artifacts_hash` + transition epoch `open→review`
4. After this point: locked evaluations are immutable (EVALUATION_LOCKED_IMMUTABLE). Writes to a non-open epoch are rejected.
5. Allocation runs against locked evaluations only for statement computation (STATEMENT_FROM_FINAL_ONLY)
6. Draft rows retained for audit/diff visibility

### Hashing Invariants

All evaluation hashing follows these non-negotiable rules:

- **`canonicalJsonStringify(value)`** — deterministic JSON: sorted keys at every depth, no whitespace, BigInt as string. Defined once in `packages/attribution-ledger/src/hashing.ts` (CANONICAL_JSON).
- **`inputs_hash`** — per-enricher composition covering ALL meaningful dependencies. If any input changes, the hash changes. Canonically serialized before SHA-256 (INPUTS_HASH_COMPLETE).
- **`payload_hash`** — `sha256OfCanonicalJson(payload)`. Stored in DB regardless of inline vs. object storage (PAYLOAD_HASH_COVERS_CONTENT).
- **`artifacts_hash`** — on `epochs` table. SHA-256 of sorted `(evaluation_ref, algo_ref, inputs_hash, payload_hash)` tuples from locked evaluations only. Computed by `computeArtifactsHash()`. Set atomically at `closeIngestionWithEvaluations` (EVALUATION_FINAL_ATOMIC).

### Activity Ingestion

Source adapters collect contribution activity from external systems and normalize it into `ingestion_receipts`. Each adapter:

1. **Connects** to one external system via official OSS client (`@octokit/graphql`, `discord.js`)
2. **Fetches** events since last cursor (or within the epoch time window)
3. **Normalizes** to `IngestionReceipt` with deterministic ID, provenance fields, and platform identity
4. **Inserts** idempotently (PK conflict = skip)

Identity resolution happens after ingestion: lookup `user_bindings` (from [decentralized-identity spec](./decentralized-user-identity.md)) to map `(source, platform_user_id)` → `user_id`. If no binding exists yet, the receipt still flows into claimant-share evaluation as an unresolved identity claimant keyed by stable external identity (`provider + externalId`).

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

Proposed allocation per user = SUM of weights for their attributed events. The weight config is pinned per epoch (stored in the epoch row) for reproducibility. V0 derives weights from `activitySources` keys via `deriveWeightConfigV0()` — a pure, deterministic mapping (e.g., `github` → `github:pr_merged: 1000, github:review_submitted: 500, github:issue_closed: 300`). If an epoch already exists, its pinned config takes precedence over input-derived weights (WEIGHT_PINNING).

### Epoch Lifecycle

Epoch status models **governance finality**, not payment execution. Distribution state lives on `epoch_statements`.

```
1. OPEN          Temporal cron (weekly) or admin triggers collection
                 → Creates epoch with status='open', period_start/period_end + weight_config
                 → Runs source adapters → ingestion_receipts (raw facts)
                 → Resolves identities → updates user_id on selection rows
                 → Runs enrichers → epoch_evaluations (draft, overwritten each pass)
                 → `cogni.claimant_shares.v0` emits claimant-share subjects from selected receipts
                 → Computes proposed allocations → epoch_allocations (resolved-user override surface)
                 → Admin selects: adjust inclusion, resolve identities, record pool components

2. REVIEW        closeIngestionWithEvaluations locks config + evaluations (CONFIG_LOCKED_AT_REVIEW, EVALUATION_FINAL_ATOMIC)
                 → Enrichers run one final time → locked evaluations
                 → Sets allocation_algo_ref, weight_config_hash, evaluations_hash on epoch (immutable after)
                 → No new ingestion_receipts (INGESTION_CLOSED_ON_REVIEW)
                 → No new pool components (POOL_LOCKED_AT_REVIEW)
                 → Selection still mutable: adjust inclusion, weight overrides, identity resolution
                 → Admin reviews + tweaks proposed allocations (not blindly trusting the algo)
                 → Allocations recomputed on demand from selected receipts + locked evaluations + locked weight_config
                 → Read models resolve current display names and linked/unlinked state at read time

3. FINALIZED     Admin triggers finalize (requires signature + base_issuance)
                 → Reads epoch_allocations (final_units, falling back to proposed_units for resolved users)
                 → Reads locked claimant shares, applies resolved-user overrides, preserves unresolved identity claimants
                 → Reads pool components → pool_total_credits
                 → computeClaimantCreditLineItems(claimant_allocations, pool_total) → epoch_statement
                 → Stores statement + signature atomically → epoch immutable forever
```

**Transitions:**

- `open → review`: Auto via Temporal at `period_end + grace_period` (configurable, default 24h), **or** admin triggers early via API route. Same state, different trigger.
- `review → finalized`: Admin action. Requires 1-of-N EIP-191 signature from scope's `approvers[]` + at least one `base_issuance` pool component.
- No backward transitions. Corrections use `supersedes_statement_id` on a new epoch statement.

### Statement Computation

Finalization is claimant-aware. Given locked claimant-share subjects, resolved-user overrides, and a total pool:

1. Load claimant-share subjects from the locked `cogni.claimant_shares.v0` evaluation (fallback: rebuild deterministically from selected receipts)
2. Apply `final_units` overrides from `epoch_allocations` to resolved `user` claimants only; unresolved identity claimants remain unchanged
3. Compute each claimant's share: `claimant_units / total_units`
4. Distribute `pool_total_credits` proportionally using BIGINT arithmetic
5. Apply largest-remainder rounding to ensure exact sum equals pool total
6. Output statement items shaped like `[{ user_id, total_units, share, amount_credits, claimant_key, claimant, receipt_ids }]`

The allocation set hash (SHA-256 of canonical claimant allocation data, sorted by claimant key) pins the exact finalized input set. Combined with `pool_total_credits`, locked evaluations, and `weight_config`, the statement is fully deterministic and reproducible.

### Pool Model

Unchanged. Each epoch's credit budget is the sum of independently computed pool components:

- **`base_issuance`** — constant amount per epoch (bootstraps early-stage work)
- **`kpi_bonus_v0`** — computed from DAO-defined KPI snapshots with pinned algorithm
- **`top_up`** — explicit governance allocation with evidence link

Each component stores `algorithm_version`, `inputs_json`, `amount_credits`, and `evidence_ref`.

### Verification

`GET /api/v1/attribution/verify/epoch/:id` performs independent verification from **stored data only** (not re-fetching from GitHub/Discord, which may be private or non-deterministic):

1. Fetch all `ingestion_receipts` for the epoch
2. Recompute proposed allocations from receipts + stored `weight_config`
3. Read `epoch_allocations` (final_units)
4. Recompute statement items from allocations + pool components
5. Compare recomputed values against stored statement
6. Return verification report

## Schema

### `epochs` — one open epoch at a time per (node, scope)

| Column                | Type         | Notes                                                                                    |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `id`                  | BIGSERIAL PK |                                                                                          |
| `node_id`             | UUID         | NOT NULL — per NODE_SCOPED                                                               |
| `scope_id`            | UUID         | NOT NULL — per SCOPE_SCOPED (project). Derived: `uuidv5(node_id, scope_key)`             |
| `status`              | TEXT         | CHECK IN (`'open'`, `'review'`, `'finalized'`)                                           |
| `period_start`        | TIMESTAMPTZ  | Epoch coverage start (NOT NULL)                                                          |
| `period_end`          | TIMESTAMPTZ  | Epoch coverage end (NOT NULL)                                                            |
| `weight_config`       | JSONB        | Milli-unit weights (integer values, NOT NULL, set at creation)                           |
| `weight_config_hash`  | TEXT         | SHA-256 of canonical weight config JSON (NULL while open, set at closeIngestion)         |
| `allocation_algo_ref` | TEXT         | Algorithm version ref (NULL while open, set at closeIngestion — CONFIG_LOCKED_AT_REVIEW) |
| `artifacts_hash`      | TEXT         | SHA-256 of locked evaluations (NULL while open, set at closeIngestionWithEvaluations)    |
| `pool_total_credits`  | BIGINT       | Sum of pool components (set at finalize, NULL while open/review)                         |
| `opened_at`           | TIMESTAMPTZ  |                                                                                          |
| `closed_at`           | TIMESTAMPTZ  | NULL while open/review                                                                   |
| `created_at`          | TIMESTAMPTZ  |                                                                                          |

Constraints:

- Partial unique index `UNIQUE (node_id, scope_id) WHERE status = 'open'` enforces ONE_OPEN_EPOCH per (node, scope)
- `UNIQUE(node_id, scope_id, period_start, period_end)` enforces EPOCH_WINDOW_UNIQUE

### `ingestion_receipts` — append-only contribution records (Layer 1)

| Column             | Type        | Notes                                                             |
| ------------------ | ----------- | ----------------------------------------------------------------- |
| `node_id`          | UUID        | NOT NULL — part of composite PK (NODE_SCOPED)                     |
| `receipt_id`       | TEXT        | Deterministic from source (e.g., `github:pr:org/repo:42`)         |
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

Composite PK: `(node_id, receipt_id)`. No `scope_id` — receipts are scope-agnostic global facts (RECEIPT_SCOPE_AGNOSTIC). Scope assigned at selection layer via epoch membership. No `epoch_id` — epoch membership assigned at selection layer. No `user_id` — identity resolution lands in `epoch_selection.user_id` (truly immutable raw log).

DB trigger rejects UPDATE/DELETE (RECEIPT_APPEND_ONLY).

Indexes: `(node_id, event_time)`, `(source, event_type)`, `(platform_user_id)`

### `epoch_selection` — identity resolution + admin decisions (Layer 2)

| Column                  | Type             | Notes                                            |
| ----------------------- | ---------------- | ------------------------------------------------ |
| `id`                    | UUID PK          |                                                  |
| `node_id`               | UUID             | NOT NULL (NODE_SCOPED)                           |
| `epoch_id`              | BIGINT FK→epochs | Assigns epoch membership to a receipt            |
| `receipt_id`            | TEXT             | FK→ingestion_receipts.id                         |
| `user_id`               | TEXT FK→users    | Resolved cogni user (NULL = unresolved)          |
| `included`              | BOOLEAN          | NOT NULL DEFAULT true — admin can exclude spam   |
| `weight_override_milli` | BIGINT           | Override weight_config for this event (nullable) |
| `note`                  | TEXT             | Admin rationale                                  |
| `created_at`            | TIMESTAMPTZ      |                                                  |
| `updated_at`            | TIMESTAMPTZ      |                                                  |

Constraint: `UNIQUE(epoch_id, receipt_id)`

DB trigger rejects INSERT/UPDATE/DELETE when `epochs.status = 'finalized'` (SELECTION_FREEZE_ON_FINALIZE). Mutable during `open` and `review`, immutable after finalize. Reviewers can adjust inclusion, weight overrides, and identity resolution during review — these are auditable human decisions, not silent edits.

**Auto-population rules (SELECTION_AUTO_POPULATE):**

After each collection run, the `materializeSelection` activity creates selection rows for newly ingested receipts:

1. **Delta processing**: Only receipts without an existing selection row (or with `user_id IS NULL`) are processed. Receipts already selected with a resolved `user_id` are never overwritten. This preserves admin edits to `included`, `weight_override_milli`, and `note`.
2. **Insert-or-update-userId-only**: New receipts get `INSERT` with resolved `user_id` (or NULL if unresolved), `included = true`. Existing rows with `user_id IS NULL` get only `user_id` updated (fills in newly-added bindings on re-run). Fields `included`, `weight_override_milli`, `note` are never touched by auto-population.
3. **Query by epochId**: The activity queries receipts by epoch membership (via the epoch's `period_start`/`period_end`), using `epochId` as the authoritative scope. The epoch row is loaded first; period dates serve as a guard assertion.
4. **Provider-scoped resolution**: Identity resolution queries `user_bindings` filtered by `provider` (e.g., `'github'`). No cross-provider resolution. The `platformUserId` stored in `ingestion_receipts` must match the `external_id` format in `user_bindings` (GitHub: numeric `databaseId` as string).

### `epoch_allocations` — per-user override surface

| Column            | Type             | Notes                                              |
| ----------------- | ---------------- | -------------------------------------------------- |
| `id`              | UUID PK          |                                                    |
| `node_id`         | UUID             | NOT NULL (NODE_SCOPED)                             |
| `epoch_id`        | BIGINT FK→epochs |                                                    |
| `user_id`         | TEXT FK→users    | NOT NULL — resolved human override subject         |
| `proposed_units`  | BIGINT NOT NULL  | Computed from weight policy                        |
| `final_units`     | BIGINT           | Admin-set (NULL = not yet finalized, use proposed) |
| `override_reason` | TEXT             | Why admin changed it                               |
| `activity_count`  | INT NOT NULL     | Number of events attributed to this user           |
| `created_at`      | TIMESTAMPTZ      |                                                    |
| `updated_at`      | TIMESTAMPTZ      |                                                    |

Constraint: `UNIQUE(epoch_id, user_id)`

Note: finalized statement math is claimant-aware. `epoch_allocations` remains the admin override surface for resolved human users (`final_units`, `override_reason`, `activity_count`). Unresolved identity claimants are preserved in claimant-share evaluations and finalized statement items even when they have no `epoch_allocations` row.

### `ingestion_cursors` — adapter sync state

| Column         | Type        | Notes                                      |
| -------------- | ----------- | ------------------------------------------ |
| `node_id`      | UUID        | NOT NULL (NODE_SCOPED)                     |
| `scope_id`     | UUID        | NOT NULL — per SCOPE_SCOPED (project)      |
| `source`       | TEXT        | `github`, `discord`                        |
| `stream`       | TEXT        | `pull_requests`, `reviews`, `messages`     |
| `source_ref`   | TEXT        | `cogni-dao/cogni-template`, `guild:123456` |
| `cursor_value` | TEXT        | Timestamp or opaque pagination token       |
| `retrieved_at` | TIMESTAMPTZ | When this cursor was last used             |

Primary key: `(node_id, scope_id, source, stream, source_ref)`

Note: `source_ref` is the external system's namespace (GitHub repo slug, Discord guild ID). `scope_id` is the internal project governance domain. One `scope_id` may map to multiple `source_ref` values (a project that spans multiple repos).

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

### `epoch_statements` — one per closed epoch, deterministic distribution plan (Layer 3)

| Column                    | Type                     | Notes                                                                                     |
| ------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `id`                      | UUID PK                  |                                                                                           |
| `node_id`                 | UUID                     | NOT NULL (NODE_SCOPED)                                                                    |
| `epoch_id`                | BIGINT FK→epochs         | UNIQUE(node_id, epoch_id) — one statement per epoch                                       |
| `allocation_set_hash`     | TEXT                     | SHA-256 of canonical finalized allocations                                                |
| `pool_total_credits`      | BIGINT                   | Must match epoch's pool_total_credits                                                     |
| `statement_items_json`    | JSONB                    | `[{user_id, total_units, share, amount_credits, claimant_key?, claimant?, receipt_ids?}]` |
| `supersedes_statement_id` | UUID FK→epoch_statements | For post-signing corrections (nullable)                                                   |
| `created_at`              | TIMESTAMPTZ              |                                                                                           |

Post-signing corrections use amendment statements (`supersedes_statement_id`), never reopen-and-edit.

### `epoch_statement_signatures` — client-side EIP-191 signatures (schema only)

| Column          | Type                     | Notes                        |
| --------------- | ------------------------ | ---------------------------- |
| `id`            | UUID PK                  |                              |
| `node_id`       | UUID                     | NOT NULL (NODE_SCOPED)       |
| `statement_id`  | UUID FK→epoch_statements |                              |
| `signer_wallet` | TEXT                     | NOT NULL                     |
| `signature`     | TEXT                     | NOT NULL — EIP-191 signature |
| `signed_at`     | TIMESTAMPTZ              | NOT NULL                     |

Constraint: `UNIQUE(statement_id, signer_wallet)`

Signer wallet is the `ecrecover`-derived address, not client-supplied. Signature message must include `node_id + scope_id + allocation_set_hash` (SIGNATURE_SCOPE_BOUND). See [Signing Workflow](#signing-workflow).

### `epoch_evaluations` — enrichment outputs (draft/locked lifecycle)

| Column           | Type             | Notes                                                                                          |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `id`             | UUID PK          |                                                                                                |
| `node_id`        | UUID             | NOT NULL (NODE_SCOPED)                                                                         |
| `epoch_id`       | BIGINT FK→epochs | NOT NULL                                                                                       |
| `evaluation_ref` | TEXT             | NOT NULL — namespaced: `cogni.work_item_links.v0`, `cogni.echo.v0` (EVALUATION_REF_NAMESPACED) |
| `status`         | TEXT             | NOT NULL DEFAULT `'draft'` — CHECK IN (`'draft'`, `'locked'`)                                  |
| `algo_ref`       | TEXT             | NOT NULL — enricher algorithm that produced this (e.g., `work-item-linker-v0`)                 |
| `inputs_hash`    | TEXT             | NOT NULL — SHA-256 of canonical inputs (INPUTS_HASH_COMPLETE)                                  |
| `payload_hash`   | TEXT             | NOT NULL — SHA-256 of canonical payload (PAYLOAD_HASH_COVERS_CONTENT)                          |
| `payload_json`   | JSONB            | Inline evaluation payload (NULL when `payload_ref` used)                                       |
| `payload_ref`    | TEXT             | Object storage key for large evaluations (NULL when inline)                                    |
| `created_at`     | TIMESTAMPTZ      |                                                                                                |

Constraints:

- `UNIQUE(epoch_id, evaluation_ref, status)` — one draft + one locked per ref per epoch (EVALUATION_UNIQUE_PER_REF_STATUS)
- `CHECK (status IN ('draft', 'locked'))` — only two valid states
- `CHECK (payload_json IS NOT NULL OR payload_ref IS NOT NULL)` — at least one payload source
- Index on `epoch_id` for lookups

**Row model:** Drafts are overwritten via UPSERT each collection pass. Locked evaluations are written once inside the `closeIngestionWithEvaluations` transaction (EVALUATION_FINAL_ATOMIC). Both draft and locked rows coexist — draft for audit/diff visibility, locked for statement computation.

**Payload sizing (V0):** All payloads inline (`payload_json`). `payload_ref` support stubbed for future large evaluations (> 256KB).

## Source Adapter Interface

```typescript
// Port definition (src/ports/source-adapter.port.ts)

export interface SourceAdapter {
  readonly source: string; // "github", "discord"
  readonly version: string; // bump on schema changes

  streams(): StreamDefinition[];

  /**
   * Collect ingestion receipts. Idempotent (deterministic IDs).
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

### Write Routes (SIWE + scope approver check → Temporal workflow → 202)

| Method | Route                                            | Purpose                                                                                |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| POST   | `/api/v1/attribution/epochs/collect`             | Trigger activity collection for new/existing epoch                                     |
| PATCH  | `/api/v1/attribution/epochs/:id/allocations`     | Admin adjusts final_units for users (epoch must be `open` or `review`)                 |
| POST   | `/api/v1/attribution/epochs/:id/pool-components` | Record a pool component (epoch must be `open` — POOL_LOCKED_AT_REVIEW)                 |
| POST   | `/api/v1/attribution/epochs/:id/review`          | Close ingestion, transition `open → review` (or auto via Temporal)                     |
| POST   | `/api/v1/attribution/epochs/:id/finalize`        | Sign + finalize epoch → compute statement (requires EIP-191 signature + base_issuance) |

### Public Read Routes (no auth, closed-epoch data only)

| Method | Route                                               | Purpose                                    |
| ------ | --------------------------------------------------- | ------------------------------------------ |
| GET    | `/api/v1/public/attribution/epochs`                 | List closed epochs (paginated)             |
| GET    | `/api/v1/public/attribution/epochs/:id/allocations` | Allocations for a closed epoch             |
| GET    | `/api/v1/public/attribution/epochs/:id/statement`   | Epoch statement (null if none, always 200) |

### Authenticated Read Routes (SIWE session required)

| Method | Route                                     | Purpose                                        |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/attribution/epochs`              | List all epochs including open                 |
| GET    | `/api/v1/attribution/epochs/:id/activity` | Ingestion receipts with PII + selection join   |
| GET    | `/api/v1/attribution/verify/epoch/:id`    | Recompute statement from stored data + compare |

## Temporal Workflows

### CollectEpochWorkflow

The schedule adapter sends a `ScheduleActionPayload` wrapper; the workflow extracts `.input` immediately and treats it as `LedgerIngestRunV1`:

```typescript
interface LedgerIngestRunV1 {
  version: 1;
  scopeId: string;
  scopeKey: string;
  epochLengthDays: number;
  activitySources: Record<
    string,
    {
      creditEstimateAlgo: string;
      sourceRefs: string[]; // external namespaces (e.g., repo slugs)
      streams: string[]; // e.g., ["pull_requests", "reviews", "issues"]
    }
  >;
}
```

1. **Compute epoch window** — `computeEpochWindowV1()` (pure, deterministic) derives `periodStart`/`periodEnd` from `TemporalScheduledStartTime` + `epochLengthDays`. Monday-aligned UTC boundaries, anchored to 2026-01-05.
2. **Derive weight config** — `deriveWeightConfigV0()` maps `activitySources` keys to hardcoded V0 weights (e.g., `github:pr_merged: 1000`).
3. **Ensure epoch** — `ensureEpochForWindow` activity looks up by `(node_id, scope_id, period_start, period_end)` regardless of status via `getEpochByWindow`. If found, returns as-is with pinned `weightConfig`. If not found, creates with input-derived weights. Weight config drift (input differs from existing) logs a warning; existing epoch's config wins (WEIGHT_PINNING).
4. **Skip if not open** — If epoch status is `review` or `finalized`, workflow exits immediately.
5. **Collect per source/sourceRef/stream** — For each `activitySources` entry, for each `sourceRef`, for each `stream`:
   - Activity: load cursor from `ingestion_cursors`
   - Activity: `adapter.collect({ streams: [stream], cursor, window })` → receipts + `producerVersion`
   - Activity: insert `ingestion_receipts` (idempotent by PK, uses `adapter.version` as `producer_version`)
   - Activity: save cursor to `ingestion_cursors` (monotonic advancement)
6. **Select and resolve identities** — `materializeSelection` activity (SELECTION_AUTO_POPULATE):
   - Load epoch by ID → get period_start/period_end (guard assertion)
   - Query receipts in epoch window that are unselected (no selection row) or unresolved (selection.user_id IS NULL)
   - For each source: batch resolve `platformUserId` → `userId` via `user_bindings` (provider-scoped)
   - INSERT new selection rows (included=true, userId=resolved or NULL)
   - UPDATE existing unresolved rows: set userId only (never touch included/weight_override_milli/note)
7. **Enrich (draft)** — `evaluateEpochDraft` activity:
   - Load selected receipts with metadata via `getSelectedReceiptsWithMetadata(epochId)`
   - Run each registered enricher (e.g., echo enricher aggregates receipt counts)
   - Compute `inputsHash` and `payloadHash` per evaluation
   - `upsertDraftEvaluation()` — overwrites previous draft (EVALUATION_UNIQUE_PER_REF_STATUS)
8. **Compute allocations** — `computeAllocations` activity (unchanged, runs against selected receipts)
9. **Ensure pool components** — `ensurePoolComponents` activity
10. **Auto-close (at period end + grace):**
    - `buildLockedEvaluations({ epochId })` — same computation as draft, returns evaluations + `artifactsHash` without writing
    - `closeIngestionWithEvaluations({ epochId, evaluations, artifactsHash, ... })` — single transaction: insert locked evaluations + set `artifacts_hash` + pin config hashes + transition `open→review` (EVALUATION_FINAL_ATOMIC)

Deterministic workflow ID: managed by Temporal Schedule (overlap=SKIP, run IDs per firing).

**Epoch window algorithm** (`computeEpochWindowV1`):

- Floor `asOf` timestamp to Monday 00:00 UTC
- Anchor: 2026-01-05 (first Monday of 2026)
- Period index = `floor((mondayMs - anchor) / epochMs)`
- `periodStart = anchor + periodIndex * epochMs`
- `periodEnd = periodStart + epochMs`

### FinalizeEpochWorkflow

Input: `{ epochId, signature }` — `signerAddress` derived from SIWE session (never client-supplied).

1. Verify epoch exists and is `review`
2. If epoch already `finalized`, return existing statement (EPOCH_FINALIZE_IDEMPOTENT)
3. Verify `allocation_algo_ref` and `weight_config_hash` are set (CONFIG_LOCKED_AT_REVIEW)
4. Verify at least one `base_issuance` pool component exists (POOL_REQUIRES_BASE)
5. Verify signer is in scope's `approvers[]` AND matches pinned `approverSetHash` (APPROVERS_PER_SCOPE)
6. Build canonical finalize message from epoch data, `ecrecover(message, signature)` — verify recovered address matches `signerAddress`
7. Read `epoch_allocations` — use `final_units` where set as resolved-user overrides
8. Read locked claimant-share evaluation (fallback: rebuild from selected receipts)
9. Read pool components, compute `pool_total_credits = SUM(amount_credits)`
10. `computeClaimantCreditLineItems(claimant_allocations, pool_total)` — BIGINT, largest-remainder
11. Compute claimant-aware `allocation_set_hash`
12. Atomic transaction: set `pool_total_credits` on epoch, update status to `'finalized'`, insert epoch statement + statement signature
13. Return statement

Deterministic workflow ID: `ledger-finalize-{scopeId}-{epochId}`

## Signing Workflow

### Canonical Message Format

The signed message binds to node, scope, and allocation data (SIGNATURE_SCOPE_BOUND):

```
Cogni Attribution Statement v1
Node: {node_id}
Scope: {scope_id}
Epoch: {epoch_id}
Allocation Hash: {allocation_set_hash}
Pool Total: {pool_total_credits}
```

Frontend constructs this message from epoch data, calls `walletClient.signMessage()` (EIP-191 `personal_sign`), and POSTs the signature to the finalize route. V0: single API call signs and finalizes atomically.

### Verification

Backend recovers the signer address via `ecrecover(message, signature)` and checks:

1. Recovered address is in the scope's `approvers[]` (from repo-spec or project manifest)
2. Message fields match the epoch's actual data (prevents signing stale/wrong data)

### Storage

Signatures stored in `statement_signatures` table (schema unchanged). The `signer_wallet` is the recovered address, not client-supplied.

### Future Path

```
V0 (now):    Single EIP-191 sig passed at finalize time, 1-of-N from scope approvers
V1:          Separate /sign route for collecting signatures over time, multi-sig thresholds (close_epoch_threshold: 2)
V1:          Role separation (selection_admins vs statement_approvers)
V1:          Post sig hash to IPFS/Arweave → content hash on-chain
V2:          On-chain attestation registry (smart contract accepts epoch_hash + sig)
V3:          DAO multisig (Safe) — N-of-M signers required
```

## V1+ Deferred Features

The following are explicitly deferred from V0 and will be designed when needed:

- **Separate `/sign` route** (`POST /epochs/:id/sign`) — V1: collect signatures independently before finalize, needed for multi-approver quorum
- **Multi-sig thresholds** (`close_epoch_threshold: N`) — V1: require N-of-M approver signatures
- **Role separation** (`selection_admins` vs `statement_approvers`) — V1: separate who selects from who signs
- **`ledger_issuers` role system** (can_issue, can_approve, can_close_epoch) — V1: multi-role authorization
- **Per-receipt wallet signing** (EIP-191, SIGNATURE_DOMAIN_BOUND) — V1: receipts as signed attestations
- **Receipt approval lifecycle** (proposed → approved → revoked, LATEST_EVENT_WINS) — V1: per-receipt workflows
- **On-chain attestation** — V0 verifies by recomputing from stored data; V1+ adds on-chain signature registry
- **Merkle trees / inclusion proofs** — V1+
- **Settlement distribution state machine** (`epoch_statements.status`: draft → signed → submitted → settled/failed) — V1+
- **UI pages** — V1+
- **DID/VC alignment** — V2+
- **Automated webhook fast-path** (GitHub `handleWebhook`) — V1: real-time ingestion
- **Formal `EpochEnricher` port** — V1: registration, dependency ordering between enrichers, lifecycle hooks. V0 calls enricher activities directly from the workflow.
- **Object storage for large evaluations** (`payload_ref`) — V1: when an evaluation exceeds 256KB inline threshold. V0: all payloads inline.
- **AI quality scoring enricher** (`cogni.ai_scores.v0`) — future enricher, same `epoch_evaluations` table, different `evaluation_ref`

### File Pointers

| File                                                                | Purpose                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/db-schema/src/attribution.ts`                             | Drizzle schema: all attribution tables including `epochEvaluations`       |
| `packages/attribution-ledger/src/store.ts`                          | Store port interface with evaluation CRUD methods                         |
| `packages/attribution-ledger/src/hashing.ts`                        | `canonicalJsonStringify`, `computeArtifactsHash`, `sha256OfCanonicalJson` |
| `packages/attribution-ledger/src/enrichers/work-item-linker.ts`     | `extractWorkItemIds()` pure function + types                              |
| `packages/attribution-ledger/src/allocation.ts`                     | Allocation algorithms (`weight-sum-v0`)                                   |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`    | Drizzle adapter — all store port implementations                          |
| `services/scheduler-worker/src/activities/ledger.ts`                | Temporal activities (attribution I/O)                                     |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | `CollectEpochWorkflow` — pipeline orchestration                           |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`        | GitHub source adapter (GraphQL, body/branch/labels)                       |

## Goal

Enable transparent, verifiable credit distribution where contribution activity is automatically collected, enriched with domain-specific context (work-item links, quality signals), valued via pluggable allocation algorithms, and finalized by an admin. Anyone can recompute the statement from stored data.

### Actor Migration Path (Planned)

Finalized statements now preserve claimant identity explicitly (`claimant_key`, `claimant`) and treat `epoch_allocations.user_id` as the resolved-human override surface, not the only economic subject. `actor_id` is still the migration target: when the `actors` table ships ([proj.operator-plane](../../work/projects/proj.operator-plane.md) v1), claimant keys can resolve to actor-backed subjects without changing the deterministic statement model. For human actors (`kind=user`), `actor_id` bridges 1:1 to `user_id` via the actors table. For agent actors, `actor_id` enables new attribution paths (gateway usage → agent → rewards). Every economic event remains scoped by `(node_id, scope_id)` — `actor_id` is locally unique per node, not a global identity. No invariant changes — PAYOUT_DETERMINISTIC and ALL_MATH_BIGINT apply regardless of subject key. See [identity-model.md](./identity-model.md).

## Non-Goals

- Algorithmic valuation (SourceCred-style scoring) — weights are transparent, admin adjustable
- Server-held signing keys
- Full RBAC system (V0 uses per-scope approver allowlist)
- Real-time streaming (poll-based collection sufficient for weekly epochs)
- Formal enricher registration/plugin framework (V0 calls enricher activities directly)
- Payload shape standardization across enrichers (pipeline validates envelope only; payload is per-plugin, opaque)

## Related

- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [billing-evolution](./billing-evolution.md) — Existing credit/billing system
- [billing-ingest](./billing-ingest.md) — Callback-driven billing pipeline
- [architecture](./architecture.md) — System architecture
- [sourcecred](./sourcecred.md) — SourceCred as-built (being superseded)
- [decentralized-user-identity](./decentralized-user-identity.md) — User identity bindings (`user_id` is canonical)
- [identity-model](./identity-model.md) — All identity primitives (`node_id`, `scope_id`, `user_id`, `actor_id`, `billing_account_id`, `dao_address`)
- [ai-governance-data](./ai-governance-data.md) — Autonomous governance agents (separate concern)
