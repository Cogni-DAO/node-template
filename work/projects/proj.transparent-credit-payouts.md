---
id: proj.transparent-credit-payouts
type: project
primary_charter:
title: Transparent Credit Payouts — Signed Receipts + Deterministic Distribution
state: Active
priority: 1
estimate: 4
summary: Merged PR → signed WorkReceipt → epoch close computes payouts from receipts + pinned rules → signed payout statement. Anyone can recompute and verify.
outcome: A third party can fetch receipts + rules and recompute the payout table exactly. All receipts and the payout statement verify cryptographically (EIP-191).
assignees: derekg1729
created: 2026-02-17
updated: 2026-02-17
labels: [governance, transparency, payments, web3]
---

# Transparent Credit Payouts — Signed Receipts + Deterministic Distribution

## Goal

Merged PR tied to a work item → approver issues signed WorkReceipt → epoch close computes payouts from receipts + pinned rules → signed payout statement published → anyone recomputes and verifies signatures. This supersedes SourceCred's opaque grain scoring with explicit, signed, verifiable artifacts.

## Supersedes

**proj.sourcecred-onchain** (now Dropped) — Receipt-first architecture replaces SourceCred's algorithmic grain→CSV→Safe pipeline. SourceCred continues running until migration completes. Existing SourceCred specs ([sourcecred.md](../../docs/spec/sourcecred.md), [sourcecred-config-rationale.md](../../docs/spec/sourcecred-config-rationale.md)) remain valid as-built docs.

## Roadmap

### Crawl (P0) — Ship It

**Goal:** 3 tables, 5 API routes, EIP-191 signatures. A verifier can independently recompute payouts.

| Deliverable                                                      | Status      | Est | Work Item  |
| ---------------------------------------------------------------- | ----------- | --- | ---------- |
| Design spike: schema, signing, storage, epoch model, valuation   | Done        | 2   | spike.0082 |
| DB schema + core domain + receipt signing                        | Not Started | 3   | —          |
| API: receipt issuance, epoch lifecycle, payout statement, verify | Not Started | 3   | —          |
| Weight rules config + deterministic distribution engine          | Not Started | 2   | —          |

**V0 user story:**

1. Contributor merges PR linked to a work item
2. Approver issues signed WorkReceipt via `POST /api/v1/receipts`
3. Epoch closes via `POST /api/v1/epochs/:id/close`
4. Distribution engine computes payouts from receipts + pinned rules
5. Signed payout statement published via `GET /api/v1/epochs/:id/payout-statement`
6. Anyone fetches receipts + rules_version and recomputes the exact payout table

**Definition of done:**

- [ ] A third party can fetch receipts + rules_version and recompute the payout table exactly
- [ ] All receipts and the payout statement verify cryptographically (EIP-191)
- [ ] Duplicate retries cannot mint duplicate receipts (idempotency_key enforced)
- [ ] Rules cannot change mid-epoch (rules_version pinned in epochs row)

### Walk (P1) — Merkle Integrity + UI + SourceCred Migration

**Goal:** Merkle proofs for external verification without DB access. UI surfaces. Begin SourceCred migration.

| Deliverable                                                   | Status      | Est | Work Item            |
| ------------------------------------------------------------- | ----------- | --- | -------------------- |
| Merkle tree per epoch + inclusion proofs (add `merkletreejs`) | Not Started | 2   | (create at P1 start) |
| UI: `/receipts`, `/epochs/:id`, `/contributors/:id` pages     | Not Started | 3   | (create at P1 start) |
| SourceCred grain → receipt migration strategy                 | Not Started | 2   | (create at P1 start) |
| Non-work-item contributions (governance, community, ops)      | Not Started | 2   | (create at P1 start) |
| Automated issuance hooks (PR merge → receipt without manual)  | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Federation + SourceCred Removal

**Goal:** Receipts as portable VCs. SourceCred removed. Cross-org verification.

| Deliverable                                          | Status      | Est | Work Item            |
| ---------------------------------------------------- | ----------- | --- | -------------------- |
| Receipt schema → VC data model (JWT VC, DID subject) | Not Started | 2   | (create at P2 start) |
| Multi-issuer trust policy                            | Not Started | 3   | (create at P2 start) |
| SourceCred removal from stack                        | Not Started | 2   | (create at P2 start) |
| On-chain Merkle root anchoring                       | Not Started | 2   | (create at P2 start) |

## V0 Schema

### Tables

**`epochs`** — one open epoch at a time

| Column          | Type         | Notes                         |
| --------------- | ------------ | ----------------------------- |
| `id`            | BIGSERIAL PK |                               |
| `status`        | TEXT         | `open`, `closed`              |
| `rules_version` | TEXT         | Git SHA, locked at epoch open |
| `opened_at`     | TIMESTAMPTZ  |                               |
| `closed_at`     | TIMESTAMPTZ  | NULL while open               |
| `created_at`    | TIMESTAMPTZ  |                               |

**`work_receipts`** — append-only, DB trigger rejects UPDATE/DELETE

| Column            | Type             | Notes                                 |
| ----------------- | ---------------- | ------------------------------------- |
| `id`              | UUID PK          |                                       |
| `epoch_id`        | BIGINT FK→epochs |                                       |
| `subject_id`      | TEXT             | Wallet address (P0), DID (P1+)        |
| `work_item_id`    | TEXT             | e.g. `task.0054`                      |
| `artifact_ref`    | TEXT             | PR URL or commit SHA                  |
| `role`            | TEXT             | `author`, `reviewer`, `approver`      |
| `units`           | BIGINT           | Post-split units (base × role weight) |
| `issuer_address`  | TEXT             | Ethereum address of signer            |
| `signature`       | TEXT             | EIP-191 hex signature                 |
| `idempotency_key` | TEXT UNIQUE      | `{work_item_id}:{subject_id}:{role}`  |
| `created_at`      | TIMESTAMPTZ      |                                       |

**`payout_statements`** — one per finalized epoch

| Column             | Type                    | Notes                                       |
| ------------------ | ----------------------- | ------------------------------------------- |
| `id`               | UUID PK                 |                                             |
| `epoch_id`         | BIGINT UNIQUE FK→epochs |                                             |
| `rules_version`    | TEXT                    | Must match epoch's rules_version            |
| `receipt_set_hash` | TEXT                    | SHA-256 of canonical receipt IDs + payloads |
| `payouts_json`     | JSONB                   | `[{subject_id, units, share, amount}]`      |
| `issuer_address`   | TEXT                    |                                             |
| `signature`        | TEXT                    | EIP-191 over statement hash                 |
| `created_at`       | TIMESTAMPTZ             |                                             |

### Valuation model (V0)

- **Base units** = `work_item.estimate` (0–5 scale, already in work item metadata)
- **Role split**: author 70%, reviewer 20%, approver 10%
- **Post-split storage**: `work_receipts.units` stores the post-split value (e.g., estimate=5, author receipt → units=3.5 scaled to BIGINT as 3500)
- **Non-code work** must be represented as a work item with an evidence link, or excluded in V0
- **rules_version** = git SHA of `config/payout-rules.yaml`, pinned at epoch open

### API (V0 minimum)

| Method | Route                                 | Auth           | Purpose                                   |
| ------ | ------------------------------------- | -------------- | ----------------------------------------- |
| POST   | `/api/v1/receipts`                    | Admin/approver | Create signed receipt (idempotent)        |
| GET    | `/api/v1/epochs/:id/receipts`         | Public         | List receipts for epoch                   |
| POST   | `/api/v1/epochs/:id/close`            | Admin          | Compute payouts + create signed statement |
| GET    | `/api/v1/epochs/:id/payout-statement` | Public         | Fetch signed payout statement             |
| GET    | `/api/v1/verify/epoch/:id`            | Public         | Server-side verification report           |

## Constraints

- Receipt issuance requires explicit, signed approval — no implicit or algorithmic issuance
- Rules cannot change mid-epoch (rules_version pinned in epochs row)
- Append-only: DB trigger rejects UPDATE/DELETE on work_receipts
- Idempotency: UNIQUE(idempotency_key) prevents duplicate receipts
- All monetary math in BIGINT — no floating point
- Wallet address as subject_id for V0; DID deferred to proj.decentralized-identity

## Biggest Risk

If issuance is not constrained (who can issue, what qualifies, idempotency), you recreate SourceCred-style opacity with different plumbing. The choke-point is `POST /api/v1/receipts` — must be admin-only with explicit approval evidence.

## Dependencies

- [x] spike.0082 — design doc landed
- [x] Existing governance approval flow stable (task.0054 — Done)
- [ ] `RECEIPT_ISSUER_PRIVATE_KEY` env var wired

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### What V0 explicitly defers

See [research doc](../../docs/research/transparency-log-receipt-design.md) for full designs on deferred topics:

- **Merkle trees / inclusion proofs** → P1. V0 verification = query DB + check EIP-191 signatures
- **DID/VC alignment** → P2. V0 uses wallet addresses
- **Federation / cross-org verification** → P2
- **Non-work-item contributions** → P1. V0 requires a work item with evidence link
- **Automated issuance hooks** (PR merge triggers) → P1. V0 is manual `POST /api/v1/receipts`
- **TransparencyLogPort abstraction** → P1. V0 is direct Drizzle adapter
- **`merkletreejs` dependency** → P1. V0 uses only `viem` (already installed)

### Why not extend SourceCred?

1. **Opaque**: Can't point to a specific approval that produced a specific score
2. **Not portable**: Grain is internal state, not a signed artifact
3. **Not composable**: Doesn't align with VC/DID standards

### Technical decisions (resolved by spike.0082)

| Decision      | Choice                             | Why                                          |
| ------------- | ---------------------------------- | -------------------------------------------- |
| Signing       | EIP-191 via `viem`                 | Already in deps, unifies with SIWE wallets   |
| Storage       | Postgres append-only               | Zero new deps, DB trigger enforcement        |
| Epoch trigger | Manual via API (V0)                | Simplest. Governance-triggered at P1         |
| Valuation     | Estimate-based + role split        | Deterministic, already in work item metadata |
| Math          | BIGINT, largest-remainder rounding | Cross-platform determinism                   |
