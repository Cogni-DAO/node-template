---
id: task.0089
type: task
title: "User bindings + identity events — schema, binding flows, backfill"
status: needs_implement
priority: 1
estimate: 2
summary: Add user_bindings table for wallet/Discord/GitHub account linking, add identity_events append-only audit trail, backfill existing wallet_address rows into user_bindings.
outcome: Every user has evidenced bindings for external accounts; wallet_address backfilled into user_bindings; identity_events captures all bind/revoke/merge actions; existing SIWE auth unchanged.
spec_refs:
  - decentralized-identity
  - authentication-spec
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch: feat/user-identity-bindings
pr:
reviewer:
created: 2026-02-18
updated: 2026-02-20
labels: [identity, auth]
external_refs:
revision: 2
blocked_by:
deploy_verified: false
rank: 25
---

# User Bindings + Identity Events — Schema, Binding Flows, Backfill

## Problem

Cogni identifies users by wallet address strings. Discord-first and GitHub-first users can't be attributed without a wallet. The fix: `users.id` (UUID) is the canonical identity, and wallet/Discord/GitHub are evidenced bindings in a `user_bindings` table with an append-only `identity_events` audit trail. No DID at this phase — DID is a P2 portability concern.

## Design

### Outcome

External accounts (wallet, Discord, GitHub) are linked to users via `user_bindings` with proof evidence. All state transitions are captured in `identity_events`. Existing wallet users are backfilled. No `SessionUser` changes needed — `id` is already `user_id`.

### Approach

**Solution**: Two new tables + wallet backfill + binding utility:

1. `user_bindings` table — provider + external_id + evidence, UNIQUE on external_id
2. `identity_events` table — append-only audit trail (bind, revoke, merge)
3. Backfill migration: existing `users.wallet_address` → `user_bindings` rows
4. `createBinding()` utility for use in auth and future Discord/GitHub flows

**Reuses**:

- Existing SIWE `authorize()` flow in `src/auth.ts`
- Existing drizzle migration pipeline (`packages/db-schema`)
- Existing `SessionUser` type — no changes needed (`{ id, walletAddress }` is correct)
- Existing `users` table — no column changes needed

**Rejected**:

- Separate `contributors` table — "contributor" is a derived label, not an identity primitive
- `subject_did` column at P0 — DID deferred to P2 when federation is needed
- `did:key` / `did:pkh` derivation — no crypto dependencies needed for account linking
- Changing `SessionUser` — `id` is already `user_id`, which is the canonical identity

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] USER_ID_AT_CREATION: `users.id` (UUID) is the canonical identity — never wallet, Discord, or DID (spec: decentralized-identity)
- [ ] BINDINGS_ARE_EVIDENCED: Every binding has explicit proof (SIWE sig, bot challenge, PR link) + audit trail in `identity_events` (spec: decentralized-identity)
- [ ] NO_AUTO_MERGE: `user_bindings.external_id` is UNIQUE — inserting an external_id already linked to another user fails, never silently re-points (spec: decentralized-identity)
- [ ] APPEND_ONLY_EVENTS: `identity_events` rows are append-only; revocation creates a new event, never deletes (spec: decentralized-identity)
- [ ] SIWE_UNCHANGED: Existing SIWE login flow continues working — bindings are additive (spec: authentication-spec)
- [ ] LEDGER_REFERENCES_USER: Receipts and epochs reference `user_id`, never wallet or DID (spec: decentralized-identity)
- [ ] SIMPLE_SOLUTION: Two tables, one utility, one backfill migration. No crypto deps, no DID, no new session fields.

### Files

- Create: `packages/db-schema/src/identity.ts` — `userBindings` + `identityEvents` table schemas
- Create: migration SQL — `CREATE TABLE user_bindings ...`, `CREATE TABLE identity_events ...`, backfill wallet rows
- Create: `packages/db-schema/src/utils/identity.ts` — `createBinding()` utility
- Modify: `src/auth.ts` — on SIWE login, also insert wallet binding + identity event
- Modify: `src/shared/db/schema.ts` — re-export identity slice
- Test: `packages/db-schema/src/utils/identity.test.ts` — binding utility tests
- Test: auth callback binding creation test

## Implementation Notes

### Schema

```sql
-- user_bindings table
CREATE TABLE user_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('wallet', 'discord', 'github')),
  external_id TEXT UNIQUE NOT NULL,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_bindings_user_id_idx ON user_bindings(user_id);

-- identity_events table (append-only)
CREATE TABLE identity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('bind', 'revoke', 'merge')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX identity_events_user_id_idx ON identity_events(user_id);
```

**NO_AUTO_MERGE enforcement**: `user_bindings.external_id` is UNIQUE — inserting an external_id already linked to a different user is a constraint violation at the DB level. No application-level race conditions.

### Backfill migration

```sql
-- Backfill existing wallet users into user_bindings
INSERT INTO user_bindings (id, user_id, provider, external_id, evidence, created_at)
SELECT
  gen_random_uuid()::text,
  id,
  'wallet',
  wallet_address,
  'backfill:v0-migration',
  NOW()
FROM users
WHERE wallet_address IS NOT NULL
ON CONFLICT (external_id) DO NOTHING;
```

Small user base — runs in seconds. After backfill, both `users.wallet_address` and `user_bindings` contain the wallet reference. `users.wallet_address` is kept for SIWE session coherence; `user_bindings` is the normalized binding table for multi-provider lookups.

### Auth flow changes (src/auth.ts)

In `authorize()`, after SIWE verification succeeds:

1. On **new user creation**:
   - Create user → `users.id` (existing behavior)
   - `createBinding('wallet', address, 'siwe')` → `user_bindings` INSERT
   - Emit `identity_event('bind', ...)` → `identity_events` INSERT
2. On **existing user login**:
   - Ensure wallet binding exists → UPSERT (idempotent — if already linked, no-op)

No session type changes — `SessionUser { id, walletAddress }` is already correct.

### Discord + GitHub binding flows (future — not this task)

Discord and GitHub binding flows are P0 deliverables but tracked separately from this schema task. This task provides the tables and utility; binding UX is a follow-up.

## Validation

```bash
pnpm check        # type + lint
pnpm test          # unit tests pass
pnpm check:docs    # docs validation
```

- `createBinding()` correctly inserts binding + emits identity event
- Backfill migration creates `user_bindings` rows for existing wallet users
- Inserting an external_id already linked to another user fails (NO_AUTO_MERGE)
- SIWE login creates wallet binding idempotently
- Existing tests still pass (backward compat)

## Review Checklist

- [ ] **Work Item:** `task.0089` linked in PR body
- [ ] **Spec:** USER_ID_AT_CREATION, BINDINGS_ARE_EVIDENCED, NO_AUTO_MERGE upheld
- [ ] **Tests:** Binding utility tests + auth binding creation test
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent story: story.0079
- Spec: docs/spec/decentralized-identity.md
- Project: work/projects/proj.decentralized-identity.md

## Attribution

-
