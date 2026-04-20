// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet`
 * Purpose: Barrel + lazy factory for the `PrivyPolyTraderWalletAdapter`. Reads
 *   the USER-WALLETS Privy app creds + AEAD key from env, constructs the
 *   adapter on first call, memoizes the instance for the process lifetime.
 *   Throws typed `WalletAdapterUnconfiguredError` when any required env is
 *   missing so the route layer can surface a 503 instead of crashing.
 * Scope: Bootstrap wiring only; no business logic.
 * Invariants:
 *   - SEPARATE_PRIVY_APP: this module reads PRIVY_USER_WALLETS_*, NEVER
 *     PRIVY_APP_* (the operator-wallet triple).
 * Side-effects: IO (PrivyClient construction) on first call.
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @internal
 */

import { PrivyClient } from "@privy-io/node";
import type { PolyClobApiKeyCreds } from "@cogni/poly-wallet";
import type { Logger } from "pino";
import type { LocalAccount } from "viem";

import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { serverEnv } from "@/shared/env/server-env";

import { PrivyPolyTraderWalletAdapter } from "./privy-poly-trader-wallet.adapter";

export { PrivyPolyTraderWalletAdapter } from "./privy-poly-trader-wallet.adapter";

export class WalletAdapterUnconfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `PolyTraderWalletAdapter not configured: missing env vars: ${missing.join(", ")}`,
    );
    this.name = "WalletAdapterUnconfiguredError";
  }
}

let cached: PrivyPolyTraderWalletAdapter | null = null;

/**
 * Lazy-construct + memoize the adapter. Follow-up will move this into the
 * main container; standalone factory keeps the first flight-able commit small.
 *
 * @throws {WalletAdapterUnconfiguredError} when env is missing.
 */
export function getPolyTraderWalletAdapter(
  logger: Logger,
): PrivyPolyTraderWalletAdapter {
  if (cached) return cached;

  const env = serverEnv();
  const missing: string[] = [];
  if (!env.PRIVY_USER_WALLETS_APP_ID) missing.push("PRIVY_USER_WALLETS_APP_ID");
  if (!env.PRIVY_USER_WALLETS_APP_SECRET)
    missing.push("PRIVY_USER_WALLETS_APP_SECRET");
  if (!env.PRIVY_USER_WALLETS_SIGNING_KEY)
    missing.push("PRIVY_USER_WALLETS_SIGNING_KEY");
  if (!env.POLY_WALLET_AEAD_KEY_HEX) missing.push("POLY_WALLET_AEAD_KEY_HEX");
  if (!env.POLY_WALLET_AEAD_KEY_ID) missing.push("POLY_WALLET_AEAD_KEY_ID");
  if (missing.length) throw new WalletAdapterUnconfiguredError(missing);

  const encryptionKey = Buffer.from(env.POLY_WALLET_AEAD_KEY_HEX, "hex");
  if (encryptionKey.length !== 32) {
    throw new Error(
      "POLY_WALLET_AEAD_KEY_HEX must decode to 32 bytes (AES-256-GCM)",
    );
  }

  const privyClient = new PrivyClient({
    appId: env.PRIVY_USER_WALLETS_APP_ID,
    appSecret: env.PRIVY_USER_WALLETS_APP_SECRET,
  });

  // v0 stub: returns synthetic CLOB L2 creds so the plumbing round-trip on
  // candidate-a can succeed without Polymarket reachability. Real derivation
  // (@polymarket/clob-client createOrDeriveApiKey) lands in a follow-up.
  const stubClobCredsFactory = async (
    _signer: LocalAccount,
  ): Promise<PolyClobApiKeyCreds> => ({
    key: "placeholder-key",
    secret: "placeholder-secret",
    passphrase: "placeholder-passphrase",
  });

  cached = new PrivyPolyTraderWalletAdapter({
    privyClient,
    privySigningKey: env.PRIVY_USER_WALLETS_SIGNING_KEY,
    serviceDb: getServiceDb(),
    encryptionKey,
    encryptionKeyId: env.POLY_WALLET_AEAD_KEY_ID,
    clobCredsFactory: stubClobCredsFactory,
    logger,
  });
  return cached;
}

/** For tests only — clears the memoized instance. */
export function __resetPolyTraderWalletAdapterForTests(): void {
  cached = null;
}
