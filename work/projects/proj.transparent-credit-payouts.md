---
id: proj.transparent-credit-payouts
type: project
primary_charter:
title: "Transparent Credit Payouts — Auditable Decision Ledger"
state: Active
priority: 1
estimate: 5
summary: "Epoch-based ledger where wallet-signed receipts record human valuation decisions, pool components define the credit budget, and anyone can recompute payouts from signed artifacts."
outcome: "A third party can fetch approved receipts + pool components + policy and recompute the payout table exactly. All receipts verify cryptographically (EIP-191 wallet signatures). No server-held keys."
assignees: derekg1729
created: 2026-02-17
updated: 2026-02-20
labels: [governance, transparency, payments, web3]
---

# Transparent Credit Payouts — Auditable Decision Ledger

## Goal

Build a cryptographically auditable decision ledger for human judgment. The system records **who approved what**, **under which valuation policy**, **at what time**, **with what authority**, **leading to what payout**. It does NOT pretend valuation is objective or algorithmic — it makes subjectivity transparent, auditable, and governable.

Receipts are deterministic records of human decisions. The system enforces process correctness (valid signatures, authorized issuers, pinned policy, idempotency). Payout recomputation is deterministic given the signed decisions.

## Supersedes

**proj.sourcecred-onchain** (now Dropped) — Receipt-first architecture replaces SourceCred's algorithmic grain→CSV→Safe pipeline. SourceCred continues running until migration completes. Existing SourceCred specs ([sourcecred.md](../../docs/spec/sourcecred.md), [sourcecred-config-rationale.md](../../docs/spec/sourcecred-config-rationale.md)) remain valid as-built docs.

### Why not extend SourceCred?

1. **Opaque**: Can't point to a specific approval that produced a specific score
2. **Not portable**: Grain is internal state, not a signed artifact
3. **Fake objectivity**: Algorithmic scoring pretends to be fair while hiding assumptions
4. **Not composable**: Doesn't align with VC/DID standards

## Roadmap

### Crawl (P0) — Ship the Ledger Core

**Goal:** 6 DB tables, Temporal workflows, wallet-signed receipts, deterministic payouts. Anyone can recompute.

| Deliverable                                                      | Status      | Est | Work Item       |
| ---------------------------------------------------------------- | ----------- | --- | --------------- |
| Design spike: schema, signing, storage, epoch model              | Done        | 2   | spike.0082      |
| Design revision: decision ledger reframe + Temporal architecture | Done        | 1   | (this document) |
| Spec: epoch-ledger.md                                            | Done        | 1   | —               |
| DB schema (6 tables) + core domain (rules, signing, errors)      | Not Started | 3   | task.0093       |
| Ledger port + Drizzle adapter + container wiring                 | Not Started | 2   | task.0094       |
| Temporal workflows (5 workflows + activities)                    | Not Started | 3   | task.0095       |
| Zod contracts + API routes (5 write, 4 read) + stack tests       | Not Started | 2   | task.0096       |

**V0 user story:**

1. Admin adds issuer wallet to `ledger_issuers` allowlist
2. Issuer opens an epoch via SIWE-authenticated `POST /api/v1/ledger/epochs` (pins policy reference)
3. Work is completed, PR merged
4. Issuer creates wallet-signed receipt via `POST /api/v1/ledger/receipts` with human-assigned `valuation_units`
5. Receipt events track lifecycle: `proposed` → `approved`
6. Pool components recorded during epoch via `POST /api/v1/ledger/epochs/:id/pool-components`
7. Epoch closes via `POST /api/v1/ledger/epochs/:id/close` (reads pre-recorded pool components)
8. System computes deterministic payouts from approved receipts + pool
9. Anyone fetches receipts + pool components + policy and recomputes the exact payout table

**Definition of done:**

- [ ] A third party can fetch approved receipts + pool components and recompute the payout table exactly
- [ ] All receipts verify cryptographically (EIP-191 wallet signatures, server-verified)
- [ ] No server-held private keys — issuers sign with their own wallets
- [ ] Duplicate retries cannot mint duplicate receipts (idempotency_key enforced)
- [ ] Policy cannot change mid-epoch (policy ref pinned at epoch open with content hash)
- [ ] Epoch close is idempotent (closing twice yields identical statement hash)
- [ ] All write operations execute in Temporal workflows (Next.js stateless)

### Walk (P1) — Merkle Integrity + UI + Automation

**Goal:** Merkle proofs for external verification without DB access. UI surfaces. Automated issuance.

| Deliverable                                               | Status      | Est | Work Item            |
| --------------------------------------------------------- | ----------- | --- | -------------------- |
| Merkle tree per epoch + inclusion proofs                  | Not Started | 2   | (create at P1 start) |
| Statement signing (DAO multisig / key store)              | Not Started | 2   | (create at P1 start) |
| UI: `/receipts`, `/epochs/:id`, `/contributors/:id` pages | Not Started | 3   | (create at P1 start) |
| Machine-checked valuation policy config                   | Not Started | 1   | (create at P1 start) |
| Automated issuance hooks (PR merge → receipt)             | Not Started | 2   | (create at P1 start) |
| SourceCred grain → receipt migration strategy             | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Federation + SourceCred Removal

**Goal:** Receipts as portable VCs. SourceCred removed. Cross-org verification.

| Deliverable                                          | Status      | Est | Work Item            |
| ---------------------------------------------------- | ----------- | --- | -------------------- |
| Receipt schema → VC data model (JWT VC, DID subject) | Not Started | 2   | (create at P2 start) |
| Multi-issuer trust policy                            | Not Started | 3   | (create at P2 start) |
| SourceCred removal from stack                        | Not Started | 2   | (create at P2 start) |
| On-chain Merkle root anchoring                       | Not Started | 2   | (create at P2 start) |

## Architecture & Schema

See [epoch-ledger spec](../../docs/spec/epoch-ledger.md) for full architecture, schema (6 tables), invariants, API contracts, and Temporal workflows.

## Constraints

- Valuation is human judgment — system never computes `valuation_units` algorithmically
- Policy pinned at epoch open with `{repo, commit_sha, path, content_hash}` — reproducibly fetchable
- Receipts are immutable facts — state tracked via append-only events
- Receipt signatures are domain-bound (chain_id + app_domain + spec_version) to prevent cross-context replay
- Issuer permissions are role-based: `can_issue`, `can_approve`, `can_close_epoch` — separation of authority
- All Ethereum addresses stored in lowercase hex (ADDRESS_NORMALIZED) — EIP-55 checksum is UX-layer only
- Pool components are pre-recorded during epoch — close reads them, never creates budget
- Each pool component type appears at most once per epoch (POOL_UNIQUE_PER_TYPE)
- At least one `base_issuance` pool component required before epoch close
- Epoch close is idempotent — same inputs produce identical statement hash
- All write operations go through Temporal — Next.js stays stateless
- All monetary math in BIGINT — no floating point
- `user_id` (UUID) is the canonical identity for all attribution — see [identity spec](../../docs/spec/decentralized-identity.md)

## Biggest Risk

If valuation pretends to be objective (algorithmic scores, fixed role splits), you recreate SourceCred's core problem with nicer plumbing. The system's job is to make human judgment transparent and auditable, not to replace it with fake precision.

## Dependencies

- [x] spike.0082 — design doc landed
- [x] Existing governance approval flow stable (task.0054 — Done)
- [x] Temporal + scheduler-worker service operational
- [x] SIWE wallet auth operational
- [ ] `ledger_issuers` seeded with admin wallet address

## As-Built Specs

- [epoch-ledger](../../docs/spec/epoch-ledger.md) — V0 schema, invariants, API, architecture

## Design Notes

### Key reframe from spike.0082

spike.0082 designed a "deterministic distribution engine" with algorithmic valuation (`estimate × role split = units`). This project revision corrects the mental model: **the system is a decision ledger, not a valuation engine**. Deterministic recomputation applies to payouts given signed decisions — not to the decisions themselves.

### Technical decisions

| Decision      | Choice                                          | Why                                            |
| ------------- | ----------------------------------------------- | ---------------------------------------------- |
| Signing       | EIP-191 via `viem`, client-signed, domain-bound | No server keys; replay-safe across chains/apps |
| Auth          | SIWE + `ledger_issuers` with role flags         | Separation of authority without full RBAC      |
| Storage       | Postgres append-only + DB triggers              | Zero new deps, hard enforcement                |
| Receipt state | Separate `receipt_events` table                 | Receipts immutable, events append-only         |
| Epoch trigger | Manual via API → Temporal workflow              | Next.js stateless, worker executes             |
| Valuation     | Human-assigned `valuation_units`                | No fake objectivity                            |
| Pool          | Sum of pinned components                        | Reproducible, governable                       |
| Math          | BIGINT, largest-remainder rounding              | Cross-platform determinism                     |
| Policy        | `{repo, SHA, path}` + content hash              | Reproducibly fetchable                         |

## PR / Links

- Handoff: [handoff](../handoffs/proj.transparent-credit-payouts.handoff.md)

### What V0 explicitly defers

- **Merkle trees / inclusion proofs** → P1
- **Statement signing** → P1 (requires key store / multisig)
- **UI pages** → P1
- **DID/VC alignment** → P2
- **Federation / cross-org verification** → P2
- **Automated issuance hooks** → P1
- **Machine-checked policy config** → P1+
- **Non-work-item contributions** → P1
