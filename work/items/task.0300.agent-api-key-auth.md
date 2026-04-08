---
id: task.0300
type: task
title: "API Key Auth — Credential Resolver for Completions"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Add app_api_keys table and a resolveRequestIdentity() credential resolver that tries Bearer key then session cookie. Wire into completions route via existing getSessionUser callback slot. Zero wrapper changes."
outcome: "curl -H 'Authorization: Bearer sk_live_...' POST /api/v1/chat/completions works. Keys created via session-authenticated endpoint. Charges attributed to key owner's billing account."
initiative: proj.agentic-interop
assignees: [derekg1729]
labels: [identity, auth, api, agents, interop]
branch: worktree-task-agent-api-keys
pr:
reviewer:
created: 2026-04-06
updated: 2026-04-06
---

# API Key Auth — Credential Resolver for Completions

> Project: [proj.agentic-interop](../../work/projects/proj.agentic-interop.md) P0.0
> Accelerates: [proj.accounts-api-keys](../../work/projects/proj.accounts-api-keys.md) P3
> Accounts spec: [docs/spec/accounts-design.md](../../docs/spec/accounts-design.md)

## Problem

All `/api/v1/` routes require `getSessionUser()` — a NextAuth server-side session cookie. External agents, CLI tools, and other nodes cannot call the completions endpoint.

## Design

### Outcome

External callers can `POST /api/v1/chat/completions` with `Authorization: Bearer sk_live_...` and get the same behavior as a browser session — same billing, same graphs, same execution pipeline.

### Approach

**Solution**: Credential resolver pattern (GitHub/Vercel standard). A `resolveRequestIdentity(request)` function checks Bearer key first, falls back to session cookie, returns `SessionUser | null`. Passed to the completions route via the existing `getSessionUser` callback slot. **Zero changes to `wrapRouteHandlerWithLogging`.**

**Reuses**:
- `extractBearerToken()` + `safeCompare()` from internal graphs route → extract to `packages/node-shared/src/auth/bearer.ts`
- `getOrCreateBillingAccountForUser()` — existing user → billing account resolution (unchanged)
- `wrapRouteHandlerWithLogging` `mode: "required"` — unchanged, just swap `getSessionUser` for `resolveRequestIdentity`
- `SessionUser` interface — API key resolution returns same shape

**Rejected**:
- ~~`mode: "dual"` wrapper change~~ — bespoke Cogni-ism. Top-tier pattern is a credential resolver passed as the existing `getSessionUser` callback. Zero wrapper changes needed.
- ~~actor_id FK~~ — actors table doesn't exist. Bind to `user_id` (what exists).
- ~~argon2id~~ — native dep for no gain. SHA-256 sufficient for high-entropy tokens.
- ~~Per-key rate limits~~ — OpenRouter rate-limits free models globally. Billing credit check is the existing throttle.
- ~~Agent self-provisioning / scope delegation~~ — future concern, tracked in project P1.

### Schema: `app_api_keys` table

```sql
CREATE TABLE app_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL,           -- SHA-256 hex digest
  key_prefix    TEXT NOT NULL,           -- first 8 chars (e.g. "sk_live_a")
  label         TEXT NOT NULL DEFAULT 'Default',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_app_api_keys_hash ON app_api_keys(key_hash)
  WHERE active = true AND revoked_at IS NULL;
```

**Key format**: `sk_live_<32 random hex chars>` (40 chars total)

**No billing_account_id column** — resolved at runtime via `getOrCreateBillingAccountForUser(userId)`, same path as session auth.

### Auth Pattern: Credential Resolver

```typescript
// src/app/_lib/auth/resolve-request-identity.ts
// Lives next to session.ts — same layer, same concern.

export async function resolveRequestIdentity(
  request: NextRequest
): Promise<SessionUser | null> {
  // 1. Bearer key (programmatic callers)
  const token = extractBearerToken(request.headers.get("authorization"));
  if (token?.startsWith("sk_live_")) {
    const hash = sha256(token);
    const row = await lookupActiveKey(hash); // DB: app_api_keys
    if (row) return { id: row.userId, walletAddress: null, displayName: null, avatarColor: null };
  }

  // 2. Session cookie (browser callers) — with origin check for CSRF
  if (hasCookieAuth(request)) {
    // Verify Origin header matches app domain (CSRF protection for cookie path)
    if (!isValidOrigin(request)) return null;
    return getSessionUser();
  }

  return null;
}
```

**Route wiring** — one-line change, zero wrapper changes:

```typescript
// BEFORE:
auth: { mode: "required", getSessionUser }

// AFTER:
auth: { mode: "required", getSessionUser: resolveRequestIdentity }
```

The wrapper calls `getSessionUser()` as before. It doesn't know or care that the implementation now checks Bearer first. **This is how GitHub and Vercel do it.**

### Key CRUD Endpoints

Session-authenticated (browser only — you create keys from the dashboard):

```
POST   /api/v1/auth/api-keys     → { id, key: "sk_live_...", keyPrefix, label, createdAt }
GET    /api/v1/auth/api-keys     → { keys: [{ id, keyPrefix, label, active, createdAt }] }
DELETE /api/v1/auth/api-keys/:id → { ok: true }
```

- Plaintext returned ONCE at creation
- Max 25 active keys per user (guard against compromised session)
- Revoke sets `revoked_at = NOW()`, `active = false`

### Invariants

- [ ] NO_WRAPPER_CHANGES: `wrapRouteHandlerWithLogging` is not modified
- [ ] NO_FACADE_CHANGES: completion facade, billing, graph execution unchanged
- [ ] NO_PLAINTEXT_SECRETS: key_hash stored, plaintext returned once (spec: accounts-design)
- [ ] SESSION_AUTH_UNBROKEN: existing session auth works identically on all routes
- [ ] CSRF_ON_COOKIE_PATH: Origin/Referer verified when falling through to cookie auth
- [ ] KEY_COUNT_LIMIT: max 25 active keys per user
- [ ] CONSTANT_TIME_HASH_COMPARISON: uses `timingSafeEqual` on hash buffers

### Files

**Create:**
- `nodes/node-template/app/src/app/_lib/auth/resolve-request-identity.ts` — credential resolver (Bearer → session fallback, CSRF check on cookie path)
- `packages/db-schema/src/api-keys.ts` — Drizzle schema for `app_api_keys`
- `packages/db-schema/drizzle/migrations/XXXX_app_api_keys.sql` — migration
- `nodes/node-template/app/src/app/api/v1/auth/api-keys/route.ts` — POST + GET
- `nodes/node-template/app/src/app/api/v1/auth/api-keys/[id]/route.ts` — DELETE (revoke)
- `packages/node-shared/src/auth/bearer.ts` — `extractBearerToken()` + `safeCompare()` (extracted from internal route)

**Modify:**
- `nodes/node-template/app/src/app/api/v1/chat/completions/route.ts` — swap `getSessionUser` → `resolveRequestIdentity` (one import change)
- `nodes/node-template/app/src/app/api/internal/graphs/[graphId]/runs/route.ts` — import `extractBearerToken`/`safeCompare` from shared instead of inline
- `packages/db-schema/src/index.ts` — export new schema
- `packages/node-shared/src/auth/index.ts` — export bearer utilities

**Test:**
- `tests/contract/auth.api-keys.v1.contract.test.ts` — CRUD + hash verification
- `tests/stack/ai/completions-api-key.stack.test.ts` — create key → Bearer completion → charge_receipt attributed correctly

### Upgrade Path

When `actors` table lands: add nullable `actor_id` FK to `app_api_keys`. Key creation resolves `user_id → actor_id`. No schema break — `user_id` stays.

## Dependencies

- users + billing_accounts tables — exist ✅
- `getOrCreateBillingAccountForUser()` — exists ✅
- `extractBearerToken()` + `safeCompare()` — exist in internal route, need extraction ✅

## Test Plan

1. **Contract:** Create key → hash stored, plaintext NOT stored
2. **Contract:** List keys → prefix only, no hash or plaintext
3. **Contract:** Revoke key → sets revoked_at, active=false
4. **Contract:** Bearer with valid key → resolves correct user_id
5. **Contract:** Bearer with revoked/invalid key → null (401 from wrapper)
6. **Contract:** Session auth still works (no regression)
7. **Contract:** Key count limit enforced (26th key rejected)
8. **Stack:** Create key → Bearer completion → charge_receipt.billingAccountId matches user's account

## Security

- SHA-256 hashing (high-entropy tokens, not passwords)
- `timingSafeEqual` on hash comparison (constant-time)
- Plaintext shown once, never stored or logged
- `key_prefix` (first 8 chars) for UI/log identification
- Max 25 active keys per user
- CSRF: Origin header verified on cookie-authenticated requests
- Max auth header: 512 bytes, max token: 256 bytes (from internal route)

## Validation

- [ ] `pnpm check:fast` passes
- [ ] Contract tests for key CRUD + Bearer auth resolution
- [ ] Stack test: create key → Bearer completion → charge_receipt
- [ ] Session auth on completions unchanged (no regression)
- [ ] Revoked/invalid keys return 401
