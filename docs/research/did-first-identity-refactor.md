---
id: did-first-identity-research
type: research
title: "Research: DID-First Identity Refactor"
status: active
trust: draft
summary: Gap analysis of current wallet-based identity system, OSS library evaluation for did:pkh/VCs/PEX, and minimal refactor design to adopt DIF standards.
read_when: Implementing DID-first identity, adding verifiable credentials, or understanding the identity migration plan.
owner: derekg1729
created: 2026-02-17
verified: 2026-02-17
tags: [identity, web3, ssi, research]
---

# Research: DID-First Identity Refactor

> spike: spike.0080 | date: 2026-02-17

## Question

How do we minimally refactor Cogni's wallet-address-based identity system to use `did:pkh` as the canonical identifier and represent account links as Verifiable Credentials, without breaking existing SIWE auth or billing?

## Context

Cogni uses SIWE (Sign-In with Ethereum) as the sole authentication method. Identity flows through three tiers: wallet address (entry point) → user UUID (DB primary key) → billing account UUID (economic entity). There are **zero** existing Discord/GitHub account linking implementations — the only Discord integration is a bot token passed to OpenClaw's gateway. This means the VC-based linking system is entirely greenfield.

---

## Findings: Current Identity Surface (Gap Analysis)

### Identity Flow (As-Built)

```
Wallet Sign (RainbowKit) → SIWE Verify (src/auth.ts)
  → User Lookup/Create by wallet_address (users table)
  → JWT Session { id: UUID, walletAddress: "0x..." }
  → SessionUser { id, walletAddress } (src/shared/auth/session.ts)
  → Billing Account { ownerUserId → users.id } (1:1)
  → RLS-scoped queries via withTenantScope(userActor(userId))
```

### Database Schema

**`users` table** (`packages/db-schema/src/refs.ts`):

- `id: text PK` — UUID v4, generated on first login
- `wallet_address: text UNIQUE` — Ethereum address from SIWE
- `name`, `email`, `image` — optional, unused in identity flows

**FK dependents** (all reference `users.id`):

- `billing_accounts.owner_user_id` — 1:1
- `execution_grants.user_id` — 1:N
- `schedules.owner_user_id` — 1:N
- `ai_threads.user_id` — 1:N

### Identity Touchpoints (Must Change)

| Location                                                  | Current Identity                                              | Change Required                                  |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `src/auth.ts` (L129)                                      | `users.walletAddress` lookup                                  | Add DID derivation post-SIWE                     |
| `src/auth.ts` (L134-142)                                  | User created with `walletAddress`                             | Also store `did`                                 |
| `src/auth.ts` (L165-179)                                  | JWT includes `walletAddress`                                  | Also include `did`                               |
| `src/types/next-auth.d.ts`                                | `Session.user.walletAddress`                                  | Add `did` field                                  |
| `src/shared/auth/session.ts`                              | `SessionUser { id, walletAddress }`                           | Add `did` field                                  |
| `src/lib/auth/server.ts`                                  | Returns `{ id, walletAddress }`                               | Add `did`                                        |
| `src/lib/auth/mapping.ts`                                 | `getOrCreateBillingAccountForUser({ userId, walletAddress })` | Accept `did`                                     |
| `src/app/_facades/ai/completion.server.ts`                | `sessionUser.id` for billing                                  | Use `did` for identity, keep UUID for billing FK |
| `src/app/_facades/ai/activity.server.ts`                  | `sessionUser.id` for billing                                  | Same                                             |
| `src/app/_facades/payments/credits.server.ts`             | `sessionUser.id` + `walletAddress`                            | Same                                             |
| `src/adapters/server/accounts/drizzle.adapter.ts`         | `ownerUserId` FK                                              | Keep (UUID stays as DB PK)                       |
| `packages/db-schema/src/refs.ts`                          | `users` table definition                                      | Add `did` column                                 |
| RBAC spec `docs/spec/rbac.md`                             | Actor type `user:{walletAddress}`                             | Migrate to `user:{did}`                          |
| User context spec `docs/spec/user-context.md`             | `opaqueId` derivation from wallet                             | Derive from DID                                  |
| Messenger channels spec `docs/spec/messenger-channels.md` | `tenant-{billingAccountId}`                                   | No change (billing, not identity)                |

### Discord/GitHub Linking: Greenfield

**No existing code.** The codebase has:

- Discord bot token in OpenClaw gateway config (not user-level linking)
- GitHub RW token for OpenClaw sandbox Git operations (not user-level linking)
- Zero `discord_id`, `github_id`, `linked_account`, or `external_id` fields anywhere
- Zero OAuth providers configured
- Zero member tracking tables

This is good news: the VC-based linking system has no legacy to migrate.

---

## Findings: OSS Library Evaluation

### 1. DID Parsing + Resolution

| Package                  | Version | Last Publish | Weekly DL | Verdict                                                                       |
| ------------------------ | ------- | ------------ | --------- | ----------------------------------------------------------------------------- |
| `did-resolver`           | 4.1.0   | 2023-09      | ~20K      | **Use.** Universal DID resolution framework. Healthy, 30+ contributors.       |
| `pkh-did-resolver`       | 2.0.0   | 2024-10      | Low       | **Use.** Plugs into `did-resolver` for `did:pkh` method. Ceramic team.        |
| `@didtools/pkh-ethereum` | 0.6.0   | 2024-10      | ~9.4K     | Skip. Heavier than needed — designed for Ceramic ecosystem, includes CACAO.   |
| `@spruceid/didkit-wasm`  | 0.2.1   | 2025-05      | Low       | Skip. WASM binary adds bundle size. Pre-1.0. Overkill for did:pkh derivation. |

**Recommendation:** `did-resolver` + `pkh-did-resolver`. DID derivation is a pure string operation (`did:pkh:eip155:1:<address>`), so we only need the resolver for validation/document generation.

### 2. Verifiable Credentials

| Package                  | Approach | Version | Last Publish | Verdict                                                                     |
| ------------------------ | -------- | ------- | ------------ | --------------------------------------------------------------------------- |
| `did-jwt-vc`             | JWT VC   | 4.0.7   | 2024-10      | **Use.** Lightweight, JWT-native, same team as `did-resolver`.              |
| `@veramo/credential-w3c` | Both     | 6.x     | Active       | Skip for v0. Full agent framework — massive dependency tree. Good for P2.   |
| `@digitalbazaar/vc`      | JSON-LD  | 6.x     | Active       | Skip. JSON-LD is heavier and we don't need linked data proofs for v0.       |
| `@sd-jwt/core`           | SD-JWT   | 0.14.0  | 2026-02      | Watch. Selective disclosure is interesting for privacy but adds complexity. |

**Recommendation:** `did-jwt-vc` for v0. JWT VCs are the simplest format that preserves W3C VC data model compliance. JSON-LD can be evaluated at P2 if federation requires it.

**Format decision: JWT VC over JSON-LD VC because:**

- Simpler verification (standard JWT libraries)
- No JSON-LD context resolution (no network dependency for verification)
- `did-jwt-vc` is lightweight with minimal dependencies
- W3C VC data model compliance is maintained
- Can be upgraded to JSON-LD proofs later without changing the data model

### 3. Presentation Exchange

| Package         | Version | Last Publish | Verdict                                                             |
| --------------- | ------- | ------------ | ------------------------------------------------------------------- |
| `@sphereon/pex` | 5.x     | Active       | **Use for reference.** DIF PEX v1+v2. The canonical implementation. |
| `@animo-id/pex` | 6.1.1   | 2025-06      | Alternative fork by Animo. More recent but niche.                   |

**Recommendation:** For v0, implement PEX semantics as lightweight internal types (Presentation Definition / Submission shapes) rather than pulling the full `@sphereon/pex` library. The library is useful when you need full PEX validation, but for internal-only verification (single issuer, known credential types), hand-rolled types suffice. Adopt `@sphereon/pex` at P1 when credential types diversify.

### 4. Signature Scheme

**EIP-712 over EIP-191 because:**

- EIP-712 provides structured, typed data signing — the signer sees human-readable field names, not opaque hashes
- `viem` (already in our dependency tree via Wagmi/RainbowKit) has first-class `signTypedData` support
- W3C CCG has an `ethereum-eip712-signature-2021-spec` aligning EIP-712 with VC proofs
- EIP-191 is simpler but produces opaque "personal_sign" messages — worse UX for credential signing
- SIWE already uses EIP-191 for login; EIP-712 for VCs gives clear semantic separation

**Recommendation:** EIP-712 via `viem.signTypedData()` for credential signing. Already in our dependency tree.

### 5. What's Missing (Build Behind Ports)

| Capability                  | OSS Status                                      | Our Approach                                         |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `did:pkh` string derivation | Trivial (string concat)                         | Utility function behind DID port                     |
| VC issuance (system-signed) | `did-jwt-vc` covers it                          | Thin wrapper                                         |
| VC revocation (status list) | `@transmute/vc-status-rl-2021` exists but heavy | Simple DB status column for v0, StatusList2021 at P2 |
| PEX validation              | `@sphereon/pex` exists                          | Internal types for v0, library at P1                 |
| Identity event ledger       | Nothing specific                                | Append-only DB table                                 |

---

## Recommendation

### Minimal Stack for v0

```
DID parsing:        did-resolver + pkh-did-resolver
VC issuance:        did-jwt-vc (JWT VC format)
VC signing:         viem signTypedData (EIP-712) — already in deps
PEX semantics:      Internal types (no library for v0)
Revocation:         DB status column (upgrade to StatusList2021 at P2)
```

### Key Architectural Decision: UUID Stays as DB Primary Key

The `users.id` UUID should **remain as the database primary key**. The DID becomes the **canonical identity for business logic and external interfaces**, while UUIDs stay as internal FK references. This avoids a massive FK migration and keeps RLS working.

```
External identity:  did:pkh:eip155:1:0xabc...  (canonical, deterministic)
Internal DB key:    users.id (UUID)              (FK target, stays)
Lookup bridge:      users.did column (UNIQUE)    (new, indexed)
```

### Migration Strategy

**Phase 0 — Dual Write (1 PR)**

1. Add `did TEXT UNIQUE` column to `users` table
2. Add DID derivation utility: `walletToDid(chainId, address) → did:pkh:eip155:{chainId}:{address}`
3. Populate DID on SIWE login (new users get it at creation, existing users on next login)
4. Backfill migration: deterministically populate `did` for all existing users
5. Add `did` to `SessionUser` type, JWT token, and session callbacks
6. No read path changes yet

**Phase 1 — Switch Reads (1-2 PRs)**

1. All business logic identity references use `did` instead of `walletAddress`
2. RBAC actor type becomes `user:{did}` instead of `user:{walletAddress}`
3. User context `opaqueId` derived from DID
4. `walletAddress` still stored but treated as a "proof method", not identity

**Phase 2 — Verifiable Credentials (2-3 PRs)**

1. New tables: `credentials`, `credential_status`, `identity_events`
2. VC issuance endpoints for Discord/GitHub linking
3. PEX verification interface
4. Revocation flow

### Data Model (Target)

```sql
-- Phase 0: add to existing users table
ALTER TABLE users ADD COLUMN did TEXT UNIQUE;
CREATE INDEX users_did_idx ON users(did);

-- Phase 2: new tables
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,                    -- UUID
  subject_did TEXT NOT NULL,              -- did:pkh:... (FK via users.did)
  type TEXT NOT NULL,                     -- 'DiscordAccountLink', 'GitHubAccountLink'
  issuer_did TEXT NOT NULL,               -- system issuer DID
  credential_jwt TEXT NOT NULL,           -- signed JWT VC
  evidence_ref TEXT,                      -- proof reference (gist URL, bot challenge ID)
  proof_method TEXT NOT NULL,             -- 'discord_bot_challenge', 'github_gist'
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'revoked'
  idempotency_key TEXT UNIQUE NOT NULL,   -- prevents duplicate credentials
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE identity_events (
  id TEXT PRIMARY KEY,                    -- UUID
  subject_did TEXT NOT NULL,
  event_type TEXT NOT NULL,               -- 'did_created', 'credential_issued', 'credential_revoked'
  credential_id TEXT,                     -- FK to credentials.id (if applicable)
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### API Contracts (Phase 2)

```
GET  /api/v1/identity/did          → { did, walletAddress, credentials[] }
POST /api/v1/identity/link/discord → { credentialId, jwt }  (idempotent)
POST /api/v1/identity/link/github  → { credentialId, jwt }  (idempotent)
POST /api/v1/identity/present      → { verified: bool, submission }  (PEX)
POST /api/v1/identity/revoke       → { credentialId, revokedAt }
```

All endpoints derive identity from SIWE session (no arbitrary DID acceptance from client).

### Invariants Checklist

| Invariant                    | Met? | Notes                                                            |
| ---------------------------- | ---- | ---------------------------------------------------------------- |
| **I-CANONICAL-DID**          | Yes  | `users.did` becomes canonical; business logic references DID     |
| **I-DETERMINISTIC**          | Yes  | `did:pkh:eip155:{chainId}:{address}` is a pure function          |
| **I-CLAIMS-ARE-CREDENTIALS** | Yes  | JWT VCs via `did-jwt-vc`, stored in `credentials` table          |
| **I-APPEND-ONLY-EVENTS**     | Yes  | `identity_events` table, insert-only                             |
| **I-IDEMPOTENT-LINKING**     | Yes  | `idempotency_key` UNIQUE constraint on `credentials`             |
| **I-REVOCATION-EXISTS**      | Yes  | `status` column + `revoked_at`, history preserved                |
| **I-PEX-VERIFICATION**       | Yes  | Internal PEX types for v0; `@sphereon/pex` at P1                 |
| **I-METHOD-AGILITY**         | Yes  | DID ops behind `DidRegistrationPort`; only `did:pkh` for v0      |
| **I-PRIVACY-DEFAULT**        | Yes  | External IDs in `credentials.evidence_ref`, not exposed publicly |

### Risks

| Risk                                        | Mitigation                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| JWT VC format limits future JSON-LD interop | `did-jwt-vc` produces W3C-compliant VCs; format upgrade path exists                     |
| EIP-712 signature replay                    | Include nonce + domain separation in typed data (same pattern as SIWE)                  |
| Discord usernames change                    | Use immutable numeric Discord user ID, never username                                   |
| GitHub gist proof can be deleted            | Store evidence snapshot at issuance time; gist is proof method, not ongoing requirement |
| Backfill assumes chain ID 1 (mainnet)       | Correct for current SIWE config; make chain ID configurable in DID derivation function  |
| Large FK migration if UUID→DID              | Avoided: UUID stays as DB PK, DID is a new indexed column                               |

---

## Open Questions

1. **Chain ID handling**: Current SIWE config appears mainnet-only. Should DID derivation default to `eip155:1` or read from SIWE message? (Likely: read from SIWE for correctness.)
2. **System issuer DID**: What DID method for the system issuer? `did:web:cogni.dev`? `did:key` from a server-side keypair? (Likely: `did:key` for simplicity, `did:web` at P2.)
3. **Discord linking proof flow**: What specific bot challenge mechanism? DM-based code? Server role check? (Needs design when Discord integration matures.)
4. **Credential export format**: Should users be able to download their VCs as files? (Defer to P2.)

---

## Proposed Layout

### Project

Already exists: `proj.decentralized-identity`

### Specs to Write/Update

| Spec                                  | Action                                                           | When           |
| ------------------------------------- | ---------------------------------------------------------------- | -------------- |
| `docs/spec/decentralized-identity.md` | **Create** — DID port, VC data model, PEX types, identity events | Before Phase 1 |
| `docs/spec/authentication.md`         | **Update** — `SIWE_CANONICAL_IDENTITY` evolves to include DID    | Phase 1        |
| `docs/spec/rbac.md`                   | **Update** — actor type `user:{did}`                             | Phase 1        |
| `docs/spec/user-context.md`           | **Update** — `opaqueId` from DID                                 | Phase 1        |
| `docs/spec/accounts-design.md`        | **Update** — identity model section                              | Phase 1        |

### Likely Tasks (rough sequence)

1. **task: DID derivation utility + DB migration** (Phase 0) — add `did` column, backfill, dual-write. Est: 2
2. **task: SessionUser DID integration** (Phase 0) — JWT, session types, auth callbacks. Est: 1
3. **task: Switch identity reads to DID** (Phase 1) — business logic, RBAC actor type, user context. Est: 2
4. **task: VC data model + credentials table** (Phase 2) — schema, `did-jwt-vc` integration, issuance port. Est: 2
5. **task: Discord/GitHub linking endpoints** (Phase 2) — API routes, proof flows, idempotency. Est: 3
6. **task: PEX verification interface** (Phase 2) — internal types, `/identity/present` endpoint. Est: 2
7. **task: Identity event ledger** (Phase 2) — append-only table, event emission from all identity ops. Est: 1
