---
id: decentralized-identity
type: spec
title: User Identity + Account Bindings
status: draft
spec_state: draft
trust: draft
summary: Stable user_id (UUID) as canonical identity. Wallet, Discord, and GitHub are evidenced bindings — never the identity itself. "Contributor" is a derived label, not an identity primitive. DID/VC portability deferred to P2.
read_when: Working on identity, auth, account linking, RBAC actor types, user context injection, or ledger attribution
implements: proj.decentralized-identity
owner: derekg1729
created: 2026-02-19
verified: 2026-02-20
tags: [identity, auth, web3]
---

# User Identity + Account Bindings

> Every user gets a stable `user_id` (UUID) at first contact — regardless of auth method. Wallet, Discord, and GitHub identities are evidenced bindings attached to that user, never used as the identity itself. "Contributor" is a derived label (has eligible contribution events), not a separate identity primitive.

### Key References

|              |                                                                                           |                                            |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Project**  | [proj.decentralized-identity](../../work/projects/proj.decentralized-identity.md)         | Roadmap, phases, work items                |
| **Research** | [DID-first identity refactor](../research/did-first-identity-refactor.md)                 | Gap analysis, library eval                 |
| **Spec**     | [Authentication](./authentication.md)                                                     | SIWE flow, wallet-session                  |
| **Spec**     | [RBAC](./rbac.md)                                                                         | Actor types (will drop wallet from format) |
| **Spec**     | [User Context](./user-context.md)                                                         | Agent identity injection                   |
| **Consumer** | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Ledger references user_id                  |

## Design

### Identity Model

```
┌──────────────────────────────────────────────────────┐
│                     users table                       │
│  id: UUID (PK, FK target, canonical identity)        │
│  wallet_address: 0x... (legacy, kept for SIWE)       │
│  name: TEXT (optional display name)                   │
└──────────────┬───────────────────────────────────────┘
               │ 1:N
               ▼
┌──────────────────────────────────────────────────────┐
│               user_bindings table                     │
│  id: UUID (PK)                                        │
│  user_id: UUID (FK → users.id)                        │
│  provider: 'wallet' | 'discord' | 'github'           │
│  external_id: TEXT (UNIQUE — enforces NO_AUTO_MERGE)  │
│  evidence: TEXT (proof reference)                      │
│  created_at: TIMESTAMPTZ                              │
└──────────────────────────────────────────────────────┘
               │ append-only
               ▼
┌──────────────────────────────────────────────────────┐
│              identity_events table                     │
│  id: UUID (PK)                                        │
│  user_id: UUID (FK)                                   │
│  event_type: 'bind' | 'revoke' | 'merge'             │
│  payload: JSONB (provider, external_id, evidence)     │
│  created_at: TIMESTAMPTZ                              │
└──────────────────────────────────────────────────────┘

Examples:
  user_bindings: discord | 123456789012345678 → user <uuid>
  user_bindings: wallet  | 0xabc...           → user <uuid>
  user_bindings: github  | 12345              → user <uuid>
```

**Two identity tiers (P0):**

| Tier           | Purpose                     | Type                   | Stability                                   |
| -------------- | --------------------------- | ---------------------- | ------------------------------------------- |
| **User ID**    | Canonical member identifier | UUID v4 (`users.id`)   | Permanent — minted once at first contact    |
| **Binding(s)** | Auth methods bound to user  | provider + external_id | Append-only, evidenced, revocable via event |

**Why UUID instead of DID at P0?** DID requires crypto dependencies (ed25519, multicodec, base58btc) with zero user-facing value until federation. Ledger correctness needs stable, unique IDs — UUID does this. DID is a portability concern for P2, not an identity correctness concern for P0.

**Why `user_id` not `contributor_id`?** "User" is the stable concept — accounts, billing, sessions, permissions all reference users. "Contributor" is contextual and mutable (a user exists before contributing). Naming the canonical ID `contributor_id` would leak domain assumptions into every table and API.

### Auth Flow (SIWE + User Binding)

```
Wallet Sign (RainbowKit) → SIWE Verify (src/auth.ts)
  → User Lookup by wallet_address
  → IF new user:
      createUser() → users.id (UUID)
      createBinding('wallet', address, siweSignature) → user_bindings INSERT
      emitIdentityEvent('bind', ...) → identity_events INSERT
  → IF existing user:
      createBinding('wallet', address, siweSignature) → UPSERT (idempotent)
  → JWT Session { id, walletAddress }
  → SessionUser { id, walletAddress }
```

### Session Type

```typescript
interface SessionUser {
  id: string; // users.id (UUID) — canonical identity, FK target, all attribution
  walletAddress: string; // 0x... — kept for SIWE wallet-session coherence
}
```

Business logic references `id` (= `user_id`). `walletAddress` is retained for the SIWE wallet-session coherence invariant (authentication spec).

## Goal

Provide a stable, auth-method-agnostic identity for every user. `users.id` works whether the user arrives via wallet, Discord, or any future auth method. Wallet and external accounts are evidenced bindings, not the identity itself. The ledger (proj.transparent-credit-payouts) references `user_id` for all attribution.

## Non-Goals

- Blockchain DID registry (Sidetree, ION, etc.) — P2+ at earliest
- DIDComm messaging — P2+
- Trust registry / multi-issuer federation — P2+
- On-chain reputation tokens
- Credential export / portability — P2+
- Changing the DB primary key approach (UUID stays)
- DID minting at P0 (deferred to P2 as optional alias)
- Separate `contributors` table — "contributor" is a derived label, not a table

## Invariants

| Rule                   | Constraint                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| USER_ID_AT_CREATION    | Every user gets a UUID minted at first contact. No user exists without one.                                                                            |
| CANONICAL_IS_USER_ID   | Business logic identity references use `user_id`, never `wallet_address`, `discord_user_id`, or DID.                                                   |
| BINDINGS_ARE_EVIDENCED | Every binding has explicit proof (SIWE signature, bot challenge, PR link) + audit trail in `identity_events`.                                          |
| NO_AUTO_MERGE          | If a binding's `external_id` is already bound to a different user, the bind attempt fails. Never silently re-point. DB-enforced via UNIQUE constraint. |
| SIWE_UNCHANGED         | SIWE authentication continues working. Binding additions are additive — no existing auth flow breaks.                                                  |
| UUID_STAYS_AS_PK       | `users.id` (UUID) remains the relational PK and FK target.                                                                                             |
| APPEND_ONLY_EVENTS     | `identity_events` rows are append-only. Revocation creates a new event, never deletes rows.                                                            |
| LEDGER_REFERENCES_USER | Receipts, epochs, and payout statements reference `user_id` — never wallet or DID directly.                                                            |

### Schema

**Table:** `users` (existing — no rename needed)

| Column           | Type        | Constraints             | Description                           |
| ---------------- | ----------- | ----------------------- | ------------------------------------- |
| `id`             | TEXT        | PK                      | UUID v4, canonical identity           |
| `wallet_address` | TEXT        | UNIQUE                  | Ethereum address from SIWE (existing) |
| `name`           | TEXT        |                         | Optional display name (existing)      |
| `email`          | TEXT        |                         | Optional (existing)                   |
| `created_at`     | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When user was created                 |

**Table:** `user_bindings` (new)

| Column        | Type        | Constraints                                        | Description                                                       |
| ------------- | ----------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `id`          | TEXT        | PK                                                 | UUID v4                                                           |
| `user_id`     | TEXT        | FK → users.id, NOT NULL                            | User this binding belongs to                                      |
| `provider`    | TEXT        | NOT NULL, CHECK IN ('wallet', 'discord', 'github') | Binding type                                                      |
| `external_id` | TEXT        | UNIQUE, NOT NULL                                   | Provider-specific ID (address, discord snowflake, github user id) |
| `evidence`    | TEXT        |                                                    | Proof reference (SIWE sig hash, challenge token)                  |
| `created_at`  | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                            | When the binding was created                                      |

**Table:** `identity_events` (new, append-only)

| Column       | Type        | Constraints                                    | Description                                     |
| ------------ | ----------- | ---------------------------------------------- | ----------------------------------------------- |
| `id`         | TEXT        | PK                                             | UUID v4                                         |
| `user_id`    | TEXT        | FK → users.id, NOT NULL                        | User affected                                   |
| `event_type` | TEXT        | NOT NULL, CHECK IN ('bind', 'revoke', 'merge') | What happened                                   |
| `payload`    | JSONB       | NOT NULL                                       | Event details (provider, external_id, evidence) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                        | When the event occurred                         |

**Index:** `user_bindings(user_id)` — for lookup by user.

**NO_AUTO_MERGE enforcement:** `user_bindings.external_id` is UNIQUE. Inserting a binding already linked to a different user is a constraint violation at the DB level. No application-level race conditions.

### File Pointers

| File                                       | Purpose                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| `packages/db-schema/src/identity.ts`       | `user_bindings` + `identity_events` table definitions (new)   |
| `packages/db-schema/src/utils/identity.ts` | `createBinding()` utility (new)                               |
| `src/auth.ts`                              | SIWE authorize — bind wallet on login                         |
| `src/shared/auth/session.ts`               | `SessionUser` type (id is already user_id)                    |
| `src/types/next-auth.d.ts`                 | NextAuth type augmentation (no change needed if id = user_id) |
| `src/lib/auth/server.ts`                   | `getServerSessionUser()` (no change needed if id = user_id)   |

## DID Readiness (P2)

The DID research (spike.0080) remains valid — deferred until federation is needed:

- **Subject DID**: `did:key` from ed25519 keypair added as optional `subject_did` column on `users`. Not the PK.
- **Wallet DID**: `did:pkh:eip155:{chainId}:{address}` — deterministic from wallet binding. Added where wallet binding exists.
- **VC format**: JWT VC via `did-jwt-vc`. Bindings become exportable VC-shaped artifacts.
- **PEX**: Presentation Exchange semantics for cross-node verification at federation time.

The `user_id` (UUID) remains the ledger key even after DID arrives. DID is an alias for portability, not a replacement.

## Acceptance Checks

**Automated:**

```bash
pnpm check        # types + lint (SessionUser changes compile)
pnpm test          # unit tests pass (binding tests, auth callback tests)
pnpm check:docs    # docs metadata valid
```

**Manual / Stack Test:**

1. New user SIWE login → `users` row created with UUID (existing behavior)
2. Same login → `user_bindings` row with provider=wallet, external_id=address
3. Second login (same wallet) → no duplicate binding (idempotent)
4. Attempt to bind an external_id already bound to another user → constraint error (NO_AUTO_MERGE)
5. Existing SIWE login/logout/switch flows unbroken
6. `identity_events` has a `bind` event for each new binding

## Open Questions

- [ ] Backfill strategy: migration script to create `user_bindings` rows for existing `users.wallet_address` values? (resolve at PR time)
- [ ] Future: when RBAC actor type migrates from `user:{walletAddress}` to `user:{userId}`, does it happen in this spec or as an RBAC spec update?

## Related

- [Authentication](./authentication.md) — SIWE flow, WALLET_SESSION_COHERENCE invariant
- [RBAC](./rbac.md) — actor type `user:{walletAddress}` will migrate to `user:{userId}`
- [User Context](./user-context.md) — `opaqueId` will derive from user_id
- [Accounts Design](./accounts-design.md) — billing identity references
- [Security Auth](./security-auth.md) — auth surface identity resolution
- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — ledger consumer of user_id
