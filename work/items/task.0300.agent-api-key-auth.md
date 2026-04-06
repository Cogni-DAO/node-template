---
id: task.0300
type: task
title: "Agent API Key Auth — Actor-Scoped Keys for Completions Endpoint"
state: design
priority: 1
estimate: 3
project: proj.agentic-interop
summary: "Add API key authentication to /api/v1/chat/completions so agents (and CLI tools) can call graph completions without browser sessions. Keys are scoped to actor_id, inheriting billing and rate limits from the actor's billing_account."
assignees: [derekg1729]
created: 2026-04-06
updated: 2026-04-06
labels: [identity, auth, api, agents, interop]
---

# Agent API Key Auth — Actor-Scoped Keys for Completions Endpoint

> Project: [proj.agentic-interop](../../work/projects/proj.agentic-interop.md)
> Identity model: [docs/spec/identity-model.md](../../docs/spec/identity-model.md)
> x402 prototype: PR #646 (`origin/worktree-spike-0220-aimo-x402`)
> Agent registry: [proj.agent-eval-registry](../../work/projects/proj.agent-eval-registry.md)

## Problem

All `/api/v1/` routes require `getSessionUser()` — a Next.js server-side session cookie. This means:

1. **No programmatic access** — external agents, CLI tools, cron jobs, and other nodes cannot call our completions endpoint
2. **No agent self-service** — agents cannot provision their own API access as part of their lifecycle
3. **x402 prototype used a shim** — the x402 spike (PR #646) created a synthetic `SessionUser` from wallet address, acknowledging this gap (`task.0222 replaces with actor_id`)

The identity model already defines `actor_id` (kind: `user | agent | system | org`) as the economic subject that earns, spends, and is attributed. API keys should bind to this primitive.

## Design

### Core: API Keys Bind to Actors

```
┌─────────────────────────────────────────────────────┐
│  api_keys table                                     │
│                                                     │
│  id              UUID PK                            │
│  actor_id        UUID FK → actors.id                │
│  key_hash        TEXT NOT NULL (argon2id)            │
│  key_prefix      TEXT NOT NULL (first 8 chars)       │
│  display_name    TEXT                                │
│  scopes          TEXT[] DEFAULT '{completions}'      │
│  rate_limit_rpm  INT DEFAULT 60                      │
│  expires_at      TIMESTAMPTZ                         │
│  revoked_at      TIMESTAMPTZ                         │
│  last_used_at    TIMESTAMPTZ                         │
│  created_at      TIMESTAMPTZ DEFAULT NOW()           │
│                                                     │
│  CONSTRAINT: billing via actor → billing_account_id  │
│  RLS: actor's billing_account_id                     │
└─────────────────────────────────────────────────────┘
```

**Key format:** `cogni_<actor_kind_prefix>_<random>` (e.g., `cogni_ag_sk_abc123...`, `cogni_usr_sk_xyz789...`)

- `cogni_ag_` = agent actor
- `cogni_usr_` = user actor  
- `cogni_sys_` = system actor
- Prefix is parseable for routing/logging but auth always verifies against `key_hash`

### Auth Flow: Dual-Mode on Completions

```
POST /api/v1/chat/completions
  │
  ├─ Authorization: Bearer cogni_ag_sk_... → API key auth
  │   1. Extract key from header
  │   2. Hash, lookup in api_keys (WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()))
  │   3. Resolve actor_id → billing_account_id (existing actors table FK)
  │   4. Construct SessionUser-equivalent context (actor_id, billing_account_id, tenantId)
  │   5. Proceed to existing completion facade (unchanged)
  │
  └─ Cookie/Session → existing getSessionUser() (unchanged)
```

**No changes to the completion facade, graph execution, or billing pipeline.** The API key auth is a new entry point that resolves to the same `billing_account_id` context.

### Agent Self-Provisioning

Agents with `kind=agent` can create API keys for themselves via tool or API:

```
POST /api/v1/auth/api-keys
  Authorization: Bearer <parent_key_or_session>
  Body: { actorId?: UUID, displayName: string, scopes: string[], expiresIn?: string }
  
  Response: { keyId: UUID, key: "cogni_ag_sk_...", expiresAt: string }
  ⚠️ key is returned ONCE — not stored in plaintext
```

**Scoping rules:**
- User actors can create keys for themselves
- User actors can create keys for agent actors they own (where `parent_actor_id` = user's actor)
- Agent actors can create sub-keys with equal or narrower scopes (delegation)
- System actors are provisioned by node operators only

### Relationship to Agent Registry

The `graph_registry` (from proj.agent-eval-registry) tracks **what agents exist**. This task tracks **how agents authenticate**. They connect via `actor_id`:

```
graph_registry.graph_id  →  registered in catalog (what it does)
actors.id (kind=agent)   →  api_keys.actor_id (how it authenticates)
                         →  charge_receipts.actor_id (what it spends)
                         →  billing_account_id (who pays)
```

An agent's lifecycle becomes:
1. Registered in `graph_registry` (catalog sync from catalog.ts)
2. `actor_id` created (kind=agent, parent=operator user)
3. API key provisioned (bound to actor_id)
4. Agent calls `POST /api/v1/chat/completions` with Bearer key
5. Charges attributed to actor_id → billing_account_id
6. Eval scores tracked in Langfuse (keyed by graph_id)

### Relationship to x402

API key auth and x402 are **complementary, not competing**:

| Dimension | API Key Auth (this task) | x402 (proj.x402-e2e-migration) |
|---|---|---|
| Identity | actor_id (known, registered) | wallet address (pseudonymous) |
| Payment | Post-pay via billing_account credits | Pre-pay per-request USDC |
| Use case | Internal agents, CLI tools, node-to-node | External/anonymous agents, cross-org |
| Auth header | `Authorization: Bearer cogni_...` | `X-Payment: <x402_proof>` |

Both resolve to the same completion facade. The x402 shim from PR #646 (`synthetic SessionUser from wallet`) would instead create/lookup an actor with `kind=agent` and a wallet binding.

### Rate Limiting

Per-key rate limits (stored in `api_keys.rate_limit_rpm`) enforced at the route level:
- Default: 60 rpm for agent keys, 120 rpm for user keys
- Free-model keys: subject to OpenRouter global free-tier limits (50 req/day)
- Checked via Redis sliding window (existing pattern from scheduled runs)

## Scope

### In Scope (P0)
- `api_keys` table + migration
- API key create/revoke/list endpoints (`/api/v1/auth/api-keys`)
- Dual-mode auth on `POST /api/v1/chat/completions` (session OR Bearer key)
- Key hashing (argon2id), prefix-based identification
- Per-key rate limiting
- Audit logging (key usage → existing observability pipeline)

### Out of Scope
- OAuth 2.1 for MCP (proj.agentic-interop P0.1 — separate task)
- x402 payment integration (proj.x402-e2e-migration)
- Agent self-registration in graph_registry (proj.agent-eval-registry)
- Cross-node key federation
- Key rotation automation

## Dependencies

- **actors table must exist** — identity-model.md defines it, need to verify it's deployed
- **PR #772** (Doltgres in compose) — not blocking, but agent registry alignment
- **proj.agent-eval-registry** — graph_registry provides the catalog; this task provides the auth

## Test Plan

1. **Contract test:** API key CRUD (create, list, revoke)
2. **Contract test:** Bearer auth on completions → resolves actor_id → billing_account_id
3. **Contract test:** Revoked/expired keys return 401
4. **Contract test:** Rate limit enforcement (Redis sliding window)
5. **Stack test:** Full round-trip — create key → call completions → verify charge_receipt has actor_id
6. **Stack test:** Agent creates sub-key for itself (delegation)
7. **Negative:** Session auth still works (no regression)
8. **Negative:** Invalid/malformed keys return 401 (not 500)

## Security Considerations

- Keys hashed with argon2id (not bcrypt — faster verification for per-request auth)
- Plaintext key returned only at creation time
- `key_prefix` stored for identification in logs/UI (never the full key)
- RLS on api_keys via billing_account_id (tenant isolation)
- Constant-time comparison for key verification
- Max key length: 256 bytes (prevent abuse)
- Keys inherit actor's billing_account RLS — no cross-tenant access
