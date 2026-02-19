---
id: proj.decentralized-identity
type: project
primary_charter:
title: Decentralized Identity — DID-First Members with Verifiable Credentials
state: Active
priority: 1
estimate: 4
summary: Replace wallet-address-as-identity with subject DID (did:key) as canonical identifier; wallet did:pkh and external accounts are linked identifiers/VCs, enabling federation without database integration.
outcome: Members identified by stable subject DIDs regardless of first auth method, wallet/Discord/GitHub are linked identifiers, account links are portable VC artifacts, verification uses PEX semantics, and DID ops are behind a method-agnostic port.
assignees: derekg1729
created: 2026-02-17
updated: 2026-02-19
labels: [identity, web3, ssi]
---

# Decentralized Identity — DID-First Members with Verifiable Credentials

## Goal

Make Cogni's identity layer speak decentralized identity standards natively. Every member gets a stable subject DID (`did:key`) at first contact — regardless of auth method. Wallet `did:pkh` is a linked identifier, not the subject itself, so Discord-first users work without placeholder hacks. External account links (Discord, GitHub) are stored as Verifiable Credentials, and proof requests use Presentation Exchange semantics. This preserves existing SIWE auth while enabling future federation.

## Roadmap

### Crawl (P0) — DID Foundation

**Goal:** Ship subject DID (`did:key`) as canonical identifier with `user_dids` linked-DID table and session integration.

| Deliverable                                                    | Status      | Est | Work Item  |
| -------------------------------------------------------------- | ----------- | --- | ---------- |
| Research spike: gap analysis + design doc                      | Done        | 2   | spike.0080 |
| Subject DID + linked DIDs — schema, derivation, session wiring | Not Started | 2   | task.0089  |

### Walk (P1) — Verifiable Credentials for Account Links

**Goal:** Discord and GitHub account links are VC-shaped artifacts with issuance, evidence, and revocation. PEX verification interface exists.

| Deliverable                                                     | Status      | Est | Work Item            |
| --------------------------------------------------------------- | ----------- | --- | -------------------- |
| VC data model for account link credentials (Discord, GitHub)    | Not Started | 2   | (create at P1 start) |
| Credential issuance flow (Discord bot challenge, GitHub gist)   | Not Started | 3   | (create at P1 start) |
| Credential revocation (append-only, status-based)               | Not Started | 2   | (create at P1 start) |
| PEX verification interface (Presentation Definition/Submission) | Not Started | 2   | (create at P1 start) |
| Identity event ledger (append-only state transitions)           | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Federation Readiness

**Goal:** Identity layer supports multiple DID methods and cross-node credential acceptance.

| Deliverable                                                     | Status      | Est | Work Item            |
| --------------------------------------------------------------- | ----------- | --- | -------------------- |
| Additional DID method support via Registration port             | Not Started | 2   | (create at P2 start) |
| Credential export (user can take their VCs elsewhere)           | Not Started | 2   | (create at P2 start) |
| Multi-issuer trust policy (accept credentials from other nodes) | Not Started | 3   | (create at P2 start) |
| DIDComm evaluation for private inter-node channels              | Not Started | 1   | (create at P2 start) |

## Constraints

- SIWE authentication must continue working uninterrupted throughout all phases
- No blockchain DID registry, Sidetree network, or DIDComm required for P0/P1
- No on-chain reputation tokens or cred contracts in scope
- JWT VC format preferred over JSON-LD for simplicity in v0 (revisit at P2)
- Discord identifiers must use immutable numeric IDs, never usernames
- All identity state transitions must be append-only; current state is derived
- Linking flows must be idempotent (retries don't mint duplicate credentials)
- Raw external identifiers are private by default; not exposed publicly

## Dependencies

- [x] spike.0080 — design doc landed ([research doc](../../docs/research/did-first-identity-refactor.md))
- [ ] Existing SIWE auth stable (authentication spec — no breaking changes in flight)
- [ ] RBAC actor type `user:{walletAddress}` migration coordinated (see rbac spec)
- [ ] User context spec's `opaqueId` derivation aligned with DID (user-context spec)

## Impacted Specs (Must Update)

These existing specs reference wallet address as identity and will need updates as implementation lands:

- [authentication.md](../../docs/spec/authentication.md) — `SIWE_CANONICAL_IDENTITY` invariant (wallet address → DID)
- [security-auth.md](../../docs/spec/security-auth.md) — auth surface identity resolution
- [accounts-design.md](../../docs/spec/accounts-design.md) — `ONE_USER_ONE_BILLING_ACCOUNT` mapping (user.id → DID)
- [rbac.md](../../docs/spec/rbac.md) — actor type `user:{walletAddress}` → `user:{did}`
- [user-context.md](../../docs/spec/user-context.md) — `opaqueId` derivation from DID
- [billing-ingest.md](../../docs/spec/billing-ingest.md) — billing identity references

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Identity Model (Revised Post-Spike)

**Key insight (design review feedback):** `did:pkh` cannot be the canonical identity because it doesn't exist until a wallet is linked. Discord-first users would hit a dead-end. The clean fix:

```
Subject DID:   did:key:z...     ← minted once at first contact (stable, auth-method-agnostic)
Linked DID(s): did:pkh:eip155:… ← added when SIWE wallet connects
Discord/GitHub: VC claims        ← about the subject DID
```

**DB schema:**

- `users.subject_did TEXT UNIQUE NOT NULL` — the canonical identifier
- `user_dids(did PK, user_id FK, kind)` — linked DIDs (wallet, alias)
- `users.id UUID PK` — stays as relational FK target (no FK migration)

### Standards Alignment (DIF/SSI)

The project adopts four DIF primitives without inventing new protocols:

1. **did:key** — subject DID minted at first contact (ed25519). Stable, auth-method-agnostic.
2. **did:pkh** — deterministic DID from wallet chain + address. Linked to subject, not the subject itself.
3. **Verifiable Credentials (VC data model)** — account links as signed, revocable credential artifacts.
4. **Presentation Exchange (PEX)** — verifier expresses requirements as Presentation Definition; holder responds with Presentation Submission. Transport-agnostic.
5. **DID Registration** — internal port for create/update/deactivate/resolve. Method-agnostic from day one.

### Critical Invariants (Added Post-Spike)

- **I-SUBJECT-DID**: Every member has a subject DID (`did:key`) minted at first contact. Wallet `did:pkh` is a linked DID, not the subject.
- **I-NO-AUTO-MERGE**: If a DID is already linked to a different subject, require explicit merge with proofs. Never silently re-point links. Prevents account-takeover and attribution corruption.

### What We Explicitly Defer

- DIDComm — useful for private agent-to-agent comms, not needed for identity standardization
- Trust registry machinery — issuer = "our system" until we actually federate
- On-chain reputation/cred tokens — orthogonal to identity primitives

### Key Design Decisions (Resolved — spike.0080 + design review)

- **Subject DID**: `did:key` from ed25519 keypair, minted once per user at creation. Auth-method-agnostic.
- **Wallet DID**: `did:pkh` is a _linked_ identifier, not the subject. Stored in `user_dids` table.
- **VC format**: JWT VC via `did-jwt-vc`. Simpler than JSON-LD, W3C-compliant, upgrade path exists.
- **VC signing**: System-issued VCs use ES256K server-side signer (`did:key`). EIP-712 wallet signing deferred to P2+.
- **Chain ID**: Read from SIWE message payload — never default to `1`.
- **No auto-merge**: DB-level unique constraint on `user_dids.did` prevents silent re-pointing.
- **Phase 2 scope**: VC tables/endpoints designed when account linking actually ships (proj.messenger-channels), not pre-designed.
