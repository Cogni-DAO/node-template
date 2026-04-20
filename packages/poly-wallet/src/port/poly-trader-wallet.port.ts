// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet/port`
 * Purpose: Per-tenant Polymarket CLOB signing-context port — credential broker
 *   + grant-aware intent authorization + intent-typed withdraw. Backend-agnostic.
 * Scope: Interface + types only. No runtime, no lifecycle, no env reads.
 *   Adapters live under `src/adapters/*`.
 * Invariants:
 *   - TENANT_SCOPED — every method takes a `billingAccountId`.
 *   - NO_GENERIC_SIGNING — no `signMessage(bytes)` / `signTransaction(calldata)` surface.
 *   - KEY_NEVER_IN_APP — adapters never hold raw private key material in the app process.
 *   - FAIL_CLOSED_ON_RESOLVE — `resolve` returns `null` (never a stub) on failure.
 *   - AUTHORIZED_SIGNING_ONLY — `PolymarketClobAdapter.placeOrder` accepts the
 *     branded `AuthorizedSigningContext`, not the raw one. Scope/cap bypass is a
 *     compile error.
 *   - SEPARATE_PRIVY_APP — adapters for Privy backends MUST read the
 *     user-wallets Privy app creds (`PRIVY_USER_WALLETS_*`), never the
 *     operator-wallet app creds (`PRIVY_APP_*`).
 * Side-effects: none (interface definition only).
 * Links: docs/spec/poly-trader-wallet-port.md, docs/spec/poly-multi-tenant-auth.md,
 *        work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @public
 */

import type { LocalAccount } from "viem";

/**
 * Polymarket CLOB L2 API credentials.
 * Shape mirrors `@polymarket/clob-client`'s `ApiKeyCreds`; duplicated here so
 * this package stays clob-client-free (callers construct the adapter with the
 * returned creds).
 */
export interface PolyClobApiKeyCreds {
  readonly key: string;
  readonly secret: string;
  readonly passphrase: string;
}

/**
 * Minimal order-intent summary the port needs to enforce scopes + caps.
 * Duplicated on purpose from the trading module's richer `OrderIntent` so this
 * package stays free of CLOB-specific trading types.
 */
export interface OrderIntentSummary {
  readonly side: "BUY" | "SELL";
  /** Decimal USDC amount, not atomic units. */
  readonly usdcAmount: number;
  readonly marketConditionId: string;
}

/**
 * Signing context for a single tenant's Polymarket CLOB trading.
 * All fields are returned together because any caller that needs one always
 * needs the others.
 *
 * The viem `LocalAccount` coupling is intentional: `@polymarket/clob-client`
 * consumes viem signers natively, and every plausible backend terminates at a
 * viem-shaped account. If a future backend cannot produce one, the port
 * evolves — not a leak to pre-emptively abstract.
 */
export interface PolyTraderSigningContext {
  readonly account: LocalAccount;
  readonly clobCreds: PolyClobApiKeyCreds;
  /** Checksummed funder address; MUST equal `account.address` for `SignatureType.EOA`. */
  readonly funderAddress: `0x${string}`;
  /** Opaque correlation id; 1:1 with `poly_wallet_connections.id`. */
  readonly connectionId: string;
}

/**
 * Brand preventing untyped contexts from reaching `placeOrder`.
 * Only `authorizeIntent` returns an `AuthorizedSigningContext`.
 */
declare const __authorizedBrand: unique symbol;

export type AuthorizedSigningContext = PolyTraderSigningContext & {
  readonly [__authorizedBrand]: true;
  /** `poly_wallet_grants.id` that authorized this intent. */
  readonly grantId: string;
  /** The exact intent the grant was checked against; placeOrder MUST NOT mutate. */
  readonly authorizedIntent: OrderIntentSummary;
};

/**
 * Reason `authorizeIntent` returned `{ ok: false, ... }`.
 * Logged at the adapter boundary; coordinator writes a
 * `poly.mirror.decision reason=<value>` observability row.
 */
export type AuthorizationFailure =
  | "no_connection"
  | "no_active_grant"
  | "grant_expired"
  | "grant_revoked"
  | "scope_missing"
  | "cap_exceeded_per_order"
  | "cap_exceeded_daily"
  | "cap_exceeded_hourly_fills"
  | "backend_unreachable";

export type AuthorizeIntentResult =
  | { readonly ok: true; readonly context: AuthorizedSigningContext }
  | { readonly ok: false; readonly reason: AuthorizationFailure };

/**
 * Per-tenant signing context for Polymarket CLOB trading.
 * See `docs/spec/poly-trader-wallet-port.md` for the full contract.
 */
export interface PolyTraderWalletPort {
  /**
   * Resolve the active signing context for a tenant.
   * Returns `null` fail-closed on missing / revoked / backend-unreachable.
   * Callers: read-only surfaces (balance checks, agent-status endpoints).
   * Trading flows MUST go through `authorizeIntent` instead.
   */
  resolve(billingAccountId: string): Promise<PolyTraderSigningContext | null>;

  /**
   * Read-only lookup of the funder address.
   * No Privy call, no decryption. Cheap enough for every page render.
   */
  getAddress(billingAccountId: string): Promise<`0x${string}` | null>;

  /**
   * Provision a brand-new wallet for a tenant.
   * Idempotent under concurrency via a Postgres advisory lock on
   * `billing_account_id`. Partial failures roll back so no orphan backend
   * wallets are ever linked to a missing DB row.
   *
   * External deps at provision time: backend custody API (Privy) AND
   * Polymarket CLOB `/auth/api-key`. Either unreachable → throws; callers
   * retry.
   */
  provision(input: {
    billingAccountId: string;
    createdByUserId: string;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Mark a connection revoked. Halt-future-only; in-flight orders complete.
   * Does NOT delete the backend wallet or sweep funds. Next `provision`
   * creates a new connection with a new address.
   */
  revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void>;

  /**
   * Resolve + grant-check in one call. The only source of
   * `AuthorizedSigningContext`, which `placeOrder` requires.
   */
  authorizeIntent(
    billingAccountId: string,
    intent: OrderIntentSummary,
  ): Promise<AuthorizeIntentResult>;

  /**
   * Move USDC.e from the tenant's trading wallet to an external address.
   * Intent-typed (token locked to USDC.e on Polygon for v0); the adapter
   * encodes the ERC-20 `transfer` calldata so the port's `NO_GENERIC_SIGNING`
   * invariant is preserved.
   */
  withdrawUsdc(input: {
    billingAccountId: string;
    destination: `0x${string}`;
    /** Atomic units (USDC.e has 6 decimals). */
    amountAtomic: bigint;
    requestedByUserId: string;
  }): Promise<{ txHash: `0x${string}` }>;

  /**
   * Rotate the Polymarket CLOB L2 API credentials for a tenant.
   * Wallet address and backend-wallet id are unchanged.
   * Scheduled-rotation cadence is a separate ops task.
   */
  rotateClobCreds(input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext>;
}
