---
id: task.0113
type: task
title: "Epoch artifact pipeline + work-item enricher"
status: needs_triage
priority: 1
rank:
estimate: 3
summary: "Generic epoch_artifacts table for enrichment outputs, canonical JSON hashing, work-item-linker as first enricher (extracts task IDs from PR metadata, snapshots .md frontmatter, computes budgets). Draft/final lifecycle: draft artifacts power UI projections on each collection pass; final artifacts locked at closeIngestion for payout determinism."
outcome: "Enrichers can emit typed artifacts into a single generic table. Work-item links + budgets are computed continuously (draft) and pinned at closeIngestion (final). Allocation algorithms can consume artifacts without coupling to enricher internals. GitHub adapter captures PR body, branch, and labels as receipt metadata."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-27
updated: 2026-02-27
labels: [governance, ledger, enrichment, scoring]
external_refs:
---

# Epoch Artifact Pipeline + Work-Item Enricher

## Problem

The current allocation algorithm (`weight-sum-v0`) assigns flat weights per event type and sums per user. This rewards surface area (PR count, review count) rather than work outcomes. There is no mechanism to tie GitHub activity to planned work items, and no generic way for future enrichment plugins (AI scoring, Discord karma) to inject domain-specific interpretation into the scoring pipeline.

## Design

### Plugin Architecture — Three Surfaces

```
1. SOURCE ADAPTERS (exists)      SourceAdapter → ActivityEvent[]
   "What happened?"              Standardized receipt: id, source, eventType, metadata

2. EPOCH ENRICHERS (NEW)         Enricher → EpochArtifact
   "What does it mean?"          work-item-linker, ai-scorer, discord-karma...
   Runs continuously (draft)     Reads curated events + external context
   + at closeIngestion (final).  Outputs pinned in epoch_artifacts table

3. ALLOCATION ALGORITHMS (exists) algoRef dispatch → ProposedAllocation[]
   "Who gets what?"               Pure function. Consumes events + artifacts.
```

### 1a. Extend GitHub Adapter Receipt Data

**File**: `services/scheduler-worker/src/adapters/ingestion/github.ts`

Add `body`, `headRefName`, `labels(first:20) { nodes { name } }` to `MERGED_PRS_QUERY` GraphQL. Store in event `metadata` as `body`, `branch`, `labels: string[]`. These are receipt facts — the adapter stays purpose-neutral.

### 1b. `epoch_artifacts` Table

**File**: `packages/db-schema/src/ledger.ts`

```sql
epoch_artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID NOT NULL,
  epoch_id        BIGINT NOT NULL REFERENCES epochs(id),
  artifact_type   TEXT NOT NULL,          -- namespaced: "cogni.work_item_links.v0"
  status          TEXT NOT NULL DEFAULT 'draft',  -- "draft" | "final"
  algo_ref        TEXT NOT NULL,
  inputs_hash     TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  payload_json    JSONB,
  payload_ref     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(epoch_id, artifact_type, status),  -- one draft + one final per type per epoch
  CHECK (payload_json IS NOT NULL OR payload_ref IS NOT NULL),
  CHECK (status IN ('draft', 'final'))
)
```

Add `artifacts_hash TEXT` column to `epochs` — NULL while open, set at closeIngestion from `status='final'` artifacts only.

**Row model**: One row per (epoch, artifact_type, status). Drafts are overwritten via UPSERT on each collection pass. Final artifacts are written once at closeIngestion. Both rows can coexist — drafts provide history/diff visibility, finals are the binding record.

**Final immutability** (ARTIFACT_FINAL_ATOMIC): Writing final artifacts + computing `epochs.artifacts_hash` + transitioning epoch to `review` status MUST happen in a single DB transaction. After the epoch leaves `open` status, any INSERT with `status='final'` for that epoch MUST be rejected (enforced in the store method, not just application logic).

### Hashing Invariants

- **CANONICAL_JSON**: `canonicalJsonStringify()` — sorted keys at every depth, no whitespace, BigInt as string. Define once in `packages/ledger-core/src/hashing.ts`.
- **INPUTS_HASH_COMPLETE**: Must cover `epoch_id`, sorted `(event_id, event_payload_hash)` list (where `event_payload_hash` is the event's `payloadHash` from ingestion — its content hash), sorted `(work_item_id, frontmatter_hash)` list, `priorityMultipliers`, and any other external data consumed. Canonically serialized via `canonicalJsonStringify()` before hashing. **Note**: `repoCommitSha` is in the payload for audit but NOT in `inputs_hash` — `frontmatterHash` already detects real `.md` content changes.
- **PAYLOAD_HASH_COVERS_CONTENT**: `payload_hash` = SHA-256 of canonical JSON. Used in `artifacts_hash` computation (never re-serialized).
- **ENRICHER_SNAPSHOT_RULE**: Anything learned from outside the ledger MUST be snapshotted into the artifact payload or referenced by content-hash.
- **PAYLOAD_SIZING**: V0 inline only (`payload_json`). `payload_ref` column exists for future object storage support when artifacts exceed 256KB.

`artifacts_hash` = SHA-256 of sorted `(artifact_type, algo_ref, inputs_hash, payload_hash)` tuples from `status='final'` artifacts.

### 1c. Work-Item Enricher

**New file**: `packages/ledger-core/src/enrichers/work-item-linker.ts` — pure functions only

```typescript
extractWorkItemIds(metadata: { title?, body?, branch?, labels? })
  → Array<{ workItemId: string; linkSource: "title" | "body" | "branch" | "label" }>
  // Pattern: /(task|bug|spike|story)\.\d{4}/g

computeWorkItemBudgetMilli(estimate: number, priority: number, multipliers: Record<number, number>)
  → bigint
  // budget = BigInt(estimate) * BigInt(multipliers[priority] ?? 0)
```

**Artifact payload** (`cogni.work_item_links.v0`):

```json
{
  "repoCommitSha": "a1b2c3d4...",
  "priorityMultipliers": { "0": 0, "1": 1000, "2": 2000, "3": 4000 },
  "workItems": {
    "task.0102": {
      "estimate": 3,
      "priority": 1,
      "status": "done",
      "title": "Allocation computation",
      "frontmatterHash": "sha256:abc...",
      "budgetMilli": "3000"
    }
  },
  "eventLinks": {
    "github:pr:org/repo:42": [
      { "workItemId": "task.0102", "linkSource": "title" }
    ]
  },
  "unlinkedEventIds": ["github:pr:org/repo:55"]
}
```

`repoCommitSha` pins git state for `.md` reads. `frontmatterHash` per work item ensures content integrity. Together they make the snapshot fully reproducible.

### 1d. Enrichment Activity

**File**: `services/scheduler-worker/src/activities/ledger.ts`

New activity `enrichEpoch(epochId, status)`:

1. Load curated events via `getCuratedEventsWithMetadata(epochId)` — new port method returning `CuratedEventWithMetadata[]` (`CuratedEventForAllocation & { metadata, payloadHash }`)
2. `extractWorkItemIds()` from each event's metadata
3. Resolve `repoCommitSha` — exact git commit via `git rev-parse HEAD` on the worker's repo/worktree. Stored in payload for audit only, NOT in `inputs_hash`.
4. Read referenced `.md` files, parse YAML frontmatter, compute `frontmatterHash`. **Failure mode**: missing/unparseable `.md` → include work item with `estimate: 0, budgetMilli: "0", error: "file_not_found"|"parse_error"`. Never throw — zero-budget items are handled naturally by allocation.
5. `computeWorkItemBudgetMilli()` for each work item
6. Build payload, compute `payloadHash` and `inputsHash` (inputs_hash covers: epochId, sorted event hashes, sorted frontmatter hashes, priorityMultipliers)
7. UPSERT artifact (`epoch_id + artifact_type + status`)

### 1e. Workflow Integration — Draft/Final Lifecycle

**During epoch (each collection pass):**

```
collectEvents(epochId)                       ← existing
enrichEpoch(epochId, status='draft')         ← NEW: emit/update draft artifacts
computeAllocations(epochId, draftArtifacts)  ← provisional: powers UI projections
```

**At closeIngestion (once):**

```
enrichEpoch(epochId, status='final')         ← final run: promote to final
computeAllocations(epochId, finalArtifacts)  ← binding: drives payouts
closeIngestion(epochId, ..., artifactsHash)  ← locks everything
```

**PAYOUT_FROM_FINAL_ONLY**: Allocation for payout purposes MUST consume only `status='final'` artifacts. Drafts are explicitly excluded from binding computation.

### Store Port Changes

**File**: `packages/ledger-core/src/store.ts`

New type:

```typescript
/** Curated event with raw event metadata, for enricher consumption. */
export interface CuratedEventWithMetadata extends CuratedEventForAllocation {
  metadata: Record<string, unknown> | null;
  payloadHash: string; // event's content hash from ingestion
}
```

New/updated methods:

- `getCuratedEventsWithMetadata(epochId)` — same JOIN as `getCuratedEventsForAllocation` + selects `metadata` and `payload_hash`
- `upsertDraftArtifact(params)` — UPSERT by (epoch_id, artifact_type, status='draft'). Freely callable while epoch is open.
- `getArtifactsForEpoch(epochId, status?)` — filter by status
- `getArtifact(epochId, artifactType, status?)` — single artifact lookup
- `closeIngestionWithArtifacts(params)` — **single transaction**: insert final artifacts + compute & set `epochs.artifacts_hash` + transition epoch open→review. Rejects if epoch is not open. This replaces calling `closeIngestion()` separately.
- Final artifact writes outside this transaction are rejected (ARTIFACT_FINAL_ATOMIC).

## Scope

- [ ] Extend `MERGED_PRS_QUERY` with body, headRefName, labels
- [ ] Extend `PrNode` interface and `normalizePr()` metadata
- [ ] Add `epoch_artifacts` table to DB schema (UNIQUE on epoch_id, artifact_type, status)
- [ ] Add `artifacts_hash` column to `epochs` table
- [ ] Implement `canonicalJsonStringify()` in hashing module
- [ ] Implement `computeArtifactsHash()`
- [ ] Implement `extractWorkItemIds()` pure function
- [ ] Implement `computeWorkItemBudgetMilli()` pure function
- [ ] Add artifact store methods to port + Drizzle adapter (`upsertDraftArtifact`, `closeIngestionWithArtifacts`)
- [ ] `closeIngestionWithArtifacts` — single transaction: insert finals + set artifacts_hash + epoch open→review
- [ ] Reject final artifact writes outside the closeIngestion transaction (ARTIFACT_FINAL_ATOMIC)
- [ ] Implement `enrichEpoch` activity (with explicit `repoCommitSha` from `git rev-parse HEAD`)
- [ ] Wire enrichment into `CollectEpochWorkflow` (draft on each pass, final at close)
- [ ] Namespace artifact types: `cogni.work_item_links.v0` convention
- [ ] Unit tests: ID extraction patterns, budget computation, canonical JSON, artifact hashing
- [ ] Component tests: artifact CRUD, unique constraints, draft/final lifecycle, final immutability
- [ ] Stack test: collect → enrich → close → verify artifacts pinned

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test
pnpm test:component
```

- [ ] GitHub adapter captures body, branch, labels in event metadata
- [ ] Draft artifacts created/updated on each collection pass
- [ ] Final artifacts written + `artifacts_hash` set + epoch transitioned in one transaction
- [ ] Attempting to write a final artifact to a non-open epoch throws
- [ ] Draft and final rows coexist for same (epoch_id, artifact_type)
- [ ] Artifact with same `inputs_hash` is idempotent (no duplicate writes)
- [ ] `canonicalJsonStringify` produces identical output for identical objects regardless of key insertion order
- [ ] `inputs_hash` covers epoch_id + sorted (event_id, eventPayloadHash) + sorted (workItemId, frontmatterHash) + priorityMultipliers (NOT repoCommitSha)
- [ ] `repoCommitSha` is in payload (audit) but not in `inputs_hash`
- [ ] Missing `.md` files produce zero-budget work items with error field, never throw
- [ ] `getCuratedEventsWithMetadata` returns metadata + payloadHash alongside curation fields
