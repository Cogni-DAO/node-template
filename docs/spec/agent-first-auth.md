---
id: agent-first-auth-spec
type: spec
title: "Agent-First Authentication & Identity"
status: draft
spec_state: proposed
trust: draft
summary: "Design for making the agent the first-class principal on /api/v1/*. Covers the minimal-path decorator hardening (what PR #845 already shipped vs. what's left), the agent-first register redesign (platform-generated actorId + agent-held keypair + short-lived proof-bound tokens), and the migration from the current HMAC bearer stopgap."
read_when: "Designing or reviewing anything that touches /api/v1/agent/*, /api/v1/chat/completions, machine-agent registration, or the wrapRouteHandlerWithLogging auth parameter."
owner: derekg1729
created: 2026-04-14
tags: [auth, identity, agent-first, security]
---

# Agent-First Authentication & Identity

## Goal

Make the agent the first-class principal on every authenticated `/api/v1/*` route. Registration is an agent self-service seam (not a human-owned factory), identity is anchored in an agent-held cryptographic credential (not a shared static bearer), and the blast radius of an unauthenticated onboarding endpoint is bounded by per-actor quotas rather than gatekeeping the door.

## Non-Goals

- Full OIDC / device-code flow for agent onboarding. Defer until >1 external agent operator exists.
- Migration to a third-party workload-identity plane (SPIFFE/SPIRE). Track as a later option, not v0.
- A2A / CB4A / CAAM interop. These are drafts, not settled practice — we shape our internal model to be compatible but do not adopt the wire formats yet.
- Multi-node de-duplication of `request-identity.ts` / `session.ts` modules across `nodes/*`. Orthogonal cleanup.
- Replacing the in-house HMAC codec with `jose` JWTs. Only if the proof-of-possession step below requires it.

## Core Invariants

1. **ACTOR_IS_PRINCIPAL** — `actorId` is the stable, canonical principal identifier across all authenticated routes. Every authenticated request resolves to an `AuthPrincipal` whose `actorId` is non-null. Humans and agents are distinguished by `principalType`, not by two parallel ID fields in business logic.
2. **ACTOR_ID_IS_PUBLIC** — The `actorId` returned by register is a public identifier, not a secret. Proof-of-identity is a separate credential the agent controls.
3. **PRINCIPAL_NOT_SESSION_IN_HANDLERS** — Route handlers MUST NOT ask "do I have a session?" They ask "what principal was authenticated?" Raw session access (`getServerSessionUser`, cookies, headers) is forbidden inside route handlers — the wrapper is the only place that reads the raw credential and constructs the `AuthPrincipal`. Enforced by lint / dep-cruiser rule.
4. **SPLIT_IDENTITY_PROOF_AUTHORIZATION** — Three concerns that must not be conflated: (a) _identity_ = who is this (actorId / userId), (b) _proof_ = how did they prove it (session cookie, bearer, signed challenge, DPoP), (c) _authorization_ = what can they do (scopes, policy tier, spend cap). Business logic reads identity + authorization; it never inspects proof.
5. **DECORATOR_OWNS_STRATEGY** — Route handlers declare auth **policy** (`"public" | "authenticated" | "session_only" | "admin"`), not the resolution function. The wrapper owns proof verification and returns a fully-constructed `AuthPrincipal`. Swapping the identity backend is one file.
6. **DEFAULT_IS_DUAL_ACCESS** — The default `authenticated` policy accepts both agents and humans. `session_only` is the narrow, opt-in carve-out for routes that MUST reject machine identities (OAuth link flows, human profile, governance UI).
7. **CREDENTIAL_IS_HELD_BY_AGENT** — The long-lived secret (keypair, when introduced in Phase 2) never leaves the agent. The platform holds only the public half and short-lived exchanged tokens.
8. **TOKENS_ARE_SHORT_LIVED** — Post-Phase-2, access tokens on `/api/v1/*` expire in minutes. Revocation is implicit (TTL) before it is explicit (DB flag).
9. **BOUNDED_BY_QUOTA_NOT_GATE** — Registration is rate-limited and every issued actor has a hard per-actor spend + concurrency ceiling. Open enrollment is safe when the ceiling is low enough that a mass-mint attack cannot exceed the operator's pre-paid LLM budget.
10. **OPTIONAL_HUMAN_LINKAGE** — A human session holder may later claim an orphan agent-actor, adding delegation rights. The agent identity exists independently of that claim. Represented as `actors.owner_user_id`, nullable.

## Current State (post PR #845) — audit

PR #845 quietly fixed most of the "agent can't reach /api/v1/\*" problem that the validation guide still lists as open. The actual post-merge state of the operator node:

```
┌────────────────────────────────────────────────┬───────────────┬──────────────┐
│ Route                                          │ Auth strategy │ Principal(s) │
├────────────────────────────────────────────────┼───────────────┼──────────────┤
│ POST /api/v1/agent/register                    │ none          │ anyone       │
│ POST /api/v1/chat/completions                  │ agent-capable │ agent|human  │
│ POST /api/v1/ai/chat                           │ agent-capable │ agent|human  │
│ GET  /api/v1/ai/agents                         │ agent-capable │ agent|human  │
│ GET  /api/v1/ai/models                         │ agent-capable │ agent|human  │
│ GET  /api/v1/ai/runs  (+ /[id]/stream)         │ agent-capable │ agent|human  │
│ GET  /api/v1/ai/threads (+ /[stateKey])        │ agent-capable │ agent|human  │
│ GET  /api/v1/agent/runs (+ /[id]/stream)       │ agent-capable │ agent|human  │
│ POST /api/v1/work/items (+ /[id])              │ agent-capable │ agent|human  │
│ POST /api/v1/schedules (+ /[scheduleId])       │ agent-capable │ agent|human  │
│ POST /api/v1/payments/intents                  │ agent-capable │ agent|human  │
│ POST /api/v1/payments/attempts/[id] (+ submit) │ agent-capable │ agent|human  │
│ GET  /api/v1/payments/credits/summary          │ agent-capable │ agent|human  │
│ GET  /api/v1/attribution/epochs/*              │ agent-capable │ agent|human  │
│ GET  /api/v1/node/stream                       │ agent-capable │ agent|human  │
├────────────────────────────────────────────────┼───────────────┼──────────────┤
│ GET  /api/v1/activity                          │ session-only  │ human        │
│ GET  /api/v1/users/me (+ /ownership)           │ session-only  │ human        │
│ GET  /api/v1/governance/status                 │ session-only  │ human        │
│ GET  /api/v1/governance/activity               │ session-only  │ human        │
│ *    /api/v1/auth/openai-codex/*               │ session-only  │ human (OAuth)│
│ *    /api/v1/auth/openai-compatible/*          │ session-only  │ human (OAuth)│
│ *    /api/auth/link/[provider]                 │ session-only  │ human (OAuth)│
└────────────────────────────────────────────────┴───────────────┴──────────────┘
```

Observations:

- **Agent-capable strategy already works.** `@/app/_lib/auth/session` re-exports `resolveRequestIdentity` as `getSessionUser`, and the wrapper's `auth: { mode: "required", getSessionUser }` parameter picks it up. The "decorator" exists; the only knob is which function a route passes.
- **The validation guide is stale.** `docs/guides/agent-api-validation.md` lists "ai/chat rejects bearer" and "ai/agents has no machine path" as open shortcomings — both are false post-PR-845.
- **Only one semantic hole on the agent-capable tier:** `v1/activity`. Everything else on the session-only tier is a legitimate carve-out (OAuth flows, human governance UI, human profile).
- **The real remaining hole is `register`.** Open enrollment, no rate limit, 30-day static bearer, no per-actor ceiling. Tracked in `bug.0297` — remediation direction is being redesigned in this spec.

## Design

### 1 — The canonical `AuthPrincipal` shape

One type, defined in `packages/node-shared`, replaces `SessionUser` as the handler-facing identity carrier.

```ts
// packages/node-shared/src/auth/principal.ts
export type PrincipalType = "user" | "agent" | "system";

export type AuthPrincipal = Readonly<{
  principalType: PrincipalType;
  principalId: string; // stable, canonical id — always set
  actorId: string; // canonical actor UUID — always set
  userId: string | null; // set when principalType === "user" OR when a user has claimed this actor
  tenantId: string; // billing/ownership tenant
  scopes: readonly string[]; // authorization grants
  policyTier: string; // rate/cap bucket ("default" for v0)
}>;
```

Invariant notes:

- `actorId` is always set — for agents, it is the `actors.id`; for humans, it is the actor row that represents that user (post-schema-migration; temporarily equal to `users.id` during backfill).
- `userId` is only set when a user is involved (human session, or agent-owned-by-user via `owner_user_id`).
- `scopes` is the authorization seam. Phase 1 ships with a hardcoded single scope per principal type; fine-grained scopes land later.
- Handlers read `principal.actorId`, `principal.tenantId`, `principal.principalType`, `principal.scopes`. They MUST NOT inspect how the principal was proved.

`SessionUser` is deprecated. We keep it as a type alias during the migration and delete it when all routes are flipped.

### 2 — Decorator: declare policy, not the function

Today:

```ts
wrapRouteHandlerWithLogging(
  { routeId, auth: { mode: "required", getSessionUser } },
  async (ctx, req, sessionUser) => { ... }
)
```

Every route picks its own `getSessionUser` import; handlers receive `SessionUser`. Agent-first property is maintained by discipline, not by the type system.

Proposed:

```ts
wrapRouteHandlerWithLogging(
  { routeId, auth: "authenticated" }, // accept user or agent — default for /api/v1/*
  async (ctx, req, principal) => { ... /* principal is AuthPrincipal, non-null */ }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "session_only" }, // narrow carve-out: OAuth flows, human profile, governance UI
  async (ctx, req, principal) => { ... /* principal.principalType === "user" */ }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "public" }, // no principal — register, health
  async (ctx, req) => { ... }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "admin" }, // authenticated + "admin" scope
  async (ctx, req, principal) => { ... }
)
```

Rules enforced by the wrapper:

- `"authenticated"` — resolves bearer OR session cookie → `AuthPrincipal`. 401 if neither. Default for `/api/v1/*`.
- `"session_only"` — resolves session cookie only. Rejects bearers with 401. Returns a `user`-typed principal.
- `"public"` — handler signature has no `principal` argument. Type-level guarantee that the handler cannot accidentally read identity.
- `"admin"` — like `"authenticated"` plus a scope check for `"admin"`. Denies with 403.
- A route that omits `auth` is a TypeScript error (no silent default).

Implementation scope:

```
packages/node-shared/src/auth/principal.ts               ← new AuthPrincipal type
packages/node-shared/src/auth/policy.ts                  ← policy string union + type helpers
nodes/*/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts
                                                         ← owns all 4 policies; returns AuthPrincipal
nodes/*/app/src/app/_lib/auth/resolveAuthPrincipal.ts    ← single resolver; replaces session.ts + request-identity.ts
nodes/*/app/src/app/api/v1/**/route.ts                   ← remove getSessionUser imports, update handler sig
eslint.config.mjs + depcruise                            ← forbid getServerSessionUser / cookies() / headers() in route.ts files
```

### 3 — Route bucket audit (as of PR #845 tip)

All authenticated routes fall into exactly three buckets:

```
┌──────────────────────────────────────┬──────────────────┬────────────────────────┐
│ Bucket                               │ Policy           │ Examples               │
├──────────────────────────────────────┼──────────────────┼────────────────────────┤
│ 1. Dual-access (default)             │ "authenticated"  │ ai/chat, ai/agents,    │
│    agents + humans, no discrimination│                  │ ai/runs, ai/threads,   │
│                                      │                  │ chat/completions,      │
│                                      │                  │ work/items, schedules, │
│                                      │                  │ payments/*,            │
│                                      │                  │ attribution/*,         │
│                                      │                  │ agent/runs, activity   │
├──────────────────────────────────────┼──────────────────┼────────────────────────┤
│ 2. True human-only                   │ "session_only"   │ users/me, users/me/    │
│    agent identity forbidden          │                  │ ownership, auth/       │
│                                      │                  │ openai-codex/*, auth/  │
│                                      │                  │ openai-compatible/*,   │
│                                      │                  │ auth/link/[provider]   │
├──────────────────────────────────────┼──────────────────┼────────────────────────┤
│ 3. Internal/admin                    │ "admin"          │ governance/status,     │
│    requires admin scope              │                  │ governance/activity    │
├──────────────────────────────────────┼──────────────────┼────────────────────────┤
│ Plus:                                │                  │                        │
│ 4. Public seams                      │ "public"         │ agent/register, health │
└──────────────────────────────────────┴──────────────────┴────────────────────────┘
```

`v1/activity` moves from its current session-only import to `"authenticated"` — an agent should be able to see its own activity feed.

### 4 — Register: agent-first onboarding

Today's flow:

```
POST /api/v1/agent/register { name } → 201 { userId, apiKey, billingAccountId }
```

Problems:

- Mints a row in `users` for an agent (category error per identity-model.md).
- Mints a billing account per agent (Gap 5 in bug.0297 — should be 1:N actor per tenant).
- Returns a 30-day HMAC bearer that is the sole credential — no proof of possession.
- No rate limit, no quota, no actor-level spend ceiling.

Proposed flow:

```
Agent side                                         Platform side
───────────                                        ─────────────
generate Ed25519 keypair locally
   │
   ▼
POST /api/v1/agent/register
   { name, publicKeyJwk }                    ┌─► rate-limit per source IP
                                             │
                                             ▼
                                       mint actorId (uuid, public)
                                       store (actorId, publicKeyJwk,
                                              created_at, policy_tier,
                                              spend_cap_cents,
                                              concurrency_cap)
                                       attach to default tenant
                                             │
                                             ▼
                                       audit log (Pino + route_id=agent.register)
   ◄────────── 201 { actorId, policyTier, spendCapCents } ──────────

                ─── later, on each request ───

sign challenge                             ┌─► verify signature via stored pubkey
 { actorId, ts, nonce, routeId }           │  check ts within skew window
   │                                       │  check nonce not replayed (redis set, TTL)
   ▼                                       │  check actorId not revoked
POST /api/v1/agent/token                   │  check spend / concurrency headroom
   { actorId, signedChallenge }    ────────┘
                                             │
                                             ▼
                                       mint short-lived access token
                                       (HMAC JWT, sub=actorId, ttl=5min,
                                        aud=operator-node, cnf=pubkeyThumb)
   ◄────────── 200 { accessToken, expiresAt } ──────────

Authorization: Bearer <accessToken>        ┌─► wrapper resolves token
                                           │  validates sig + exp + cnf
GET /api/v1/ai/runs                 ───────┘  builds Principal{ actorId, … }
```

Crucial properties:

- **`actorId` is public.** Returned in plaintext on register. Not a secret. Cannot be stolen in a way that grants access because access requires a signature from the held private key.
- **No `users` row is created.** A new table, `actors`, holds the agent identity with `kind='agent'`. This unblocks Gap 1 from bug.0297's schema work.
- **No `billing_account` is created per agent by default.** Agents attach to a default tenant on register; billing tenancy (Gap 5) can be designed orthogonally. The spend cap is a property of the actor, not a new billing account.
- **Revocation is a DB field on `actors`.** `revoked_at` on the actor row flips all future token exchanges to 401. Short-lived access tokens mean the longest possible window for a stolen token is the TTL, not 30 days.
- **`AUTH_SECRET` rotation is no longer the only kill switch.** Per-actor revocation exists.

Minimal storage (new):

```sql
CREATE TABLE actors (
  id             UUID PRIMARY KEY,          -- actorId
  kind           TEXT NOT NULL CHECK (kind IN ('agent','user','system','org')),
  display_name   TEXT,
  public_key_jwk JSONB,                      -- agent kind only; null for human
  tenant_id      UUID NOT NULL,              -- billing/tenancy attachment
  policy_tier    TEXT NOT NULL DEFAULT 'default',
  spend_cap_cents_per_day INTEGER NOT NULL,
  concurrency_cap         INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX actors_pubkey_thumb_idx
  ON actors ( (public_key_jwk->>'thumbprint') )
  WHERE kind = 'agent';
```

### 5 — Token model evolution

Phases — we lock the _contract_ first, then harden the _proof_. "Ship Phase 1 contract now; harden to keypair and proof-bound tokens immediately after."

```
┌─────────┬───────────────────────┬─────────────────────────┬──────────────────┬─────────────────────────┐
│ Phase   │ What ships            │ Register shape          │ Access token     │ Incremental win         │
├─────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────────────────────┤
│ Phase 0 │ Today (PR #845)       │ { name }                │ HMAC bearer 30d  │ agent reaches /api/v1/* │
│         │                       │ → { userId, apiKey, … } │                  │ BUT bug.0297 open       │
├─────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────────────────────┤
│ Phase 1 │ CONTRACT LOCK:        │ { name }                │ HMAC bearer 24h  │ actorId is canonical    │
│  NOW    │  • AuthPrincipal type │ → { actorId, tenantId,  │ + cap + actorId  │ across all routes,      │
│         │  • wrapper policies   │      policyTier,        │   encoded        │ wrapper owns proof,     │
│         │  • actors table       │      spendCapCents }    │                  │ schema ready for proof, │
│         │  • register→actor row │                         │                  │ bug.0297 downgraded     │
│         │  • IP rate-limit      │                         │                  │                         │
│         │  • per-actor caps     │                         │                  │                         │
├─────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────────────────────┤
│ Phase 2 │ Keypair proof-of-     │ { name, publicKeyJwk }  │ HMAC JWT, ttl=5m │ cryptographic proof,    │
│  NEXT   │ possession exchange   │ → { actorId, … }        │ issued from      │ explicit revocation,    │
│         │                       │                         │ /agent/token     │ stolen token window 5m  │
├─────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────────────────────┤
│ Phase 3 │ DPoP sender-          │ unchanged               │ sender-          │ stolen token is nearly  │
│         │ constrained tokens    │                         │ constrained JWT  │ unusable off-host       │
├─────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────────────────────┤
│ Phase 4 │ Optional human        │ adds claim flow on      │ adds on_behalf   │ delegation model —      │
│         │ linkage               │ existing actorId        │ claim            │ humans claim orphans    │
└─────────┴───────────────────────┴─────────────────────────┴──────────────────┴─────────────────────────┘
```

**Phase 1 is the work item that will be filed as `task.0312`**. It ships three things in one atomic PR because they are each other's prerequisites: the `AuthPrincipal` type needs the `actors` table to be non-degenerate; the wrapper refactor needs the type; the route audit cannot happen without the wrapper. Splitting would leave the tree in a half-migrated state.

Phase 2 then swaps the proof backend under a stable contract — zero route changes.

### 6 — Rate limits and caps (Phase 1, applies always after)

- `/api/v1/agent/register` — 5 req / minute / source IP, 100 req / hour / source IP. Over-cap → 429 with `Retry-After`. Buckets in Redis.
- Per-actor daily spend cap (cents), checked in the LLM execution path before dispatch. Default tier = low enough that 1000 mass-minted actors cannot exceed the operator's daily LLM budget envelope.
- Per-actor concurrency cap (in-flight graph runs). Default = 1. Raises require admin action.
- Audit log: every register attempt (success + fail), every token exchange, every revocation. Pino envelope already exists; we add an event name.

### 7 — Contract changes

**Phase 1** (this spec's implementation task):

```
packages/node-contracts/src/agent.register.v1.contract.ts
  input:  { name }                       // unchanged
  output: { actorId, tenantId, policyTier, spendCapCents, apiKey }
          // NOTE: apiKey is a 24h HMAC bearer with actorId encoded.
          //       Still issued at register-time because we haven't
          //       introduced proof-of-possession yet. But the bearer
          //       claims now carry actorId, not userId.

packages/node-shared/src/auth/principal.ts  (NEW)
  export type AuthPrincipal = { principalType; principalId; actorId; userId;
                                tenantId; scopes; policyTier }
  export type AuthPolicy = "public" | "authenticated" | "session_only" | "admin"
```

**Phase 2** (separate PR, after Phase 1 lands):

```
packages/node-contracts/src/agent.register.v2.contract.ts  (NEW)
  input:  { name, publicKeyJwk: JsonWebKey }
  output: { actorId, tenantId, policyTier, spendCapCents }
          // No apiKey — access is gained via /agent/token proof exchange.

packages/node-contracts/src/agent.token.v1.contract.ts     (NEW)
  input:  { actorId, signedChallenge: { ts, nonce, routeId, sig } }
  output: { accessToken, expiresAt }
```

Phase 1 → Phase 2 transition: both register contracts live side-by-side; the v1 shape is deprecated but accepted until all internal clients migrate.

### 8 — Validation plan (per phase)

Phase 1:

- [ ] 1000 POSTs/min to `/api/v1/agent/register` from one IP → 429 after N, no new actor rows.
- [ ] Fresh agent → 2nd completion of the day that exceeds `spendCapCents` → 402 / insufficient-budget, no LLM call dispatched.
- [ ] HMAC bearer age assertion: `iat + 24h` on every newly-issued token.

Phase 2:

- [ ] Unit: sign challenge, exchange for access token, use on `/api/v1/ai/runs`.
- [ ] Unit: expired challenge (ts > skew) → 401.
- [ ] Unit: replayed nonce → 401.
- [ ] Stack: revoke actor mid-stream → new requests 401, in-flight streams drain.
- [ ] Stack: stolen access token reused after 5 min → 401.

Phase 3:

- [ ] DPoP header missing or mismatched thumbprint → 401.

## Related

- [task.0312 — Agent-first auth Phase 1](../../work/items/task.0312.agent-first-auth-phase1.md) — the implementation task for this spec's Phase 1 (AuthPrincipal + wrapper + actors table).
- [bug.0297 — Agent register open factory](../../work/items/bug.0297.agent-register-open-account-factory.md) — the security hole that triggered this spec. Its remediation direction is superseded by this spec: bounded-by-quota, not invitation-gated.
- [Security & Authentication Spec](./security-auth.md) — still framed around session + app_api_keys. Superseded on the programmatic side by this spec; human track (app_api_keys for session-linked use) remains orthogonal.
- [Identity Model](./identity-model.md) — defines `actorId` primitive; this spec is the first concrete schema implementing the `actors` table with `kind='agent'`.
- [Agent API Validation Guide](../guides/agent-api-validation.md) — stale post-PR-845; refresh is part of the Phase 1 task closeout.
- [proj.accounts-api-keys](../../work/projects/proj.accounts-api-keys.md) — user-wallet-and-apikey project. Orthogonal (human track). Cross-linked, not merged.

## Open Questions

1. **Where do Phase 2 proof-verify functions live relative to `wrapRouteHandlerWithLogging`?** Preference: a pluggable `ProofVerifier` interface (Phase 2), with Phase 1 shipping a trivial `HmacBearerVerifier` that reads actorId from the token claims. Keeps the session-cookie path unchanged.
2. **Do we need an on-disk public-key store in Phase 2, or is the `actors` table enough?** Preference: table only; public keys are not secrets, DB is durable, Redis is for nonces.
3. **What is the default `spendCapCents_per_day`?** Needs an operator-facing number backed by the pre-paid LiteLLM budget envelope. Ballpark: $0.50/day/actor on first flight. Confirm with cost-control runbook before Phase 1 merge.
4. **Tenant attachment on register — one default tenant, or scope-by-header?** Phase 1: one default tenant per node. Phase 2: may accept an invitation-style scope hint from a trusted internal caller.
5. **Does `v1/activity` dual-access flip land in Phase 1 or ship separately?** Phase 1, bundled — it's a one-line import swap inside the same wrapper refactor.
6. **Should we kill `SessionUser` in Phase 1 or leave it as a type alias for one release?** Preference: type-alias for one release, then delete. Avoids merge conflicts with in-flight feature branches.
