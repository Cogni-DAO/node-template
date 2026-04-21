// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/poly-trader-wallet`
 * Purpose: Constructs and memoizes the PrivyPolyTraderWalletAdapter from env so
 *   route handlers can consume it without importing `@/adapters/**` directly
 *   (architectural constraint enforced by eslint no-restricted-imports).
 * Scope: Bootstrap wiring only. Does not implement the port or read DB rows.
 * Invariants:
 *   - SEPARATE_PRIVY_APP: this module reads PRIVY_USER_WALLETS_* never PRIVY_APP_* (the operator-wallet triple).
 * Side-effects: IO (PrivyClient construction) on first call.
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @internal
 */

import type { PolyClobApiKeyCreds } from "@cogni/poly-wallet";
import { PrivyClient } from "@privy-io/node";
import type { Logger } from "pino";
import type { LocalAccount } from "viem";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { PrivyPolyTraderWalletAdapter } from "@/adapters/server/wallet";
import { serverEnv } from "@/shared/env/server-env";

export class WalletAdapterUnconfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `PolyTraderWalletAdapter not configured: missing env vars: ${missing.join(", ")}`
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
  logger: Logger
): PrivyPolyTraderWalletAdapter {
  if (cached) return cached;

  const env = serverEnv();
  const missing: string[] = [];
  const appId = env.PRIVY_USER_WALLETS_APP_ID;
  const appSecret = env.PRIVY_USER_WALLETS_APP_SECRET;
  const signingKey = env.PRIVY_USER_WALLETS_SIGNING_KEY;
  const aeadKeyHex = env.POLY_WALLET_AEAD_KEY_HEX;
  const aeadKeyId = env.POLY_WALLET_AEAD_KEY_ID;
  if (!appId) missing.push("PRIVY_USER_WALLETS_APP_ID");
  if (!appSecret) missing.push("PRIVY_USER_WALLETS_APP_SECRET");
  if (!signingKey) missing.push("PRIVY_USER_WALLETS_SIGNING_KEY");
  if (!aeadKeyHex) missing.push("POLY_WALLET_AEAD_KEY_HEX");
  if (!aeadKeyId) missing.push("POLY_WALLET_AEAD_KEY_ID");
  if (
    missing.length ||
    !appId ||
    !appSecret ||
    !signingKey ||
    !aeadKeyHex ||
    !aeadKeyId
  ) {
    throw new WalletAdapterUnconfiguredError(missing);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(aeadKeyHex)) {
    throw new Error(
      "POLY_WALLET_AEAD_KEY_HEX must be exactly 64 hex characters (AES-256-GCM)"
    );
  }
  const encryptionKey = Buffer.from(aeadKeyHex, "hex");

  const privyClient = new PrivyClient({
    appId,
    appSecret,
  });

  // v0 stub: returns synthetic CLOB L2 creds so the plumbing round-trip on
  // candidate-a can succeed without Polymarket reachability. Real derivation
  // (@polymarket/clob-client createOrDeriveApiKey) lands in a follow-up.
  // Gated behind POLY_WALLET_ALLOW_STUB_CREDS=1 so production paths can
  // never silently trade against placeholder creds.
  if (env.POLY_WALLET_ALLOW_STUB_CREDS !== "1") {
    throw new Error(
      "PolyTraderWalletAdapter has no real CLOB creds factory wired; " +
        "set POLY_WALLET_ALLOW_STUB_CREDS=1 to use the plumbing-only stub."
    );
  }

  const stubClobCredsFactory = async (
    _signer: LocalAccount
  ): Promise<PolyClobApiKeyCreds> => {
    logger.warn(
      { component: "poly-trader-wallet-bootstrap" },
      "poly.wallet.provision using STUB CLOB creds — NOT tradeable, plumbing test only"
    );
    return {
      key: "placeholder-key",
      secret: "placeholder-secret",
      passphrase: "placeholder-passphrase",
    };
  };

  cached = new PrivyPolyTraderWalletAdapter({
    privyClient,
    privySigningKey: signingKey,
    serviceDb: getServiceDb(),
    encryptionKey,
    encryptionKeyId: aeadKeyId,
    clobCredsFactory: stubClobCredsFactory,
    logger,
  });
  return cached;
}

/** For tests only — clears the memoized instance. */
export function __resetPolyTraderWalletAdapterForTests(): void {
  cached = null;
}
