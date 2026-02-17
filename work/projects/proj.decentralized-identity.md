---
id: proj.decentralized-identity
type: project
primary_charter:
title: Decentralized Identity — DID-First Members with Verifiable Credentials
state: Active
priority: 1
estimate: 4
summary: Replace wallet-address-as-identity with did:pkh canonical identifiers and represent account links as Verifiable Credentials, enabling federation without database integration.
outcome: Members identified by DIDs internally, account links are portable VC artifacts, verification uses PEX semantics, and DID ops are behind a method-agnostic port.
assignees: derekg1729
created: 2026-02-17
updated: 2026-02-18
labels: [identity, web3, ssi]
---

# Decentralized Identity — DID-First Members with Verifiable Credentials

## Goal

Make Cogni's identity layer speak decentralized identity standards natively. Members are identified by `did:pkh` DIDs (derived from SIWE wallets), external account links (Discord, GitHub) are stored as Verifiable Credentials instead of ad-hoc rows, and proof requests use Presentation Exchange semantics. This preserves existing SIWE auth while enabling future federation — other nodes accept credentials rather than integrate our database schema.

## Roadmap

### Crawl (P0) — DID Foundation

**Goal:** Ship `did:pkh` as canonical identifier with dual-write migration and session integration.

| Deliverable                                                      | Status      | Est | Work Item  |
| ---------------------------------------------------------------- | ----------- | --- | ---------- |
| Research spike: gap analysis + design doc                        | Done        | 2   | spike.0080 |
| DID derivation utility + DB migration + backfill                 | Not Started | 2   | —          |
| SessionUser DID integration (JWT, session types, auth callbacks) | Not Started | 1   | —          |
| Switch internal reads to DID (RBAC actor type, user context)     | Not Started | 2   | —          |

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

### Standards Alignment (DIF/SSI)

The project adopts four DIF primitives without inventing new protocols:

1. **did:pkh** — deterministic DID from wallet chain + address. No registry needed.
2. **Verifiable Credentials (VC data model)** — account links as signed, revocable credential artifacts.
3. **Presentation Exchange (PEX)** — verifier expresses requirements as Presentation Definition; holder responds with Presentation Submission. Transport-agnostic.
4. **DID Registration** — internal port for create/update/deactivate/resolve. Method-agnostic from day one.

### What We Explicitly Defer

- DIDComm — useful for private agent-to-agent comms, not needed for identity standardization
- Trust registry machinery — issuer = "our system" until we actually federate
- On-chain reputation/cred tokens — orthogonal to identity primitives

### Key Design Decisions (Resolved — spike.0080)

- **VC format**: JWT VC via `did-jwt-vc`. Simpler than JSON-LD, W3C-compliant, upgrade path exists.
- **VC signing**: System-issued VCs use ES256K server-side signer (`did:key`). EIP-712 wallet signing deferred to P2+ (user-signed credentials).
- **DID derivation**: Hand-rolled `walletToDid()` utility (string concat). `did-resolver` + `pkh-did-resolver` added at Phase 2.
- **Chain ID**: Read from SIWE message payload — never default to `1`.
- **Migration strategy**: dual-write → switch reads → deprecate legacy (standard 3-phase).
- **Phase 2 scope**: VC tables/endpoints designed when account linking actually ships (proj.messenger-channels), not pre-designed.
