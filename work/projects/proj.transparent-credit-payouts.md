---
id: proj.transparent-credit-payouts
type: project
primary_charter:
title: Transparent Credit Payouts — Auditable Receipts, Merkle Log, Deterministic Distribution
state: Active
priority: 1
estimate: 5
summary: Replace SourceCred-based contribution tracking with signed WorkReceipts appended to a transparency log, enabling deterministic, auditable epoch payouts verifiable from receipts + published rules alone.
outcome: Every contributor payout can be independently verified from receipts, inclusion proofs, and published scoring rules — no admin trust required. SourceCred contribution scoring is superseded.
assignees: derekg1729
created: 2026-02-17
updated: 2026-02-17
labels: [governance, transparency, payments, web3]
---

# Transparent Credit Payouts — Auditable Receipts, Merkle Log, Deterministic Distribution

## Goal

Build a verifiable contribution-to-payout pipeline for CogniDAO. Approved work produces signed WorkReceipts appended to an append-only transparency log with Merkle integrity. At epoch close, a deterministic distribution engine computes payouts from receipts + published weight rules. Anyone can verify any payout independently. This supersedes the current SourceCred grain-based scoring system with a receipt-first architecture that composes with the DID-first identity project (proj.decentralized-identity) at P1+.

## Supersedes

**proj.sourcecred-onchain** (now Dropped) — The SourceCred CSV→Safe on-chain payout pipeline is replaced by this project's receipt-first architecture. SourceCred itself still runs in the stack for contribution scoring; this project provides the path to replace it with explicit, signed receipts rather than algorithmic grain scores. The existing SourceCred specs ([sourcecred.md](../../docs/spec/sourcecred.md), [sourcecred-config-rationale.md](../../docs/spec/sourcecred-config-rationale.md)) remain valid as-built documentation of the current system until migration completes.

## Roadmap

### Crawl (P0) — Receipt Foundation + Design Spike

**Goal:** Design the system, stand up WorkReceipt schema and append-only transparency log in Postgres, issue first receipts from governance approvals.

| Deliverable                                                         | Status      | Est | Work Item  |
| ------------------------------------------------------------------- | ----------- | --- | ---------- |
| Design spike: receipt schema, signing, log storage, epoch model     | Todo        | 2   | spike.0082 |
| WorkReceipt schema + DB migration (append-only receipts table)      | Not Started | 2   | —          |
| Receipt issuance from governance approval flow                      | Not Started | 2   | —          |
| Append-only transparency log with monotonic index                   | Not Started | 2   | —          |
| Merkle tree per epoch + inclusion proof generation                  | Not Started | 2   | —          |
| Deterministic distribution engine (receipts + rules → payout table) | Not Started | 3   | —          |
| Signed DistributionStatement at epoch close                         | Not Started | 1   | —          |

### Walk (P1) — UI + SourceCred Migration

**Goal:** Transparency surfaces in the UI. Begin migrating contribution scoring from SourceCred grain to receipt-based weights. Receipts evolve toward VC shape (aligns with proj.decentralized-identity P1).

| Deliverable                                                | Status      | Est | Work Item            |
| ---------------------------------------------------------- | ----------- | --- | -------------------- |
| `/receipts` page — filter by subject, epoch, category      | Not Started | 2   | (create at P1 start) |
| `/epoch/:id` page — root, rules, payouts, inclusion proofs | Not Started | 2   | (create at P1 start) |
| `/contributors/:id` page — history, receipts, payouts      | Not Started | 2   | (create at P1 start) |
| SourceCred grain → receipt migration strategy              | Not Started | 2   | (create at P1 start) |
| Receipt schema alignment with VC data model (JWT VC shape) | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Federation + SourceCred Removal

**Goal:** Receipts are portable Verifiable Credentials. SourceCred is fully removed from the stack. Other DAOs can accept and verify receipts.

| Deliverable                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------ | ----------- | --- | -------------------- |
| WorkReceipts issued as Verifiable Credentials                | Not Started | 2   | (create at P2 start) |
| Multi-issuer trust policy (accept receipts from other nodes) | Not Started | 3   | (create at P2 start) |
| SourceCred removal from stack (all scoring via receipts)     | Not Started | 2   | (create at P2 start) |
| Optional Merkle root anchoring (on-chain or Rekor-style)     | Not Started | 2   | (create at P2 start) |
| Credential export (contributor takes receipts elsewhere)     | Not Started | 2   | (create at P2 start) |

## Constraints

- SIWE wallet address as `subject_id` for P0; DID adoption follows proj.decentralized-identity timeline
- SourceCred continues running in parallel until P2 migration completes — no big-bang cutover
- Blockchain is NOT the primary data plane; Postgres is the source of truth. On-chain anchoring is optional and deferred to P2+
- Receipt issuance requires explicit, signed approval — no implicit or algorithmic issuance
- Schemas are strict and versioned; changing scoring rules mid-epoch is forbidden
- Epoch boundaries are explicit (not wall-clock drift)
- Linking flows must be idempotent (retries don't mint duplicate receipts)
- Weight rules are versioned config in the repo, not runtime-mutable

## Dependencies

- [ ] spike.0082 — design doc must land before implementation begins
- [ ] Existing governance approval flow stable (task.0054 — Done)
- [ ] proj.decentralized-identity P0 for DID `subject_id` (P1+ only, not blocking P0)
- [ ] Existing SourceCred specs remain valid as-built documentation during transition

## Impacted Specs (Must Update)

These specs will need updates as implementation lands:

- [sourcecred.md](../../docs/spec/sourcecred.md) — contribution scoring (superseded by receipts at P2)
- [sourcecred-config-rationale.md](../../docs/spec/sourcecred-config-rationale.md) — weight policy (migrated to versioned rules config)
- [billing-ingest.md](../../docs/spec/billing-ingest.md) — payout identity references (wallet → DID at P1+)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why not extend SourceCred?

SourceCred produces algorithmic grain scores from GitHub/Discord activity. This has three problems for a DAO payout pipeline:

1. **Opaque**: Grain scores are not individually auditable — you can't point to a specific approval that produced a specific score
2. **Not portable**: Grain is internal state, not a signed artifact. Can't be verified externally or carried to another DAO
3. **Not composable**: Grain doesn't align with VC/DID standards, making federation impossible

The receipt-first approach replaces algorithmic scoring with explicit approval events, each producing a signed, verifiable artifact.

### Relationship to proj.decentralized-identity

The two projects are independent in P0 but converge:

| Phase | Identity (proj.decentralized-identity) | Payouts (this project)                    |
| ----- | -------------------------------------- | ----------------------------------------- |
| P0    | did:pkh column + dual-write            | Receipts use wallet address as subject_id |
| P1    | VCs for account links                  | Receipts shaped as VCs, subject_id = DID  |
| P2    | Federation, multi-method DIDs          | Portable receipts, multi-issuer trust     |

### Key design decisions (pending spike.0082)

- **Signing scheme**: Ed25519 vs EIP-191 vs EIP-712 — spike should evaluate
- **Merkle strategy**: per-epoch batch tree vs incremental (RFC 6962-style)
- **Epoch model**: cron-based, manual trigger, or governance-run-based
- **Storage abstraction**: how to keep consumer API stable for future Trillian/Rekor swap

### Recommendations from initial ideation

- Do NOT make blockchain the primary data plane; use it only for anchoring roots or settlement later
- Treat receipt issuance as the governance choke-point: approvals must be explicit and signed
- Keep schemas strict and versioned; changing scoring rules mid-epoch is how DAOs lose legitimacy
