---
id: decentralized-identity
type: spec
title: Decentralized Identity
status: draft
spec_state: draft
trust: draft
summary: Subject DID (did:key) as canonical member identity, with linked DIDs (did:pkh for wallets) and VC-shaped account links. Auth-method-agnostic from day one.
read_when: Working on identity, auth, account linking, RBAC actor types, or user context injection
implements: proj.decentralized-identity
owner: derekg1729
created: 2026-02-19
verified: 2026-02-19
tags: [identity, auth, web3, ssi]
---

# Decentralized Identity

> Every member gets a stable subject DID (`did:key`) at first contact — regardless of auth method. Wallet, Discord, and GitHub identities are linked to that subject, never used as the subject itself.

### Key References

|              |                                                                                   |                               |
| ------------ | --------------------------------------------------------------------------------- | ----------------------------- |
| **Project**  | [proj.decentralized-identity](../../work/projects/proj.decentralized-identity.md) | Roadmap, phases, work items   |
| **Research** | [DID-first identity refactor](../research/did-first-identity-refactor.md)         | Gap analysis, library eval    |
| **Spec**     | [Authentication](./authentication.md)                                             | SIWE flow, wallet-session     |
| **Spec**     | [RBAC](./rbac.md)                                                                 | Actor types (will adopt DIDs) |
| **Spec**     | [User Context](./user-context.md)                                                 | Agent identity injection      |

## Design

### Identity Model

```
┌──────────────────────────────────────────────────────┐
│                    users table                        │
│  id: UUID (PK, FK target)                            │
│  subject_did: did:key:z... (UNIQUE, canonical ID)    │
│  wallet_address: 0x... (legacy, kept for SIWE)       │
└──────────────┬───────────────────────────────────────┘
               │ 1:N
               ▼
┌──────────────────────────────────────────────────────┐
│                   user_dids table                     │
│  did: TEXT (PK) ← UNIQUE enforces I-NO-AUTO-MERGE    │
│  user_id: UUID (FK → users.id)                       │
│  kind: 'wallet' | 'alias'                            │
│  created_at: TIMESTAMPTZ                             │
└──────────────────────────────────────────────────────┘

Examples:
  user_dids: did:pkh:eip155:1:0xabc...  → user_id: <uuid> (kind: wallet)
  user_dids: did:pkh:eip155:1:0xdef...  → user_id: <uuid> (kind: wallet)
```

**Three identity tiers:**

| Tier              | Purpose                       | Type                                 | Stability                                 |
| ----------------- | ----------------------------- | ------------------------------------ | ----------------------------------------- |
| **Subject DID**   | Canonical member identifier   | `did:key:z...` (ed25519)             | Permanent — minted once at first contact  |
| **Linked DID(s)** | Auth methods bound to subject | `did:pkh:eip155:{chainId}:{address}` | One per wallet, append-only               |
| **DB UUID**       | Relational FK target          | `users.id` (UUID v4)                 | Internal only — never exposed as identity |

**Why not `did:pkh` as subject?** A user can exist without a wallet (Discord-first, GitHub-first). `did:pkh` requires a wallet address + chain ID. Making it the subject creates a dead-end for non-wallet auth methods.

### Auth Flow (SIWE + DID)

```
Wallet Sign (RainbowKit) → SIWE Verify (src/auth.ts)
  → User Lookup by wallet_address
  → IF new user:
      mintSubjectDid() → users.subject_did
      walletToDid(chainId, address) → user_dids INSERT
  → IF existing user:
      walletToDid(chainId, address) → user_dids UPSERT (idempotent)
  → JWT Session { id, subjectDid, walletAddress }
  → SessionUser { id, subjectDid, walletAddress }
```

### DID Derivation

**Subject DID** (`did:key`): Generated from a random ed25519 keypair at user creation. The public key is multicodec-encoded (prefix `0xed01`) and multibase-encoded (base58btc). Called once per user lifetime.

**Wallet DID** (`did:pkh`): Pure string concatenation from SIWE message fields. Deterministic — same wallet always produces the same DID.

```
did:pkh:eip155:{chainId}:{address}
```

`chainId` is read from `SiweMessage.chainId` — never hardcoded.

### Session Type

```typescript
interface SessionUser {
  id: string; // DB UUID — FK target, internal
  subjectDid: string; // did:key:z... — canonical identity
  walletAddress: string; // 0x... — kept for SIWE wallet-session coherence
}
```

Business logic references `subjectDid`. DB queries use `id`. `walletAddress` is retained for the SIWE wallet-session coherence invariant (authentication spec).

## Goal

Provide a stable, auth-method-agnostic identity for every member. The subject DID works whether the user arrives via wallet, Discord, or any future auth method. Wallet and external accounts are linked identifiers, not the identity itself.

## Non-Goals

- Blockchain DID registry (Sidetree, ION, etc.)
- DIDComm messaging
- Trust registry / multi-issuer federation (P2+)
- On-chain reputation tokens
- Credential export / portability (P2+)
- Changing the DB primary key from UUID to DID

## Invariants

| Rule                              | Constraint                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUBJECT_DID_AT_CREATION           | Every user gets a `did:key` subject DID minted at first contact. No user exists without one.                                                            |
| CANONICAL_IDENTITY_IS_SUBJECT_DID | Business logic identity references use `subject_did`, never `wallet_address` or `did:pkh`.                                                              |
| DID_PKH_IS_DETERMINISTIC          | `walletToDid(chainId, address)` is a pure function of chain + address. No external calls.                                                               |
| NO_AUTO_MERGE                     | If a linked DID is already bound to a different subject, the link attempt fails. Never silently re-point. DB-enforced via UNIQUE PK on `user_dids.did`. |
| CHAINID_FROM_SIWE                 | `chainId` is read from the SIWE message payload. Never hardcoded to `1` or any default.                                                                 |
| SIWE_UNCHANGED                    | SIWE authentication continues working. DID additions are additive — no existing auth flow breaks.                                                       |
| UUID_STAYS_AS_PK                  | `users.id` (UUID) remains the relational PK and FK target. Subject DID is a UNIQUE column, not the PK.                                                  |
| APPEND_ONLY_LINKS                 | `user_dids` rows are append-only. Revocation (future) marks status, never deletes rows.                                                                 |

### Schema

**Table:** `users` (modified — add column)

| Column           | Type | Constraints      | Description                           |
| ---------------- | ---- | ---------------- | ------------------------------------- |
| `id`             | TEXT | PK               | UUID v4, existing                     |
| `subject_did`    | TEXT | UNIQUE, NOT NULL | `did:key:z...` — canonical identity   |
| `wallet_address` | TEXT | UNIQUE           | Ethereum address from SIWE (existing) |
| `name`           | TEXT |                  | Optional display name (existing)      |
| `email`          | TEXT |                  | Optional (existing)                   |

**Table:** `user_dids` (new)

| Column       | Type        | Constraints                            | Description                                        |
| ------------ | ----------- | -------------------------------------- | -------------------------------------------------- |
| `did`        | TEXT        | PK                                     | Linked DID string (e.g., `did:pkh:eip155:1:0x...`) |
| `user_id`    | TEXT        | FK → users.id, NOT NULL                | Subject this DID is linked to                      |
| `kind`       | TEXT        | NOT NULL, CHECK IN ('wallet', 'alias') | Link type                                          |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                | When the link was created                          |

**Index:** `user_dids(user_id, did)` — unique, for lookup by user.

**NO_AUTO_MERGE enforcement:** `user_dids.did` is the PK. Inserting a DID already linked to a different user is a constraint violation at the DB level. No application-level race conditions.

### File Pointers

| File                                  | Purpose                                                   |
| ------------------------------------- | --------------------------------------------------------- |
| `packages/db-schema/src/refs.ts`      | `users` table — add `subject_did` column                  |
| `packages/db-schema/src/identity.ts`  | `user_dids` table definition (new)                        |
| `packages/db-schema/src/utils/did.ts` | `mintSubjectDid()` + `walletToDid()` pure utilities (new) |
| `src/auth.ts`                         | SIWE authorize — mint subject DID, link wallet DID        |
| `src/shared/auth/session.ts`          | `SessionUser` type — add `subjectDid`                     |
| `src/types/next-auth.d.ts`            | NextAuth type augmentation — add `subjectDid`             |
| `src/lib/auth/server.ts`              | `getServerSessionUser()` — include `subjectDid`           |

## Acceptance Checks

**Automated:**

```bash
pnpm check        # types + lint (SessionUser changes compile)
pnpm test          # unit tests pass (DID utility tests, auth callback tests)
pnpm check:docs    # docs metadata valid
```

**Manual / Stack Test:**

1. New user SIWE login → `users.subject_did` populated with `did:key:z...`
2. Same login → `user_dids` row with `did:pkh:eip155:{chainId}:{address}` linked to user
3. Second login (same wallet) → no duplicate `user_dids` row (idempotent)
4. Attempt to link a DID already bound to another user → constraint error (NO_AUTO_MERGE)
5. `SessionUser` includes `subjectDid` after login
6. Existing SIWE login/logout/switch flows unbroken

## Open Questions

- [ ] `multiformats` dependency for base58btc encoding, or inline ~20 lines of base58btc? (implementation detail — resolve at PR time)
- [ ] Backfill strategy: migration script (atomic) vs login-time (lazy)? Task.0089 recommends migration script.
- [ ] Future: when RBAC actor type migrates from `user:{walletAddress}` to `user:{subjectDid}`, does it happen in this spec or as an RBAC spec update?

## Related

- [Authentication](./authentication.md) — SIWE flow, WALLET_SESSION_COHERENCE invariant
- [RBAC](./rbac.md) — actor type `user:{walletAddress}` will migrate to `user:{subjectDid}`
- [User Context](./user-context.md) — `opaqueId` will derive from subject DID
- [Accounts Design](./accounts-design.md) — billing identity references
- [Security Auth](./security-auth.md) — auth surface identity resolution
