---
id: story.0079
type: story
title: DID-first identity — decentralized member identifiers with verifiable account links
status: needs_triage
priority: 1
estimate: 4
summary: Replace wallet-address-as-identity with did:pkh canonical identifiers; represent Discord/GitHub account links as Verifiable Credentials instead of ad-hoc DB rows.
outcome: Members are identified by DIDs internally, account links are portable credential artifacts, and the system can federate identity claims without a database rewrite.
spec_refs:
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [identity, web3, ssi]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# DID-First Identity — Decentralized Member Identifiers

## Problem

Cogni currently treats identity as app-specific database rows: wallet addresses as primary keys, Discord/GitHub links as ad-hoc columns. This couples identity to our schema, makes federation impossible without schema integration, and doesn't align with decentralized identity standards the DAO should natively speak.

## Who Benefits

- **DAO members**: portable, privacy-respecting identity they control; account links they can export and prove elsewhere.
- **Node operators**: federate trust by accepting credentials rather than integrating databases.
- **Platform team**: clean identity abstraction that doesn't require rewrites when adding new auth methods or federating with other nodes.

## What Success Looks Like

1. **Canonical identity = DID**: every member is identified internally by `did:pkh:<chain>:<address>` derived deterministically from their SIWE wallet. No wallet address strings as user IDs in business logic.
2. **Account links = Verifiable Credentials**: Discord and GitHub links are VC-shaped artifacts (issuer, subject, evidence, revocation status) — not rows in a linking table.
3. **Verification = Presentation Exchange**: when a service needs proof of an account link, it expresses requirements as a Presentation Definition (PEX) and gets back a Presentation Submission. Transport-agnostic (HTTP today, DIDComm later).
4. **Method agility**: DID create/resolve/update/deactivate behind a Registration/Resolution port so adding new DID methods doesn't rewrite business logic.
5. **Backward compatible**: SIWE login continues working end-to-end throughout transition. Existing users keep access uninterrupted.

## Requirements

- Canonical identity key is a DID string (`did:pkh`), not a wallet address
- Same wallet deterministically maps to the same DID across environments
- External account links (Discord, GitHub) stored as Verifiable Credential objects with: proof method, evidence, issuance timestamp, issuer identity, revocation capability
- Identity state transitions recorded append-only (link issued, revoked, etc.); current state is derived
- Linking flows are idempotent (retries don't mint duplicate credentials)
- Raw external identifiers (Discord numeric ID, GitHub username) treated as scoped/private data by default
- No blockchain registry, DIDComm, or trust registry required for v0
- No on-chain reputation tokens in scope
- SIWE authentication unchanged — DID is derived post-auth

## Invariants

These must hold at all times once shipped:

1. **I-CANONICAL-DID**: Internal identity key = DID, never raw wallet address
2. **I-DETERMINISTIC**: `did:pkh` derivation is pure function of chain + address
3. **I-CLAIMS-ARE-CREDENTIALS**: Account links are VC artifacts, not DB rows
4. **I-APPEND-ONLY-EVENTS**: Identity events are append-only; no mutation of history
5. **I-IDEMPOTENT-LINKING**: Repeated link attempts produce the same credential, not duplicates
6. **I-REVOCATION-EXISTS**: Links are revocable without deleting history
7. **I-PEX-VERIFICATION**: Proof requests use Presentation Exchange semantics
8. **I-METHOD-AGILITY**: DID ops behind a port; adding methods doesn't touch business logic
9. **I-PRIVACY-DEFAULT**: External identifiers not exposed publicly unless explicitly required

## Allowed Changes

- Identity/auth modules, DB schema, API routes
- Discord/GitHub linking flows
- Any code that references wallet address as user identity
- New `identity` service or module
- New DB tables/migrations for DIDs, credentials, identity events

## Plan

_High-level only — detailed planning in `/task` after spike completes._

- [ ] Complete spike.0080 (research current identity surface + design)
- [ ] Introduce DID fields + dual-write (Phase 0)
- [ ] Switch reads to DID (Phase 1)
- [ ] Represent account links as VCs with PEX verification interface
- [ ] Deprecate legacy wallet-address identifiers (Phase 2)

## Validation

**Acceptance criteria (must be testable):**

- SIWE login produces correct `did:pkh` and persists it
- Linking Discord/GitHub issues a credential artifact, verifiable server-side
- Revoking a link marks credential as revoked without deleting history
- Identity endpoints are idempotent (duplicate calls don't create duplicate artifacts)
- No production data loss; existing users keep uninterrupted access
- All identity event state transitions appear in append-only ledger

## Review Checklist

- [ ] **Work Item:** `story.0079` linked in PR body
- [ ] **Spec:** all invariants upheld (I-CANONICAL-DID through I-PRIVACY-DEFAULT)
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spike: spike.0080

## Attribution

-
