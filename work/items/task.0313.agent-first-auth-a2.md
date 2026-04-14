---
id: task.0313
type: task
title: "Agent-first auth A2 — actors table + register hardening + per-actor quotas"
status: needs_implement
priority: 1
rank: 5
estimate: 3
assignees: [derekg1729]
created: 2026-04-14
updated: 2026-04-14
project: proj.accounts-api-keys
branch:
spec_refs: [agent-first-auth]
blocked_by: [task.0312]
labels: [auth, identity, agent-first, security]
summary: "A2 of the proj.accounts-api-keys agent-first auth track. Depends on task.0312 (A1) landing first. Ship the actors table with users backfill, rewrite /api/v1/agent/register to create actors rows (not users rows), add an IP rate limit on registration, enforce per-actor daily spend caps + concurrency caps in the LLM dispatch path, and drop the issued apiKey TTL from 30d to 24h with actorId encoded in the claims. Downgrades bug.0297 from critical to medium."
outcome: "Registration is rate-limited per source IP and cannot exceed per-actor spend + concurrency caps enforced before LLM dispatch. bug.0297 drops to medium severity (residual concern is 'no cryptographic proof of possession', addressed later by A3). The actors table exists; every user has an actor row; every registered agent has an actor row with kind='agent'. Storage is decoupled from the handler-facing AuthPrincipal contract that A1 already locked."
---

# task.0313 — Agent-first auth A2 (register hardening + actors table)

## Context

A1 (`task.0312`) locks the handler-facing contract. Handlers now receive a typed `AuthPrincipal` whose `actorId` is a runtime cast over `users.id` — fictional but correct-at-the-boundary. A2 replaces that cast with a real `actors` table, rewrites the `/api/v1/agent/register` endpoint to produce `kind='agent'` actor rows (not user rows), and installs the quota envelope from `docs/spec/agent-first-auth.md` §"Rate limit + quota envelope".

The split between A1 and A2 matters because A2 carries the only schema change in the track, the only user-facing contract break, and the only production-risk element (backfill migration). Landing it on top of a known-good A1 means the wrapper and route audit can be verified in isolation before the storage mutation.

A2 closes the critical-severity part of `bug.0297`. The residual medium-severity concern ("no cryptographic proof of possession") stays open and is closed by A3.

Spec: [agent-first-auth.md](../../docs/spec/agent-first-auth.md) — source of truth for the `actors` schema, register flow, and quota envelope.

Project track: [proj.accounts-api-keys § Agent-First Auth Track](../projects/proj.accounts-api-keys.md) — this task is A2.

## Design

### Outcome

`bug.0297` drops from critical to medium. Registration is rate-limited per source IP; every `actors` row has `spend_cap_cents_per_day` and `concurrency_cap` that are enforced before LLM dispatch; the issued `apiKey` is a 24h bearer whose claims carry `actorId`. The `AuthPrincipal.actorId` field that handlers already read now resolves against a real table instead of a runtime cast — handler code does not change.

### Approach

**Solution**: Four coupled changes in one PR.

1. **`actors` table migration + backfill**:

   ```sql
   CREATE TABLE actors (
     id                      UUID PRIMARY KEY,
     kind                    TEXT NOT NULL CHECK (kind IN ('agent','user','system','org')),
     display_name            TEXT,
     public_key_jwk          JSONB,                         -- nullable until A3
     owner_user_id           UUID REFERENCES users(id),    -- nullable; A5 sets it
     tenant_id               UUID NOT NULL,
     policy_tier             TEXT NOT NULL DEFAULT 'default',
     spend_cap_cents_per_day INTEGER NOT NULL,
     concurrency_cap         INTEGER NOT NULL,
     created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
     revoked_at              TIMESTAMPTZ
   );

   CREATE UNIQUE INDEX actors_pubkey_thumb_idx
     ON actors ((public_key_jwk->>'thumbprint'))
     WHERE kind = 'agent';
   ```

   **Backfill — explicit idempotency strategy**:

   ```sql
   INSERT INTO actors (id, kind, tenant_id, policy_tier, spend_cap_cents_per_day, concurrency_cap)
   SELECT
     u.id,
     'user',
     :default_tenant_id,
     'default',
     :default_spend_cap_cents,
     :default_concurrency_cap
   FROM users u
   ON CONFLICT (id) DO NOTHING;
   ```

   Post-condition assertion (run inside the same migration, after the insert):

   ```sql
   DO $$
   DECLARE missing INT;
   BEGIN
     SELECT COUNT(*) INTO missing
     FROM users u
     LEFT JOIN actors a ON a.id = u.id AND a.kind = 'user'
     WHERE a.id IS NULL;
     IF missing > 0 THEN
       RAISE EXCEPTION 'actors backfill missed % user rows', missing;
     END IF;
   END $$;
   ```

   Re-running the migration on an already-backfilled DB is a no-op because of the `ON CONFLICT DO NOTHING`. The post-condition check fails loudly if a production retry lands in a broken state.

2. **Register rewrite** (`nodes/*/app/src/app/api/v1/agent/register/route.ts`):

   ```ts
   POST /api/v1/agent/register  { name }
    → rate-limit check per source IP
    → insert actors row (kind='agent', owner_user_id=null, default tenant + caps)
    → issue HMAC bearer with claims { sub: actorId, exp: iat + 24h }
    → return { actorId, tenantId, policyTier, spendCapCents, apiKey }
   ```

   `getOrCreateBillingAccountForUser` is NOT called during register — billing tenancy is a property of the `tenant_id` field on the actor row. (Existing billing account creation flow for humans is untouched; orthogonal track.)

3. **IP rate limit on `/register`**:
   - 5 req / minute / source IP
   - 100 req / hour / source IP
   - Buckets in Redis via the existing `ioredis` client (same primitive used by other rate-limited endpoints; verify presence during `/implement`)
   - Over-cap → `429` with `Retry-After`
   - Audit log every over-cap rejection with source IP

4. **Per-actor quota enforcement**:
   - **Spend cap**: the LLM dispatch path (`chat/completions`, `ai/chat`, any other provider-calling route) reads `principal.actorId` → looks up `actors.spend_cap_cents_per_day` → compares against today's accumulated spend (sum of `charge_receipts` grouped by `actor_id, date_trunc('day', created_at)`). If exceeded, denies with `402` before any provider call.
   - **Concurrency cap**: before starting a graph run, check the count of in-flight runs for this `actorId` in `graph_runs` where `status IN ('pending','running')`. If >= `concurrency_cap`, deny with `429`.
   - Reuses the existing `InsufficientCreditsError` type taxonomy as the error seam — same HTTP mapping.

**Register bearer TTL change**: `issueAgentApiKey` in `nodes/*/app/src/app/_lib/auth/request-identity.ts` drops from 30d to 24h and encodes `actorId` in the `sub` claim (previously `userId`). Because A1 already normalized what `AuthPrincipal.actorId` means, this is a behaviorally-invisible change to handlers.

**Reuses**:

- Existing Drizzle migration infra.
- Existing `charge_receipts` table for spend cap accounting (no new ledger).
- Existing `graph_runs` table for concurrency counting.
- Existing `InsufficientCreditsError` taxonomy.
- Existing `ioredis` client for rate-limit buckets.
- Existing `issueAgentApiKey` HMAC issuer — only the claim contents and TTL change.
- Pino audit envelope.

**Rejected alternatives**:

- **Track spend cap in a new dedicated `actor_spend_daily` table.** Rejected: reuses the existing `charge_receipts` ledger via a simple grouped sum. Adding a second source of truth would require a reconciliation story.
- **Use a sliding window rate limiter instead of fixed buckets.** Rejected for now: fixed buckets are simpler and good enough against the threat (mass-mint). Revisit if real adversarial traffic shows bucket-boundary gaming.
- **Per-minute spend cap instead of per-day.** Rejected: the budget envelope is a daily number; per-minute would require finer-grained accounting without changing the safety envelope.
- **Admin-minted invitation token gating (bug.0297's original direction).** Rejected: the spec's `BOUNDED_BY_QUOTA_NOT_GATE` invariant. Quota enforcement achieves the same safety envelope with no admin UI.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] BOUNDED_BY_QUOTA_NOT_GATE: `/register` is rate-limited per source IP; every actor has `spend_cap_cents_per_day` enforced before LLM dispatch (spec: agent-first-auth).
- [ ] ACTOR_ID_IS_PUBLIC: register returns `actorId` in plaintext; apiKey claims encode `actorId` (spec: agent-first-auth).
- [ ] IDEMPOTENT_BACKFILL: the `users → actors` backfill is a no-op on re-run; post-condition assertion fails loudly on a broken state (spec: this task).
- [ ] NO_A1_BLEED: this task does not modify `wrapRouteHandlerWithLogging`, `AuthPrincipal`, or any route file's handler signature. A1 already locked those (spec: this task, Context).
- [ ] SPLIT_IDENTITY_PROOF_AUTHORIZATION: the apiKey claim change (`sub: userId → sub: actorId`) is behaviorally invisible to handlers; `AuthPrincipal.actorId` already existed in A1 (spec: agent-first-auth).
- [ ] CONTRACTS_FIRST: `agent.register.v1.contract.ts` output shape is the source of truth; no parallel definitions (spec: architecture).
- [ ] HEXAGONAL_ALIGNMENT: `actors` schema lives in `packages/db-schema`; register route is app-layer; quota enforcement is a feature-layer check (spec: architecture).
- [ ] SIMPLE_SOLUTION: reuses `charge_receipts`, `graph_runs`, `ioredis`, `InsufficientCreditsError`, existing migration infra — zero new dependencies (spec: this design).

### Files

<!-- High-level scope — paths finalized during /implement -->

**Create**:

- `packages/db-schema/src/actors.ts` (or extend `identity.ts`) — Drizzle schema for `actors`
- `nodes/operator/app/drizzle/migrations/NNNN_actors_table.sql` — table creation + unique index + users backfill + post-condition check
- `nodes/operator/app/drizzle/migrations/NNNN_actors_table.down.sql` — down migration (drop table; `DELETE FROM actors WHERE kind='user'` for partial rollback)
- `nodes/operator/app/src/features/actors/` — feature slice: `listActorsForTenant`, `getActorByPrincipal`, `recordSpendForActor`, `countInFlightRunsForActor`
- `nodes/operator/app/src/features/accounts/public/spendCapCheck.ts` — per-actor daily cap enforcement, called from the LLM dispatch path
- `nodes/operator/app/src/bootstrap/http/ipRateLimit.ts` — IP rate-limit helper (if not already factored out)
- `tests/stack/api/agent-register-a2.stack.test.ts` — register contract, rate limit, spend cap, concurrency cap

**Modify**:

- `packages/node-contracts/src/agent.register.v1.contract.ts` — output shape → `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`
- `nodes/*/app/src/app/api/v1/agent/register/route.ts` — rewrite per the flow above (rate limit, actors insert, bearer issue, return)
- `nodes/*/app/src/app/_lib/auth/request-identity.ts` — `issueAgentApiKey` claims: `sub = actorId`, `exp = iat + 24h` (was 30d)
- `nodes/*/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — replace the temporary `actorId = users.id` cast with an `actors` table lookup. Handler-facing shape unchanged.
- `nodes/*/app/src/app/api/v1/chat/completions/route.ts` — call `spendCapCheck` before dispatching the graph
- `nodes/*/app/src/app/api/v1/ai/chat/route.ts` — same
- `docs/guides/agent-api-validation.md` — update register example to the new output shape
- `work/items/bug.0297.agent-register-open-account-factory.md` — status → `needs_review`; note that this task downgrades the severity to medium

**Test**:

- `tests/stack/api/agent-register-a2.stack.test.ts`:
  - Register returns `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`; no `userId` field
  - Register creates an `actors` row with `kind='agent'`
  - 1000 POSTs to `/register` over 60s from one IP → 429 after threshold; `actors` row count stays bounded
  - Setting `spend_cap_cents_per_day` to 1 on a test actor, then POSTing 2× `/chat/completions` → second returns `402` with the `InsufficientCreditsError` shape and no provider call is made
  - Starting `concurrency_cap + 1` concurrent graph runs → the last returns `429`
  - Issued `apiKey` exp claim is `iat + 24h` (not 30d)
  - `apiKey` `sub` claim is an `actorId`, not a `userId`
- `tests/integration/actors-backfill.int.test.ts`:
  - Run the migration against a DB with N users → `actors` has N `kind='user'` rows, all matching user ids
  - Re-run the migration → still N rows (idempotent)
  - Manually corrupt the DB (insert a user row after backfill, skip the post-condition), then re-run → post-condition assertion fires
- `tests/contract/agent-register-a2.contract.test.ts` — output shape invariant

## Validation

### Automated — before merge

- [ ] `pnpm check` clean once
- [ ] Stack test `agent-register-a2.stack.test.ts` green
- [ ] Backfill integration test green (idempotency + post-condition)
- [ ] Contract test green
- [ ] Unit test for `issueAgentApiKey` confirms 24h TTL and `actorId` sub claim
- [ ] Register contract test: response shape matches exactly `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`; no `userId` field

### Manual — post-merge, pre-preview-flight

- [ ] Load test: 1000 `POST /register` over 60s from one source IP → `429` after threshold; `actors` count stays bounded
- [ ] Per-actor cap: raise a single actor's `spend_cap_cents_per_day` to 1, hit `/chat/completions` twice, verify second returns `402`
- [ ] Observability: Loki shows structured audit entries for each register attempt (success + `429`), each spend-cap denial
- [ ] `bug.0297` status updated from `critical` to `medium` after deploy-verify

### Out of scope (deferred to A3 / A4 / A5)

- Keypair registration (`publicKeyJwk` input on register) — A3
- `/api/v1/agent/token` exchange — A3
- Short-lived proof-bound access tokens — A3
- `bug.0297` full closure (residual medium after A2) — A3
- DPoP — A4
- Human claim flow for `owner_user_id` — A5

## Notes

- **Ordering**: MUST land after `task.0312` (A1). The `resolveAuthPrincipal` file edited here was created in A1 — starting A2 before A1 lands means merging around a file that does not yet exist.
- **Branch**: `feat/agent-first-auth-a2`, off whatever branch A1 lands on.
- **Backfill default values**: `default_tenant_id`, `default_spend_cap_cents_per_day`, `default_concurrency_cap` must be set from an operator-facing config before the migration runs in production. Local dev + staging can use hardcoded defaults; production requires an operator review step during the deploy.
- **Residual bug.0297 concern**: after this task, the remaining security gap is "the 24h HMAC bearer has no proof-of-possession, so a leaked token is still usable for 24h." A3 closes this by replacing the bearer with a 5-minute signed-challenge access token.
