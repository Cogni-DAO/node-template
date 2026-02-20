---
id: epoch-ledger-spec
type: spec
title: "Epoch Ledger: Auditable Decision Ledger for Credit Payouts"
status: draft
spec_state: draft
trust: draft
summary: "Epoch-based ledger where wallet-signed receipts record human valuation decisions, append-only events track approval lifecycle, pool components define the credit budget, and deterministic payout recomputation is verifiable by anyone."
read_when: Working on credit payouts, work receipts, epoch lifecycle, valuation policy, or the ledger API.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-02-20
verified:
tags: [governance, transparency, payments, ledger]
---

# Epoch Ledger: Auditable Decision Ledger for Credit Payouts

> The system is a **cryptographically auditable decision ledger for human judgment**. It records who approved what, under which valuation policy, at what time, with what authority, leading to what payout. Valuation is subjective and human — the system makes that subjectivity transparent, auditable, and governable. It does NOT compute value algorithmically.

## Key References

|              |                                                                                           |                                |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **Project**  | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Project roadmap                |
| **Spike**    | [spike.0082](../../work/items/spike.0082.transparency-log-design.md)                      | Original design research       |
| **Research** | [transparency-log-receipt-design](../research/transparency-log-receipt-design.md)         | Full design exploration        |
| **Spec**     | [billing-evolution](./billing-evolution.md)                                               | Existing billing/credit system |
| **Spec**     | [architecture](./architecture.md)                                                         | System architecture            |

## Core Invariants

| Rule                   | Constraint                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RECEIPTS_IMMUTABLE     | DB trigger rejects UPDATE/DELETE on `work_receipts`. Receipts have no status column — they are immutable facts.                                                                                 |
| EVENTS_APPEND_ONLY     | DB trigger rejects UPDATE/DELETE on `receipt_events`. State transitions are append-only.                                                                                                        |
| RECEIPTS_WALLET_SIGNED | Every receipt has a valid EIP-191 signature from the issuer's wallet. The server verifies signatures but never holds private keys.                                                              |
| ISSUER_ALLOWLISTED     | Only wallet addresses in `ledger_issuers` can create receipts, open epochs, and close epochs. Checked via SIWE session.                                                                         |
| EPOCH_POLICY_PINNED    | Policy reference (`repo` + `commit_sha` + `path` + `content_hash`) is set at epoch open and never modified.                                                                                     |
| PAYOUT_DETERMINISTIC   | Given approved receipts + pool components + policy → the payout statement is byte-for-byte reproducible.                                                                                        |
| EPOCH_CLOSE_IDEMPOTENT | Closing a closed epoch returns the existing statement. No error, no mutation.                                                                                                                   |
| IDEMPOTENT_RECEIPTS    | UNIQUE(idempotency_key) prevents duplicate receipts. Retries return the existing receipt.                                                                                                       |
| ONE_OPEN_EPOCH         | Partial unique index enforces at most one epoch with `status = 'open'`.                                                                                                                         |
| VALUATION_IS_HUMAN     | The system never computes `valuation_units` algorithmically. They are human inputs from the approver.                                                                                           |
| ALL_MATH_BIGINT        | No floating point in unit or credit calculations. All math uses BIGINT with largest-remainder rounding.                                                                                         |
| APPROVED_RECEIPTS_ONLY | Epoch close considers only receipts whose latest `receipt_event` is `'approved'`.                                                                                                               |
| POOL_REPRODUCIBLE      | `pool_total_credits = SUM(epoch_pool_components.amount_credits)`. Each component stores algorithm version + inputs + amount.                                                                    |
| WRITES_VIA_TEMPORAL    | All write operations (open epoch, issue receipt, record event, close epoch) execute in Temporal workflows via the existing `scheduler-worker` service. Next.js routes return 202 + workflow ID. |

## Design

### System Architecture

**Next.js** handles authentication (SIWE), authorization (issuer allowlist check), read queries (direct DB), and write request enqueuing (start Temporal workflow, return 202).

**Temporal worker** (`services/scheduler-worker/`) handles all write/compute domain actions: signature verification, receipt insertion, epoch close computation, payout generation. All workflows are idempotent via deterministic workflow IDs.

**Postgres** stores the append-only ledger with DB-trigger enforcement of immutability.

### Auth Model

SIWE wallet login provides `{ id, walletAddress }` in the session. Write routes check the `ledger_issuers` table:

1. User authenticates via SIWE → NextAuth session with `walletAddress`
2. Existing proxy enforces session auth on `/api/v1/*` routes
3. Write route handler calls `requireIssuer(session)` → queries `ledger_issuers` → 403 if not found
4. Route starts Temporal workflow, returns 202 + workflowId

The `ledger_issuers` table is the minimal viable access control. It can be replaced by full RBAC later without modifying the ledger core.

### Receipt Signing

The **client** (issuer's browser wallet) signs the receipt hash using EIP-191. The receipt creation request includes the pre-computed signature. The **server** (Temporal activity) verifies the signature against the claimed `issuer_address` using `viem`. The server never holds private keys.

Receipt hash is the SHA-256 of the canonical receipt fields: `epoch_id`, `subject_id`, `work_item_id`, `artifact_ref`, `role`, `valuation_units`, `rationale_ref`.

### Receipt Lifecycle

Receipts are immutable facts. Lifecycle is tracked via separate `receipt_events`:

- **`proposed`** — receipt created, not yet approved for payout
- **`approved`** — receipt approved for inclusion in epoch payout computation
- **`revoked`** — receipt excluded from future payouts (with reason)

Epoch close queries the latest event per receipt and includes only those with `event_type = 'approved'`.

Revocation is an append-only event, not a deletion. The original receipt and all events remain visible for audit.

### Pool Model

Each epoch's credit budget is the sum of independently computed pool components:

- **`base_issuance`** — constant amount per epoch (bootstraps early-stage work)
- **`kpi_bonus_v0`** — computed from DAO-defined KPI snapshots with pinned algorithm
- **`top_up`** — explicit governance allocation with evidence link to governance vote

Each component stores its `algorithm_version`, `inputs_json` (snapshotted KPI values), `amount_credits`, and `evidence_ref`. Anyone can recompute `pool_total_credits` from these inputs.

Pool components are submitted as part of the epoch close request.

### Payout Computation

Given a set of approved receipts and a total pool, payouts are computed as:

1. Group receipts by `subject_id`, sum `valuation_units` per subject
2. Compute each subject's share: `subject_units / total_units`
3. Distribute `pool_total_credits` proportionally using BIGINT arithmetic
4. Apply largest-remainder rounding to ensure exact sum equals pool total
5. Output: `[{ subject_id, total_units, share, amount_credits }]`

The receipt set hash (SHA-256 of canonical receipt data, sorted by receipt ID) pins the exact input set. Combined with `pool_total_credits` and `policy_content_hash`, the payout is fully deterministic and reproducible.

### Policy Versioning

Valuation policy is a markdown document in the repo (e.g., `docs/policy/valuation-policy.md`). When an epoch opens, the caller provides the policy reference:

- `policy_repo` — GitHub org/repo (e.g., `cogni-dao/cogni-template`)
- `policy_commit_sha` — exact git commit
- `policy_path` — file path within the repo
- `policy_content_hash` — SHA-256 of the file content at that commit

This ensures the policy is reproducibly fetchable without depending on GitHub availability (the content hash can verify any copy).

## Schema

### `ledger_issuers` — authorization allowlist

| Column       | Type          | Notes                                 |
| ------------ | ------------- | ------------------------------------- |
| `address`    | TEXT PK       | Ethereum wallet address (checksummed) |
| `user_id`    | TEXT FK→users | Internal user ID                      |
| `added_by`   | TEXT          | Address of who added this issuer      |
| `created_at` | TIMESTAMPTZ   |                                       |

### `epochs` — one open epoch at a time

| Column                | Type         | Notes                                                  |
| --------------------- | ------------ | ------------------------------------------------------ |
| `id`                  | BIGSERIAL PK |                                                        |
| `status`              | TEXT         | `'open'` or `'closed'`                                 |
| `policy_repo`         | TEXT         | e.g. `cogni-dao/cogni-template`                        |
| `policy_commit_sha`   | TEXT         | Git commit SHA                                         |
| `policy_path`         | TEXT         | e.g. `docs/policy/valuation-policy.md`                 |
| `policy_content_hash` | TEXT         | SHA-256 of policy content at that commit               |
| `pool_total_credits`  | BIGINT       | Sum of pool components (set at close, NULL while open) |
| `opened_at`           | TIMESTAMPTZ  |                                                        |
| `closed_at`           | TIMESTAMPTZ  | NULL while open                                        |
| `created_at`          | TIMESTAMPTZ  |                                                        |

Constraints: partial unique index `UNIQUE (status) WHERE status = 'open'` enforces ONE_OPEN_EPOCH.

### `work_receipts` — immutable facts, append-only

| Column            | Type             | Notes                                                               |
| ----------------- | ---------------- | ------------------------------------------------------------------- |
| `id`              | UUID PK          |                                                                     |
| `epoch_id`        | BIGINT FK→epochs |                                                                     |
| `subject_id`      | TEXT             | `user_id` (UUID) — see [identity spec](./decentralized-identity.md) |
| `work_item_id`    | TEXT             | e.g. `task.0054`                                                    |
| `artifact_ref`    | TEXT             | PR URL or commit SHA                                                |
| `role`            | TEXT             | `'author'`, `'reviewer'`, or `'approver'`                           |
| `valuation_units` | BIGINT           | Human-assigned by approver (VALUATION_IS_HUMAN)                     |
| `rationale_ref`   | TEXT             | Link to evidence or justification                                   |
| `issuer_address`  | TEXT             | Ethereum address of signer                                          |
| `issuer_id`       | TEXT FK→users    | Internal user ID of signer                                          |
| `signature`       | TEXT             | EIP-191 hex signature (client wallet signed)                        |
| `idempotency_key` | TEXT UNIQUE      | `{work_item_id}:{subject_id}:{role}`                                |
| `created_at`      | TIMESTAMPTZ      |                                                                     |

No `status` column. Receipts are immutable facts. DB trigger rejects UPDATE/DELETE.

### `receipt_events` — append-only state transitions

| Column          | Type                  | Notes                                      |
| --------------- | --------------------- | ------------------------------------------ |
| `id`            | UUID PK               |                                            |
| `receipt_id`    | UUID FK→work_receipts |                                            |
| `event_type`    | TEXT                  | `'proposed'`, `'approved'`, or `'revoked'` |
| `actor_address` | TEXT                  | Ethereum address of actor                  |
| `actor_id`      | TEXT FK→users         | Internal user ID                           |
| `reason`        | TEXT                  | Optional — e.g. revocation reason          |
| `created_at`    | TIMESTAMPTZ           |                                            |

DB trigger rejects UPDATE/DELETE.

### `epoch_pool_components` — append-only, pinned inputs

| Column              | Type             | Notes                                          |
| ------------------- | ---------------- | ---------------------------------------------- |
| `id`                | UUID PK          |                                                |
| `epoch_id`          | BIGINT FK→epochs |                                                |
| `component_id`      | TEXT             | e.g. `base_issuance`, `kpi_bonus_v0`, `top_up` |
| `algorithm_version` | TEXT             | Git SHA or semver of the algorithm             |
| `inputs_json`       | JSONB            | Snapshotted KPI values used for computation    |
| `amount_credits`    | BIGINT           | Computed credit amount for this component      |
| `evidence_ref`      | TEXT             | Link to KPI source or governance vote          |
| `computed_at`       | TIMESTAMPTZ      |                                                |

### `payout_statements` — one per closed epoch, derived artifact

| Column                | Type                    | Notes                                                |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| `id`                  | UUID PK                 |                                                      |
| `epoch_id`            | BIGINT UNIQUE FK→epochs | One statement per epoch                              |
| `policy_content_hash` | TEXT                    | Must match epoch's policy_content_hash               |
| `receipt_set_hash`    | TEXT                    | SHA-256 of canonical approved receipts               |
| `pool_total_credits`  | BIGINT                  | Must match epoch's pool_total_credits                |
| `payouts_json`        | JSONB                   | `[{subject_id, total_units, share, amount_credits}]` |
| `created_at`          | TIMESTAMPTZ             |                                                      |

No signature in V0. The statement is a deterministically derived artifact — anyone can recompute it from receipts + pool + policy. Signing (DAO multisig) deferred to P1.

## API

### Write Routes (SIWE + issuer allowlist → Temporal workflow → 202)

| Method | Route                                | Purpose                                            |
| ------ | ------------------------------------ | -------------------------------------------------- |
| POST   | `/api/v1/ledger/epochs`              | Open new epoch (pins policy reference)             |
| POST   | `/api/v1/ledger/receipts`            | Create wallet-signed receipt (idempotent)          |
| POST   | `/api/v1/ledger/receipts/:id/events` | Record receipt event (approve / revoke)            |
| POST   | `/api/v1/ledger/epochs/:id/close`    | Close epoch with pool components → compute payouts |

All write routes require SIWE session with wallet in `ledger_issuers`. Routes start a Temporal workflow and return 202 with the workflow ID. The Temporal worker executes the actual mutation.

### Read Routes (public)

| Method | Route                                 | Purpose                                       |
| ------ | ------------------------------------- | --------------------------------------------- |
| GET    | `/api/v1/ledger/epochs`               | List all epochs                               |
| GET    | `/api/v1/ledger/epochs/:id/receipts`  | List receipts with latest events for an epoch |
| GET    | `/api/v1/ledger/epochs/:id/statement` | Fetch payout statement for a closed epoch     |
| GET    | `/api/v1/ledger/verify/epoch/:id`     | Recompute payouts + verify receipt signatures |

Read routes query the database directly and return results synchronously.

### Verification Endpoint

`GET /api/v1/ledger/verify/epoch/:id` performs independent verification:

1. Fetch all receipts for the epoch
2. Verify each receipt's EIP-191 signature against its `issuer_address`
3. Recompute `receipt_set_hash` from approved receipts
4. Recompute payouts from approved receipts + pool components
5. Compare recomputed values against stored statement
6. Return verification report with per-receipt and per-field results

## Temporal Workflows

All write operations execute as Temporal workflows in the existing `scheduler-worker` service.

### OpenEpochWorkflow

1. Validate issuer is in `ledger_issuers`
2. Check no epoch currently open (ONE_OPEN_EPOCH)
3. Insert epoch row with policy reference

Deterministic workflow ID: `ledger-open-epoch-{policyCommitSha}`

### IssueReceiptWorkflow

1. Validate issuer is in `ledger_issuers`
2. Verify epoch exists and is open
3. Verify EIP-191 signature against claimed `issuer_address`
4. Insert receipt (idempotent via `idempotency_key`) + `proposed` event

Deterministic workflow ID: `ledger-receipt-{idempotencyKey}`

### ReceiptEventWorkflow

1. Validate actor is in `ledger_issuers`
2. Insert approve or revoke event for the receipt

Deterministic workflow ID: `ledger-event-{receiptId}-{eventType}-{timestamp}`

### CloseEpochWorkflow

1. Validate issuer is in `ledger_issuers`
2. If epoch already closed, return existing statement (EPOCH_CLOSE_IDEMPOTENT)
3. Query receipts with latest event = `'approved'`
4. Insert pool components, compute `pool_total_credits`
5. Compute payouts (proportional, BIGINT, largest-remainder)
6. Compute `receipt_set_hash`
7. Atomic transaction: update epoch status to `'closed'`, insert payout statement
8. Return statement

Deterministic workflow ID: `ledger-close-{epochId}`

## Goal

Enable transparent, verifiable credit distribution where human valuation decisions are cryptographically signed, append-only, and independently recomputable.

## Non-Goals

- Algorithmic valuation (SourceCred-style scoring)
- Server-held signing keys
- Full RBAC system
- UI surfaces (P1)
- Merkle proofs or on-chain anchoring (P1/P2)
- Automated receipt issuance from PR merges (P1)

## Related

- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [billing-evolution](./billing-evolution.md) — Existing credit/billing system
- [billing-ingest](./billing-ingest.md) — Callback-driven billing pipeline
- [architecture](./architecture.md) — System architecture
- [sourcecred](./sourcecred.md) — SourceCred as-built (being superseded)
- [decentralized-identity](./decentralized-identity.md) — User identity bindings (`subject_id` = `user_id`)
