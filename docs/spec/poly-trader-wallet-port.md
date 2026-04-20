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
  /** viem LocalAccount that can sign EIP-712 order hashes. */
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
   * Provision a brand-new wallet for a tenant.
   * Idempotent: if the tenant already has an un-revoked connection, returns it.
   * The adapter chooses the backend (Privy today); callers do not pick.
   */
  provision(input: {
    billingAccountId: string;
    createdByUserId: string;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Mark a connection revoked. The adapter MAY also take backend-specific
   * action (e.g. Privy `DELETE wallet`) but MUST at minimum set
   * `poly_wallet_connections.revoked_at`. The next `resolve` for the same
   * tenant returns `null` until a new `provision` is called.
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
- `PROVISION_IS_IDEMPOTENT` — calling `provision` twice for the same tenant returns the same connection.
- `REVOKE_IS_DURABLE` — `revoked_at` is the authoritative kill-switch; the executor's `resolve` call is the only enforcement point.
- `SEPARATE_PRIVY_APP` — the Privy adapter MUST NOT read `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` (those are the system / operator-wallet app). It reads a distinct env scope; see § Env below.

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

- `provision({ billingAccountId, createdByUserId })`:
  1. `SELECT` existing un-revoked row; if present, re-derive and return (idempotent).
  2. `privyClient.wallets().create({ chain_type: "ethereum" })` → `{ walletId, address }`.
  3. `createViemAccount` → `LocalAccount`.
  4. `clobFactory(account)` → `ApiKeyCreds` (Polymarket `/auth/api-key` flow).
  5. `credentialEnvelope.encrypt(JSON.stringify(creds))` → `{ ciphertext, encryptionKeyId }`.
  6. `INSERT INTO poly_wallet_connections(...) VALUES (...)`.
  7. Return the `PolyTraderSigningContext`.

- `revoke({ billingAccountId, revokedByUserId })`:
  1. `UPDATE poly_wallet_connections SET revoked_at = now(), revoked_by_user_id = $2 WHERE billing_account_id = $1 AND revoked_at IS NULL`.
  2. Optional Phase B.1: call Privy `DELETE wallet` — deferred until we decide whether tenants may later re-claim the same address. Today `revoke` = soft-delete at the DB, the wallet remains in Privy unused.

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

**Load-bearing design decision.** The operator wallet and per-tenant wallets use **separate Privy apps**. Reasons:

1. **Blast radius** — compromise of the user-wallets app does not expose the operator wallet's USDC forwarding / AI-fee payment flow, and vice versa.
2. **Rate limits + billing** — Privy bills per-app. Per-tenant wallet create/sign volume would distort the operator-wallet app's usage signal, making anomaly detection useless.
3. **Audit trail** — Privy's per-app audit log is cleaner when each app has a single operational persona. System ops vs user-wallet ops are clearly labeled without custom instrumentation.
4. **Rotation + revocation** — rotating the system app's signing key (for AI-fee infrastructure maintenance) must not invalidate every user's trading wallet. Two apps = two independent rotation schedules.
5. **Compliance / custody posture** — the two populations may take different legal paths (operator is Cogni's own treasury; user wallets may need a distinct custody narrative). Separating apps keeps future flexibility.

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
| 1 | `PolyTraderWalletPort` interface defined in `packages/poly-wallet/src/port/` with the four invariants doc-pinned.                     |
| 2 | `PrivyPolyTraderWalletAdapter` in `packages/poly-wallet/src/adapters/privy/` implements all three methods; unit tests cover each.     |
| 3 | Adapter rejects any attempt to use `PRIVY_APP_ID` / `PRIVY_APP_SECRET` — enforced via typed config + a lint rule pointing at both.    |
| 4 | Component test: `provision(tenantA)` + `provision(tenantB)` return distinct `funderAddress`; `resolve(tenantA)` ≠ `resolve(tenantB)`. |
| 5 | Component test: calling `provision(tenantA)` twice returns the same `connectionId` (idempotent).                                     |
| 6 | Component test: `revoke(tenantA)` → `resolve(tenantA)` returns `null` on the next call.                                              |
| 7 | Component test: CLOB creds round-trip through the AEAD envelope and decrypt to the original `ApiKeyCreds`.                           |
| 8 | Tenant defense-in-depth test: direct DB tamper setting `billing_account_id` to the wrong tenant → `resolve` logs + returns `null`.   |

## Related

- [operator-wallet](./operator-wallet.md) — system-role wallet; **not** generalized
- [poly-multi-tenant-auth](./poly-multi-tenant-auth.md) — tenant-isolation contract + schema
- [tenant-connections](./tenant-connections.md) — AEAD envelope reused here
- [packages-architecture](./packages-architecture.md) — capability-package shape
- [operator-wallet adapter](../../packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts) — reference implementation for the Privy SDK usage patterns (wallet lookup, `createViemAccount`, signing-key authorization)
