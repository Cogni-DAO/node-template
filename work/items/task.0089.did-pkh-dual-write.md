---
id: task.0089
type: task
title: "Subject DID + linked DIDs — schema, derivation, session integration"
status: needs_implement
priority: 1
estimate: 2
summary: Add subject_did (did:key) to users table, add user_dids table for linked DIDs, derive did:pkh from SIWE and link it, thread subject_did through JWT/session types.
outcome: Every user has a stable subject DID (did:key) minted at creation; wallet did:pkh stored as linked DID; SessionUser includes subjectDid; existing SIWE auth unchanged.
spec_refs:
  - decentralized-identity
  - authentication-spec
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch: feat/subject-did-foundation
pr:
reviewer:
created: 2026-02-18
updated: 2026-02-19
labels: [identity, web3, ssi]
external_refs:
revision: 1
blocked_by:
deploy_verified: false
rank: 25
---

# Subject DID + Linked DIDs — Schema, Derivation, Session Integration

## Problem

Cogni identifies users by wallet address strings. The original P0 design made `did:pkh` the canonical identity — but that's a dead-end because Discord-first users won't have a wallet. The clean fix: every member gets a stable subject DID (`did:key`) at first contact, and wallet `did:pkh` is a _linked_ identifier, not the subject itself.

## Design

### Outcome

Every user has a stable `did:key` subject DID regardless of how they first authenticated. Wallet login adds `did:pkh` as a linked DID. The subject DID is available on `SessionUser` for all downstream code. No existing behavior changes.

### Approach

**Solution**: Two schema changes + minimal auth/session wiring:

1. `users.subject_did TEXT UNIQUE NOT NULL` — `did:key` minted at user creation
2. `user_dids` table — linked DIDs (`did:pkh:eip155:{chainId}:{address}` for wallets)
3. Thread `subjectDid` through JWT/session types

**Reuses**:

- Existing SIWE `authorize()` flow in `src/auth.ts` — `SiweMessage.chainId` is a required field
- Existing drizzle migration pipeline (`packages/db-schema`)
- Existing `SessionUser` type and JWT callback pattern
- `@noble/ed25519` or Node `crypto.generateKeyPairSync('ed25519')` for `did:key` generation (zero new deps if using Node crypto)

**Rejected**:

- `did:pkh` as canonical identity — breaks on Discord-first users (no wallet = no DID)
- `@didtools/pkh-ethereum` or `@spruceid/didkit-wasm` — overkill for string concat
- Separate identity service/port — premature; this is a column + table + utility
- Changing DB PK to DID — massive FK migration for no benefit; UUID stays as PK

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] I_SUBJECT_DID: Every user has a `did:key` subject DID minted at creation (spec: story.0079)
- [ ] I_CANONICAL_DID: `users.subject_did` is the canonical identity — never wallet address or `did:pkh` (spec: story.0079)
- [ ] I_DETERMINISTIC: `walletToDid(chainId, address)` is a pure function for `did:pkh` derivation (spec: story.0079)
- [ ] I_NO_AUTO_MERGE: `user_dids.did` is UNIQUE — inserting a DID already linked to another user fails, never silently re-points (spec: story.0079)
- [ ] SIWE_UNCHANGED: Existing SIWE login flow continues working — DID additions are additive (spec: authentication-spec)
- [ ] CHAINID_FROM_SIWE: chainId read from `SiweMessage.chainId`, never hardcoded
- [ ] SIMPLE_SOLUTION: Node crypto for `did:key`, string concat for `did:pkh`, two tables, minimal session wiring
- [ ] ARCHITECTURE_ALIGNMENT: Migration in db-schema package, utilities are pure functions, auth changes in `src/auth.ts`

### Files

- Create: `packages/db-schema/src/identity.ts` — `userDids` table schema
- Create: `packages/db-schema/src/utils/did.ts` — `mintSubjectDid()` + `walletToDid()` pure utilities
- Modify: `packages/db-schema/src/refs.ts` — add `subjectDid: text("subject_did").unique().notNull()` to `users`
- Create: migration SQL — `ALTER TABLE users ADD COLUMN subject_did ...`, `CREATE TABLE user_dids ...`
- Modify: `src/auth.ts` — mint subject DID on user creation, derive+link `did:pkh` on SIWE login
- Modify: `src/shared/auth/session.ts` — add `subjectDid: string` to `SessionUser`
- Modify: `src/types/next-auth.d.ts` — add `subjectDid` to Session.user, User, JWT
- Modify: `src/lib/auth/server.ts` — include `subjectDid` in returned `SessionUser`
- Modify: `src/shared/db/schema.ts` — re-export identity slice
- Test: `packages/db-schema/src/utils/did.test.ts` — pure function tests
- Test: auth callback DID minting + linking test

## Implementation Notes

### Schema

```sql
-- users table: add subject DID
ALTER TABLE users ADD COLUMN subject_did TEXT UNIQUE NOT NULL;
CREATE INDEX users_subject_did_idx ON users(subject_did);

-- linked DIDs table
CREATE TABLE user_dids (
  did TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('wallet', 'alias')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX user_dids_user_did_idx ON user_dids(user_id, did);
```

**I-NO-AUTO-MERGE enforcement**: `user_dids.did` is the PK — inserting a DID already linked to a different user is a unique constraint violation at the DB level. No application-level race conditions possible.

### DID utilities

```typescript
import { generateKeyPairSync } from "node:crypto";
import { base58btc } from "multiformats/bases/base58";

/** Mint a new did:key subject DID (ed25519). Called once per user at creation. */
export function mintSubjectDid(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" });
  // ed25519-pub multicodec prefix: 0xed01
  const multicodec = Buffer.concat([
    Buffer.from([0xed, 0x01]),
    raw.subarray(-32),
  ]);
  return `did:key:${base58btc.encode(multicodec)}`;
}

/** Derive did:pkh from wallet chain + address. Pure string concat. */
export function walletToDid(chainId: number, address: string): string {
  return `did:pkh:eip155:${chainId}:${address}`;
}
```

**Dependency note**: `multiformats` is already in the npm ecosystem (used by IPFS/libp2p). If we want zero deps, we can inline base58btc encoding — it's ~20 lines. Decision at implementation time.

### Auth flow changes (src/auth.ts)

In `authorize()`, after SIWE verification succeeds:

1. On **new user creation**:
   - `mintSubjectDid()` → store in `users.subject_did`
   - `walletToDid(fields.chainId, fields.address)` → insert into `user_dids`
2. On **existing user login**:
   - Read `user.subjectDid` (already populated)
   - Derive `did:pkh` → upsert into `user_dids` (idempotent — if already linked, no-op)
3. Return `subjectDid` alongside `id` and `walletAddress`

### Session/JWT changes

Thread `subjectDid` through the existing callback chain:

- `jwt` callback: `token.subjectDid = user.subjectDid`
- `session` callback: `session.user.subjectDid = token.subjectDid`
- `getServerSessionUser()`: include `subjectDid` in returned object
- `SessionUser`: `subjectDid: string` (required — all users have it after migration)

### Backfill for existing users

Existing wallet-only users need subject DIDs. Two options:

1. **Login-time backfill** (simpler): On login, if `user.subjectDid` is null, mint one and save. Requires column to be nullable initially, then `ALTER ... SET NOT NULL` after all users have logged in.
2. **Migration script** (cleaner): Deterministic backfill in the migration — mint a `did:key` for each existing user, also insert their `did:pkh` into `user_dids`.

Recommend option 2: the migration script handles it atomically. Since this is a small user base, it runs in seconds.

## Validation

```bash
pnpm check        # type + lint
pnpm test          # unit tests pass
pnpm check:docs    # docs validation
```

- `mintSubjectDid()` produces valid `did:key:z...` strings
- `walletToDid()` produces correct `did:pkh` for known inputs
- New user creation: subject DID minted + `did:pkh` linked
- Existing user login: `did:pkh` linked idempotently
- Inserting a DID already linked to another user fails (I-NO-AUTO-MERGE)
- `SessionUser.subjectDid` populated after login
- Existing tests still pass (backward compat)

## Review Checklist

- [ ] **Work Item:** `task.0089` linked in PR body
- [ ] **Spec:** I_SUBJECT_DID, I_CANONICAL_DID, I_NO_AUTO_MERGE upheld
- [ ] **Tests:** DID utility unit tests + auth DID minting/linking test
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent story: story.0079
- Research: docs/research/did-first-identity-refactor.md

## Attribution

-
