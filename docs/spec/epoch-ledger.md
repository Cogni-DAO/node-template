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

|              |                                                                                           |                                     |
| ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| **Project**  | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Project roadmap                     |
| **Spike**    | [spike.0082](../../work/items/spike.0082.transparency-log-design.md)                      | Original design research            |
| **Research** | [transparency-log-receipt-design](../research/transparency-log-receipt-design.md)         | Full design exploration             |
| **Spec**     | [billing-evolution](./billing-evolution.md)                                               | Existing billing/credit system      |
| **Spec**     | [architecture](./architecture.md)                                                         | System architecture                 |
| **Guide**    | [Fork vs Build](../guides/ledger-fork-vs-build.md)                                        | V0 cut-line: what to build vs reuse |

## Core Invariants

| Rule                   | Constraint                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RECEIPTS_IMMUTABLE     | DB trigger rejects UPDATE/DELETE on `work_receipts`. Receipts have no status column — they are immutable facts.                                                                                 |
| EVENTS_APPEND_ONLY     | DB trigger rejects UPDATE/DELETE on `receipt_events`. State transitions are append-only.                                                                                                        |
| POOL_IMMUTABLE         | DB trigger rejects UPDATE/DELETE on `epoch_pool_components`. Once recorded, a pool component's algorithm, inputs, and amount cannot be changed.                                                 |
| RECEIPTS_WALLET_SIGNED | Every receipt has a valid EIP-191 signature from the issuer's wallet. The server verifies signatures but never holds private keys.                                                              |
| ISSUER_AUTHORIZED      | Write operations check role flags on `ledger_issuers`: `can_issue` for receipts, `can_approve` for approve/revoke events, `can_close_epoch` for epoch open/close and pool component recording.  |
| SIGNATURE_DOMAIN_BOUND | Receipt signatures include `chain_id`, `app_domain`, `spec_version`, and `epoch_id` in the signed message to prevent cross-context replay.                                                      |
| MESSAGE_FIELDS_CLEAN   | All fields in the canonical receipt message must not contain newlines. The message uses newline-delimited format; embedded newlines would create ambiguous or colliding signatures.             |
| POOL_PRE_RECORDED      | Pool components must be recorded via their own workflow before epoch close. Close reads existing components by reference — it never creates budget.                                             |
| POOL_REQUIRES_BASE     | At least one `base_issuance` component must exist for the epoch before close is allowed.                                                                                                        |
| EPOCH_POLICY_PINNED    | Policy reference (`repo` + `commit_sha` + `path` + `content_hash`) is set at epoch open and never modified.                                                                                     |
| PAYOUT_DETERMINISTIC   | Given approved receipts + pool components + policy → the payout statement is byte-for-byte reproducible.                                                                                        |
| EPOCH_CLOSE_IDEMPOTENT | Closing a closed epoch returns the existing statement. No error, no mutation.                                                                                                                   |
| IDEMPOTENT_RECEIPTS    | UNIQUE(idempotency_key) prevents duplicate receipts. Retries return the existing receipt.                                                                                                       |
| ONE_OPEN_EPOCH         | Partial unique index enforces at most one epoch with `status = 'open'`.                                                                                                                         |
| VALUATION_IS_HUMAN     | The system never computes `valuation_units` algorithmically. They are human inputs from the approver.                                                                                           |
| UNITS_NON_NEGATIVE     | `valuation_units >= 0` enforced by DB CHECK constraint and runtime guard. Append-only tables cannot be corrected after the fact.                                                                |
| ALL_MATH_BIGINT        | No floating point in unit or credit calculations. All math uses BIGINT with largest-remainder rounding.                                                                                         |
| APPROVED_RECEIPTS_ONLY | Epoch close considers only receipts whose latest `receipt_event` is `'approved'`.                                                                                                               |
| LATEST_EVENT_WINS      | Receipt state is the most recent `receipt_event` by `created_at`. No transition matrix — any event type is valid after any other. Re-approval after revocation is allowed.                      |
| POOL_REPRODUCIBLE      | `pool_total_credits = SUM(epoch_pool_components.amount_credits)`. Each component stores algorithm version + inputs + amount.                                                                    |
| POOL_UNIQUE_PER_TYPE   | UNIQUE(epoch_id, component_id) — each component type (e.g. `base_issuance`, `kpi_bonus_v0`, `top_up`) appears at most once per epoch. To change an amount, record a new component_id.           |
| ADDRESS_NORMALIZED     | All Ethereum addresses stored in lowercase hex. Normalize to lowercase on write (issuer creation, receipt insertion). EIP-55 checksum validation is optional and belongs in the UX/input layer. |
| WRITES_VIA_TEMPORAL    | All write operations (open epoch, issue receipt, record event, close epoch) execute in Temporal workflows via the existing `scheduler-worker` service. Next.js routes return 202 + workflow ID. |

## Design

### System Architecture

**Next.js** handles authentication (SIWE), authorization (issuer allowlist check), read queries (direct DB), and write request enqueuing (start Temporal workflow, return 202).

**Temporal worker** (`services/scheduler-worker/`) handles all write/compute domain actions: signature verification, receipt insertion, epoch close computation, payout generation. All workflows are idempotent via deterministic workflow IDs. The worker imports pure domain logic from `@cogni/ledger-core` (a workspace package) and DB operations from `@cogni/db-client` — it never imports from `src/`.

**`packages/ledger-core/`** contains pure domain logic shared between the app and the worker: model types, `computePayouts()`, `buildReceiptMessage()`, `computeReceiptSetHash()`, and error classes. `src/core/ledger/public.ts` re-exports from this package so app code uses `@/core/ledger` unchanged.

**Postgres** stores the append-only ledger with DB-trigger enforcement of immutability.

### Auth Model

SIWE wallet login provides `{ id, walletAddress }` in the session. Write routes check the `ledger_issuers` table with role-specific flags:

1. User authenticates via SIWE → NextAuth session with `walletAddress`
2. Existing proxy enforces session auth on `/api/v1/*` routes
3. Write route handler calls `requireIssuer(session, requiredRole)` → queries `ledger_issuers` → 403 if not found or role flag is false
4. Route starts Temporal workflow, returns 202 + workflowId

Role flags on `ledger_issuers`:

- **`can_issue`** — create receipts (issue `proposed` events)
- **`can_approve`** — approve or revoke receipts
- **`can_close_epoch`** — open/close epochs and record pool components

A single wallet can hold multiple roles. The `ledger_issuers` table is the minimal viable access control. It can be replaced by full RBAC later without modifying the ledger core.

### Receipt Signing

The **client** (issuer's browser wallet) signs the receipt hash using EIP-191. The receipt creation request includes the pre-computed signature. The **server** (Temporal activity) verifies the signature against the claimed `issuer_address` using `viem`. The server never holds private keys.

The signed message uses a canonical, domain-bound format (SIGNATURE_DOMAIN_BOUND) to prevent cross-context replay:

```
cogni-template.ledger:v0:{chain_id}
epoch:{epoch_id}
receipt:{user_id}:{work_item_id}:{role}
units:{valuation_units}
artifact:{artifact_ref}
rationale:{rationale_ref}
```

The fields `chain_id` (e.g. `8453` for Base mainnet), `app_domain` (`cogni-template.ledger`), and `spec_version` (`v0`) are included so that a signature cannot be lifted from one chain, app, or protocol version and replayed in another. The receipt hash is SHA-256 of this canonical message. EIP-191 signs the hash bytes.

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

Pool components are recorded via their own workflow during the open epoch (POOL_PRE_RECORDED). Only issuers with `can_close_epoch` (or a future `can_record_pool`) permission can record components. At least one `base_issuance` component must exist before epoch close is allowed (POOL_REQUIRES_BASE). The close workflow reads existing components by reference — it never creates budget.

### Payout Computation

Given a set of approved receipts and a total pool, payouts are computed as:

1. Group receipts by `user_id`, sum `valuation_units` per user
2. Compute each user's share: `user_units / total_units`
3. Distribute `pool_total_credits` proportionally using BIGINT arithmetic
4. Apply largest-remainder rounding to ensure exact sum equals pool total
5. Output: `[{ user_id, total_units, share, amount_credits }]`

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

| Column            | Type          | Notes                                                       |
| ----------------- | ------------- | ----------------------------------------------------------- |
| `address`         | TEXT PK       | Ethereum wallet address (lowercase hex, ADDRESS_NORMALIZED) |
| `user_id`         | TEXT FK→users | Internal user ID                                            |
| `can_issue`       | BOOLEAN       | Can create receipts (issue `proposed` events)               |
| `can_approve`     | BOOLEAN       | Can approve or revoke receipts                              |
| `can_close_epoch` | BOOLEAN       | Can open/close epochs and record pool components            |
| `added_by`        | TEXT          | Address of who added this issuer                            |
| `created_at`      | TIMESTAMPTZ   |                                                             |

### `epochs` — one open epoch at a time

| Column                | Type         | Notes                                                  |
| --------------------- | ------------ | ------------------------------------------------------ |
| `id`                  | BIGSERIAL PK |                                                        |
| `status`              | TEXT         | CHECK IN (`'open'`, `'closed'`)                        |
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

| Column            | Type             | Notes                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------- |
| `id`              | UUID PK          |                                                                                 |
| `epoch_id`        | BIGINT FK→epochs |                                                                                 |
| `user_id`         | TEXT FK→users    | UUID — see [identity spec](./decentralized-identity.md)                         |
| `work_item_id`    | TEXT             | e.g. `task.0054`                                                                |
| `artifact_ref`    | TEXT             | PR URL or commit SHA                                                            |
| `role`            | TEXT             | CHECK IN (`'author'`, `'reviewer'`, `'approver'`)                               |
| `valuation_units` | BIGINT           | CHECK >= 0. Human-assigned by approver (VALUATION_IS_HUMAN, UNITS_NON_NEGATIVE) |
| `rationale_ref`   | TEXT             | Link to evidence or justification                                               |
| `issuer_address`  | TEXT             | Ethereum address of signer                                                      |
| `issuer_id`       | TEXT FK→users    | Internal user ID of signer                                                      |
| `signature`       | TEXT             | EIP-191 hex signature (client wallet signed)                                    |
| `idempotency_key` | TEXT UNIQUE      | `{work_item_id}:{user_id}:{role}`                                               |
| `created_at`      | TIMESTAMPTZ      |                                                                                 |

No `status` column. Receipts are immutable facts. DB trigger rejects UPDATE/DELETE.

Index: `work_receipts(epoch_id)` — for epoch receipt listing.

### `receipt_events` — append-only state transitions

| Column          | Type                  | Notes                                              |
| --------------- | --------------------- | -------------------------------------------------- |
| `id`            | UUID PK               |                                                    |
| `receipt_id`    | UUID FK→work_receipts |                                                    |
| `event_type`    | TEXT                  | CHECK IN (`'proposed'`, `'approved'`, `'revoked'`) |
| `actor_address` | TEXT                  | Ethereum address of actor                          |
| `actor_id`      | TEXT FK→users         | Internal user ID                                   |
| `reason`        | TEXT                  | Optional — e.g. revocation reason                  |
| `created_at`    | TIMESTAMPTZ           |                                                    |

DB trigger rejects UPDATE/DELETE.

Index: `receipt_events(receipt_id, created_at DESC)` — for latest-event-per-receipt queries.

### `epoch_pool_components` — immutable, append-only, pinned inputs

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

DB trigger rejects UPDATE/DELETE (POOL_IMMUTABLE). Once recorded, budget inputs cannot be changed.

Constraint: `UNIQUE(epoch_id, component_id)` — each component type appears at most once per epoch (POOL_UNIQUE_PER_TYPE).

### `payout_statements` — one per closed epoch, derived artifact

| Column                | Type                    | Notes                                             |
| --------------------- | ----------------------- | ------------------------------------------------- |
| `id`                  | UUID PK                 |                                                   |
| `epoch_id`            | BIGINT UNIQUE FK→epochs | One statement per epoch                           |
| `policy_content_hash` | TEXT                    | Must match epoch's policy_content_hash            |
| `receipt_set_hash`    | TEXT                    | SHA-256 of canonical approved receipts            |
| `pool_total_credits`  | BIGINT                  | Must match epoch's pool_total_credits             |
| `payouts_json`        | JSONB                   | `[{user_id, total_units, share, amount_credits}]` |
| `created_at`          | TIMESTAMPTZ             |                                                   |

No signature in V0. The statement is a deterministically derived artifact — anyone can recompute it from receipts + pool + policy. Signing (DAO multisig) deferred to P1.

## API

### Write Routes (SIWE + issuer allowlist → Temporal workflow → 202)

| Method | Route                                       | Required role     | Purpose                                   |
| ------ | ------------------------------------------- | ----------------- | ----------------------------------------- |
| POST   | `/api/v1/ledger/epochs`                     | `can_close_epoch` | Open new epoch (pins policy reference)    |
| POST   | `/api/v1/ledger/receipts`                   | `can_issue`       | Create wallet-signed receipt (idempotent) |
| POST   | `/api/v1/ledger/receipts/:id/events`        | `can_approve`     | Approve or revoke a receipt               |
| POST   | `/api/v1/ledger/epochs/:id/pool-components` | `can_close_epoch` | Record a pool component for the epoch     |
| POST   | `/api/v1/ledger/epochs/:id/close`           | `can_close_epoch` | Close epoch → compute payouts             |

All write routes require SIWE session with wallet in `ledger_issuers` and the specified role flag. Routes start a Temporal workflow and return 202 with the workflow ID. The Temporal worker executes the actual mutation.

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

1. Validate issuer has `can_close_epoch` permission
2. Check no epoch currently open (ONE_OPEN_EPOCH)
3. Insert epoch row with policy reference

Deterministic workflow ID: `ledger-open-epoch-{policyCommitSha}`

### IssueReceiptWorkflow

1. Validate issuer has `can_issue` permission
2. Verify epoch exists and is open
3. Verify domain-bound EIP-191 signature against claimed `issuer_address` (SIGNATURE_DOMAIN_BOUND)
4. Insert receipt (idempotent via `idempotency_key`) + `proposed` event

Deterministic workflow ID: `ledger-receipt-{idempotencyKey}`

### ReceiptEventWorkflow

1. Validate actor has `can_approve` permission
2. Insert approve or revoke event for the receipt (LATEST_EVENT_WINS — no transition guards)

Deterministic workflow ID: `ledger-event-{receiptId}-{eventType}` (idempotent per receipt + event type — re-sending the same approve is a no-op)

### RecordPoolComponentWorkflow

1. Validate actor has `can_close_epoch` permission
2. Verify epoch exists and is open
3. Insert pool component row with `algorithm_version`, `inputs_json`, `amount_credits`, `evidence_ref`

Deterministic workflow ID: `ledger-pool-{epochId}-{componentId}`

### CloseEpochWorkflow

1. Validate issuer has `can_close_epoch` permission
2. If epoch already closed, return existing statement (EPOCH_CLOSE_IDEMPOTENT)
3. Verify at least one `base_issuance` pool component exists (POOL_REQUIRES_BASE)
4. Read existing pool components, compute `pool_total_credits = SUM(amount_credits)`
5. Query receipts with latest event = `'approved'`
6. Compute payouts (proportional, BIGINT, largest-remainder)
7. Compute `receipt_set_hash`
8. Atomic transaction: set `pool_total_credits` on epoch, update epoch status to `'closed'`, insert payout statement
9. Return statement

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
- [decentralized-identity](./decentralized-identity.md) — User identity bindings (`user_id` is canonical)
