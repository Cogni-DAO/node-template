// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/web3/wagmi.config`
 * Purpose: Static wagmi configuration for wallet connections with SSR support.
 * Scope: Server-importable. Built directly with `wagmi.createConfig` (no
 *   RainbowKit imports) so the server `layout.tsx` can import this module
 *   to compute `cookieToInitialState` without poisoning the RSC server
 *   module graph.
 * Invariants:
 *   - MUST NOT import from `@rainbow-me/rainbowkit` — that package is
 *     flagged `"use client"` and would break Next 15 static-page-data
 *     collection of framework routes (e.g. `/_not-found`).
 *   - SSR enabled with cookieStorage; single active chain (CHAIN);
 *     WalletConnect projectId from env (optional).
 * Side-effects: none (config creation only)
 * Notes: RainbowKit consumes this config inside the client `Providers`
 *   boundary via `<RainbowKitProvider>` — see `app/providers.client.tsx`.
 *   Pattern follows the canonical wagmi App Router SSR guide:
 *   https://wagmi.sh/react/guides/ssr and
 *   https://github.com/rainbow-me/rainbowkit/tree/main/examples/with-next-app
 *   Connectors:
 *     - `injected` — every browser-extension wallet (MetaMask, Rabby, etc.)
 *     - `coinbaseWallet` — Coinbase Smart Wallet (passkey-based, no app
 *       install on mobile, single-prompt SIWE via EIP-5792 wallet_connect
 *       capability when supported by RainbowKit). `preference: "all"`
 *       lets users pick smart wallet OR the Coinbase Wallet app.
 *     - `walletConnect` (optional) — mobile wallet pairing via QR / deep
 *       link. `metadata.redirect` is set lazily from `window.location.origin`
 *       so mobile wallets auto-return to this app after sign instead of
 *       stranding the user in MetaMask. Server-side renders skip the
 *       redirect (origin not available) — wagmi rebuilds connectors on
 *       client hydration with the real value.
 * @public
 */

import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

import { clientEnv } from "@/shared/env/client";
import { CHAIN } from "./evm-wagmi";

const APP_NAME = "Cogni Resy";

const projectId = clientEnv().NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const browserOrigin =
  typeof window !== "undefined" ? window.location.origin : undefined;

const wcMetadata = browserOrigin
  ? {
      name: APP_NAME,
      description: APP_NAME,
      url: browserOrigin,
      icons: [`${browserOrigin}/favicon.ico`],
      redirect: {
        universal: browserOrigin,
      },
    }
  : undefined;

const connectors = [
  injected(),
  coinbaseWallet({ appName: APP_NAME, preference: "all" }),
  ...(projectId
    ? [
        walletConnect({
          projectId,
          showQrModal: true,
          ...(wcMetadata ? { metadata: wcMetadata } : {}),
        }),
      ]
    : []),
];

/**
 * Static wagmi configuration for wallet connections.
 *
 * SSR-enabled with cookieStorage to prevent IndexedDB hydration errors.
 * WalletConnect projectId is optional — app degrades to injected +
 * Coinbase Smart Wallet if missing.
 */
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  transports: {
    [CHAIN.id]: http(),
  },
});
