---
id: poly-trader-wallet-port
type: spec
title: "Poly Trader Wallet Port: per-tenant signing + credential broker for Polymarket CLOB"
status: draft
spec_state: proposed
trust: draft
summary: Port/adapter contract for per-tenant Polymarket trading wallets. `PolyTraderWalletPort` resolves `(billing_account_id) → { signer, clob_creds, funder_address }` for the CLOB adapter. Phase B ships `PrivyPolyTraderWalletAdapter` using a Privy app dedicated to user wallets (separate from the system / operator-wallet Privy app). Future adapters (Safe+4337, Turnkey) plug into the same port.
read_when: Wiring per-user Polymarket trading, adding a new signing backend, provisioning per-tenant wallets, or reviewing the separation between system and user Privy credentials.
implements: proj.poly-copy-trading
owner: derekg1729
created: 2026-04-20
verified: 2026-04-20
tags: [poly, polymarket, wallets, multi-tenant, privy, port-adapter]
---

# Poly Trader Wallet Port

> Per-tenant signing context for Polymarket CLOB orders. Narrow, typed, backend-agnostic. The port sits next to — not inside — the system-role [`OperatorWalletPort`](./operator-wallet.md), and its adapters use a **separate Privy app** from the operator wallet so credential rotation, billing, audit, and compromise blast radius are isolated by construction.

## Why a new port

Phase B needs per-tenant Polymarket trading wallets. Three ways to get there were considered; only one survived review:

| Approach                                                                                              | Verdict                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extend `OperatorWalletPort`** with `resolvePolyAccount(billingAccountId)` / `signPolymarketOrder`.  | **Rejected.** Violates `OperatorWalletPort`'s `NO_GENERIC_SIGNING` invariant — the port is deliberately intent-only. Also conflates the system-tenant operator wallet with per-user wallets, which have different blast-radius and billing semantics. |
| **Inline per-tenant signer resolution in `bootstrap/capabilities/poly-trade.ts`.**                    | **Rejected.** Works for Phase B but leaks Privy SDK coupling + env-shape assumptions into `nodes/poly/app`, making a future backend swap (Safe+4337, Turnkey) a cross-cutting rewrite. Violates `VENDOR_CONTAINMENT`.    |
| **New `PolyTraderWalletPort` in a shared package, `PrivyPolyTraderWalletAdapter` as the Phase B impl.** | **Chosen.** Narrow interface, backend-agnostic, testable without real Privy, future adapters plug in without touching callers. Matches the capability-package shape pinned in [packages-architecture.md](./packages-architecture.md). |

**The port is new, not a rename of `OperatorWalletPort`.** The operator wallet is a system-role actuator (intent-only outbound payments for AI-fee forwarding + Splits distribution). The poly-trader wallet is a per-tenant signer. They have different invariants, different lifecycle, different caller sets, and — importantly — **different Privy apps**. Generalizing one to cover the other would weaken the security model.

## Key references

|              |                                                                           |                                                 |
| ------------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| **Spec**     | [operator-wallet](./operator-wallet.md)                                   | System-role wallet; stays separate               |
| **Spec**     | [poly-multi-tenant-auth](./poly-multi-tenant-auth.md)                     | Tenant-isolation contract + `poly_wallet_*` schema |
| **Spec**     | [packages-architecture](./packages-architecture.md)                       | Capability-package shape this port follows       |
| **Spec**     | [tenant-connections](./tenant-connections.md)                             | AEAD envelope reused for CLOB creds-at-rest      |
| **Task**     | [task.0318](../../work/items/task.0318.poly-wallet-multi-tenant-auth.md)  | Phase B lifecycle carrier                        |

## Port

### Interface

```ts
// packages/poly-wallet/src/port/poly-trader-wallet.port.ts

/**
 * Signing context for a single tenant's Polymarket CLOB trading.
 * All three fields are needed together by `PolymarketClobAdapter`; any
 * caller that requests one always needs the others, so they are returned
 * as an atomic bundle rather than as separate getter methods.
 */
export interface PolyTraderSigningContext {
  /**
   * viem `LocalAccount` that can sign EIP-712 order hashes.
   *
   * The viem dependency here is intentional: `@polymarket/clob-client` already
   * consumes viem signers natively, and every plausible adapter (Privy today,
   * Safe+4337 tomorrow) terminates at a viem-shaped account. Treating this as
   * a port-level coupling keeps the CLOB adapter construction trivial. If a
   * future backend cannot produce a viem `LocalAccount`, the port evolves —
   * but that is not a leak to be fixed speculatively.
   */
  readonly account: LocalAccount;
  /** Polymarket CLOB L2 API credentials (key + secret + passphrase). */
  readonly clobCreds: ApiKeyCreds;
  /** Checksummed funder address — MUST equal `account.address` for SignatureType.EOA. */
  readonly funderAddress: `0x${string}`;
  /** Opaque correlation id for observability; maps 1:1 to `poly_wallet_connections.id`. */
  readonly connectionId: string;
}

/**
 * Resolve a per-tenant signing context for Polymarket CLOB trading.
 *
 * Invariants:
 *   - TENANT_SCOPED: every call takes a `billingAccountId`; cross-tenant resolution returns `null`.
 *   - NO_GENERIC_SIGNING: the port has no `signMessage(bytes)` / `signTransaction(calldata)` surface.
 *   - KEY_NEVER_IN_APP: no adapter implementation may hold raw private key material in the app process.
 *   - CONTEXT_IS_READ_ONLY: the returned bundle is frozen; callers must not mutate.
 */
export interface PolyTraderWalletPort {
  /**
   * Resolve the active signing context for a tenant.
   * Returns `null` if the tenant has no un-revoked `poly_wallet_connections` row
   * OR if the connection exists but the adapter cannot materialize credentials
   * (e.g. Privy HSM unreachable). Callers treat `null` as fail-closed.
   */
  resolve(billingAccountId: string): Promise<PolyTraderSigningContext | null>;

  /**
   * Read-only lookup of the funder address for a tenant, without decrypting
   * CLOB creds or constructing a signer. Used by the dashboard / onboarding
   * UX to show the deposit address. Returns `null` for unknown / revoked
   * tenants. Cheap enough to call on every page render.
   */
  getAddress(billingAccountId: string): Promise<`0x${string}` | null>;

  /**
   * Provision a brand-new wallet for a tenant.
   * Idempotent under concurrency: implementations MUST hold a tenant-scoped
   * lock (e.g. a Postgres advisory lock keyed on `billing_account_id`) for
   * the entire create-wallet → derive-creds → insert-row sequence, so two
   * concurrent calls do not create two backend wallets. If the tenant
   * already has an un-revoked connection, returns it unchanged.
   * The adapter chooses the backend (Privy today); callers do not pick.
   *
   * External dependencies at provision-time: backend custody API (Privy)
   * AND Polymarket CLOB `/auth/api-key`. Either being unreachable fails
   * the call; callers retry. Partial success (Privy wallet created but
   * CLOB creds derivation failed) is rolled back inside the lock so the
   * next retry starts clean — see § Behavior.
   */
  provision(input: {
    billingAccountId: string;
    createdByUserId: string;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Mark a connection revoked. Sets `poly_wallet_connections.revoked_at`;
   * does NOT delete the backend wallet (the address may still hold funds).
   * The next `resolve` for the same tenant returns `null`; the next
   * `provision` creates a *new* connection with a *new* address. Funds
   * on the old address must be withdrawn manually by the tenant — the
   * port does not attempt a sweep. Callers are responsible for warning
   * the user before calling `revoke` on a funded wallet.
   */
  revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void>;
}
```

### Invariants (`CODE_REVIEW_CRITERIA`)

- `TENANT_SCOPED` — every method takes a `billingAccountId`. No "current" state inside the adapter.
- `NO_GENERIC_SIGNING` — the port does not expose a free-form `signMessage` / `signTransaction` method.
- `KEY_NEVER_IN_APP` — no raw private key material in the app process; backend holds custody.
- `FAIL_CLOSED_ON_RESOLVE` — `resolve` returns `null` (never a stub signer) when credentials are unavailable; the executor treats `null` as "skip this tenant this tick."
- `TENANT_DEFENSE_IN_DEPTH` — after any RLS-scoped DB read, the adapter verifies `row.billing_account_id === input.billingAccountId` before returning, mirroring `DrizzleConnectionBrokerAdapter.resolve`.
- `CREDS_ENCRYPTED_AT_REST` — CLOB API creds stored in `poly_wallet_connections.clob_api_key_ciphertext` via the existing `connections` AEAD envelope.
- `PROVISION_IS_IDEMPOTENT` — calling `provision` twice for the same tenant (concurrently or sequentially) returns the same connection. Implementations MUST serialize the create-wallet → derive-creds → insert sequence per tenant (advisory lock); partial failures roll back inside the lock so orphaned backend wallets cannot be created.
- `REVOKE_IS_DURABLE` — `revoked_at` is the authoritative kill-switch; the executor's `resolve` call is the only enforcement point. Revocation is halt-future-only: in-flight orders complete, funds on the revoked address remain until the user withdraws.
- `SEPARATE_PRIVY_APP` — the Privy adapter MUST NOT read `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` (those are the system / operator-wallet app). It reads a distinct env scope; see § Env below. Enforcement: a dep-cruiser rule at `packages/poly-wallet/` forbids imports of `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` identifiers from any module under `src/`, and typed env loading uses a separate Zod schema with the `PRIVY_USER_WALLETS_*` shape.

## Adapter: `PrivyPolyTraderWalletAdapter`

The Phase B default implementation. Uses Privy **server wallets** (`privy.walletApi.create({ chain_type: "ethereum" })`) — one per tenant, fully app-custodial from Privy's perspective, Cogni-controlled from the app's perspective.

### Dependencies (constructor-injected)

```ts
interface PrivyPolyTraderWalletAdapterDeps {
  /** Privy app distinct from the operator-wallet app. See § Env. */
  privyClient: PrivyClient;
  /** Privy signing key for the user-wallets app. */
  privySigningKey: string;
  /** BYPASSRLS DB handle for the cross-tenant reads this adapter performs. */
  serviceDb: ServiceDb;
  /** AEAD envelope used by `@cogni/connections` for at-rest encryption. */
  credentialEnvelope: CredentialEnvelope;
  /** Polymarket CLOB client factory — the adapter calls it to derive L2 creds at provision time. */
  clobFactory: (signer: LocalAccount) => Promise<ApiKeyCreds>;
  /** Logger. */
  logger: Logger;
}
```

### Behavior

- `resolve(billingAccountId)`:
  1. `SELECT * FROM poly_wallet_connections WHERE billing_account_id = $1 AND revoked_at IS NULL LIMIT 1` on `serviceDb`.
  2. Defense-in-depth equality check on `row.billing_account_id`.
  3. `createViemAccount(privyClient, { walletId: row.privy_wallet_id, address: row.address, authorizationContext: { authorization_private_keys: [privySigningKey] } })`.
  4. Decrypt `row.clob_api_key_ciphertext` via `credentialEnvelope.decrypt`.
  5. Return `{ account, clobCreds, funderAddress: row.address, connectionId: row.id }`.
  6. On any failure: log a sanitized warning (no ciphertext, no walletId in the message) and return `null`.

- `getAddress(billingAccountId)`:
  1. `SELECT address FROM poly_wallet_connections WHERE billing_account_id = $1 AND revoked_at IS NULL LIMIT 1`.
  2. Defense-in-depth equality check on `row.billing_account_id`.
  3. Return `row.address` or `null`. No Privy calls, no decryption.

- `provision({ billingAccountId, createdByUserId })`:
  1. `BEGIN` a transaction.
  2. `SELECT pg_advisory_xact_lock(hashtext($1))` — tenant-scoped lock; held until COMMIT/ROLLBACK.
  3. `SELECT` existing un-revoked row for this tenant; if present, COMMIT + return the signing context (idempotent, no Privy call).
  4. `privyClient.wallets().create({ chain_type: "ethereum" })` → `{ walletId, address }`. **External dependency: Privy HSM must be reachable.**
  5. `createViemAccount(...)` → `LocalAccount`.
  6. `clobFactory(account)` → `ApiKeyCreds` via Polymarket `/auth/api-key`. **External dependency: CLOB API must be reachable.**
  7. `credentialEnvelope.encrypt(JSON.stringify(creds))` → `{ ciphertext, encryptionKeyId }`.
  8. `INSERT INTO poly_wallet_connections(...) VALUES (...)`.
  9. `COMMIT` and return the `PolyTraderSigningContext`.
  - **Any failure at steps 4–8** rolls back the transaction, releasing the advisory lock. The unsued Privy wallet from step 4 is *not* automatically deleted — an out-of-band reconciler (future ops task) sweeps Privy wallets with no matching DB row older than 24h. This is the cheapest correctness story: callers retry `provision`; retries either hit step 3 (if a prior attempt committed) or get a fresh wallet (if not); orphans are bounded and cleaned asynchronously.

- `revoke({ billingAccountId, revokedByUserId })`:
  1. `UPDATE poly_wallet_connections SET revoked_at = now(), revoked_by_user_id = $2 WHERE billing_account_id = $1 AND revoked_at IS NULL`.
  2. No Privy-side action. The backend wallet is retained because it may still hold user funds. A subsequent `provision` for the same tenant creates a *new* connection with a *new* address; funds on the old address are the tenant's responsibility to withdraw manually.
  - **UX contract**: callers (the dashboard revoke button, API handlers) MUST surface a confirmation warning that names the current balance at the address and explicitly states "funds will NOT be transferred to a new wallet" before invoking `revoke`.

### What the adapter deliberately does NOT do

- **No on-chain allowance flow.** Approvals (USDC + CTF `setApprovalForAll`) are Phase B3's "onboarding UX" concern. The adapter returns a `LocalAccount`; the onboarding surface uses it to run the existing `scripts/experiments/approve-polymarket-allowances.ts` pattern.
- **No grant enforcement.** `poly_wallet_grants` (caps / scopes / expiry) is the `mirror-coordinator`'s concern (Phase B6), checked separately from `resolve`. The port returns credentials; the caller decides whether to use them.
- **No shared-state memoization.** Every `resolve` call re-reads the DB. Upstream may LRU-cache the result keyed on `connectionId`; the port is pure.

## Schema

The port is backed by the `poly_wallet_connections` table defined in [poly-multi-tenant-auth § Schema](./poly-multi-tenant-auth.md). This spec does not redefine it; it pins the port's read/write contract on that schema.

Relevant columns:
- `billing_account_id` — tenant key
- `privy_wallet_id` — backend reference (Privy server-wallet id)
- `address` — checksummed EOA (funder)
- `clob_api_key_ciphertext` + `encryption_key_id` — encrypted L2 creds
- `created_by_user_id`, `revoked_at`, `revoked_by_user_id`
- Unique: one un-revoked row per `billing_account_id`

## Env — separation of system and user-wallet Privy apps

**Load-bearing design decision.** The operator wallet and per-tenant wallets use **separate Privy apps**. The argument is **Privy-side operational isolation**, not intra-cluster blast radius (both apps' API keys live in the same k8s secret store, so a cluster compromise takes both).

1. **Privy-side single-app failure modes.** Privy's rate limits, anomaly-detection triggers, and admin-initiated disables are enforced per-app. If a bug in the AI-fee forwarding code pumps operator txns and Privy rate-limits or disables that app, co-located user wallets die with it. Separating apps bounds that failure to one population.
2. **Per-app audit cleanliness.** Privy's audit log is per-app. System-ops traffic (Splits distribution, OpenRouter top-ups) vs. user-wallet traffic (CLOB order signs, per-tenant provision calls) is clearly separable without custom instrumentation — one app = one operational persona.
3. **Independent rotation cadence.** Rotating the system app's signing key (scheduled AI-fee infrastructure maintenance, incident response for the operator wallet) must not invalidate every user's trading wallet. Two apps = two independent rotation schedules.
4. **Privy product-tier alignment.** Server-wallet volume for user trading and server-wallet volume for operator AI-fee forwarding grow at different rates and may eventually qualify for different Privy plans / SLAs. Pre-separating avoids a forced migration later.
5. **Compliance / custody posture (speculative).** The two populations may take different legal paths — operator is Cogni's own treasury; user wallets may need a distinct custody narrative. Low-probability but cheap to preserve by starting with two apps.

### Env variables (new)

```
# Existing — operator wallet (system tenant). Unchanged.
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_SIGNING_KEY=

# New — per-tenant Polymarket trading wallets. Distinct Privy app.
PRIVY_USER_WALLETS_APP_ID=
PRIVY_USER_WALLETS_APP_SECRET=
PRIVY_USER_WALLETS_SIGNING_KEY=
```

Candidate-a + preview + production all get the new `PRIVY_USER_WALLETS_*` triple wired through `scripts/ci/deploy-infra.sh` and the candidate-flight-infra workflow. Dev / `.env.local.example` ships placeholder values. Missing or empty values fail-closed: `PrivyPolyTraderWalletAdapter.resolve` returns `null` and the coordinator skips the tenant.

## Relation to `OperatorWalletPort`

| Axis                | `OperatorWalletPort`                                      | `PolyTraderWalletPort`                                             |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Surface             | Intent-only (`distributeSplit`, `fundOpenRouterTopUp`)    | Credential-broker (`resolve`, `provision`, `revoke`)               |
| Tenant              | Single system tenant (`COGNI_SYSTEM_BILLING_ACCOUNT_ID`)  | Any `billing_account_id`                                           |
| Custody             | One Privy server-wallet, env-configured                   | N Privy server-wallets, DB-tracked per tenant                      |
| Privy app           | `PRIVY_APP_ID` (system)                                   | `PRIVY_USER_WALLETS_APP_ID` (users)                                |
| Signing             | Not exposed on the port (calldata encoded inside)         | Returned as viem `LocalAccount` for CLOB adapter composition        |
| Lifecycle           | Provisioned once via `scripts/provision-operator-wallet`  | Provisioned per-tenant on first Polymarket opt-in                  |

They do not share a base interface and should not be merged. If a future need surfaces for e.g. per-user treasury payouts, the right move is a third narrow port, not a generalized "WalletPort."

## Future adapters

The port is designed to accept additional backends without caller churn:

- **`SafePolyTraderWalletAdapter`** — for the future OSS-hardening task. `resolve` returns a session-key-backed `LocalAccount` instead of a Privy one; `provision` deploys a Safe + grants a scoped session key. The `PolyTraderSigningContext` shape is unchanged.
- **`TurnkeyPolyTraderWalletAdapter`** — plug-compatible alternative if Cogni-DAO later prefers MPC custody.

`poly_wallet_connections` may grow a `backend` column (`CHECK IN ('privy', 'safe_4337', 'turnkey')`) at that point. Today the table is implicitly single-backend (Privy) and the column is not needed.

## Acceptance

| # | Check                                                                                                                                 |
|---|---------------------------------------------------------------------------------------------------------------------------------------|
| 1 | `PolyTraderWalletPort` interface defined in `packages/poly-wallet/src/port/` with all invariants doc-pinned.                          |
| 2 | `PrivyPolyTraderWalletAdapter` in `packages/poly-wallet/src/adapters/privy/` implements all four methods; unit tests cover each.      |
| 3 | **`SEPARATE_PRIVY_APP` enforcement shipped in B2**: a dep-cruiser rule forbids `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` identifiers anywhere under `packages/poly-wallet/src/`; env loading uses a Zod schema scoped to `PRIVY_USER_WALLETS_*`. CI fails on violation. |
| 4 | **Concurrent-provision test**: two simultaneous `provision(tenantA)` calls (promise-level `Promise.all`) return the same `connectionId`; Privy is called exactly once. Validates the advisory-lock contract. |
| 5 | Component test: `provision(tenantA)` + `provision(tenantB)` return distinct `funderAddress`; `resolve(tenantA)` ≠ `resolve(tenantB)`. |
| 6 | Component test: calling `provision(tenantA)` sequentially twice returns the same `connectionId` (idempotent, DB-hit-only).            |
| 7 | Component test: `revoke(tenantA)` → `resolve(tenantA)` returns `null` on the next call; `getAddress(tenantA)` also returns `null`.   |
| 8 | Component test: CLOB creds round-trip through the AEAD envelope and decrypt to the original `ApiKeyCreds`.                           |
| 9 | Tenant defense-in-depth test: direct DB tamper setting `billing_account_id` to the wrong tenant → `resolve` logs + returns `null`.   |
| 10 | **Privy-unreachable fail-closed test**: mock a Privy client that throws on `.create` → `provision` returns the thrown error with no DB row inserted; a second `provision` call succeeds cleanly (advisory lock released on rollback). |
| 11 | **Operational runbook**: `docs/guides/poly-wallet-provisioning.md` documents how to create the user-wallets Privy app, populate the three `PRIVY_USER_WALLETS_*` secrets in candidate-a / preview / production, and verify the separation from the operator-wallet app. Link from this spec's § Related. |

## Related

- [operator-wallet](./operator-wallet.md) — system-role wallet; **not** generalized
- [poly-multi-tenant-auth](./poly-multi-tenant-auth.md) — tenant-isolation contract + schema
- [tenant-connections](./tenant-connections.md) — AEAD envelope reused here
- [packages-architecture](./packages-architecture.md) — capability-package shape
- [operator-wallet adapter](../../packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts) — reference implementation for the Privy SDK usage patterns (wallet lookup, `createViemAccount`, signing-key authorization)
