// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/providers/wagmi-config.client`
 * Purpose: Canonical Wagmi + RainbowKit configuration (Client Only).
 * Scope: Shared web3 configuration used by the WalletProvider. Does not export server-safe config.
 * Invariants: ssr:false (client-only mode); skeleton overlay in WalletConnectButton gates hydration.
 * Side-effects: none
 * Notes: TODO: wagmi cookie SSR (cookieStorage + initialState) to eliminate disconnected phase. See wagmi.sh/react/guides/ssr
 * Links: https://rainbowkit.com/docs/installation, https://wagmi.sh/react/guides/ssr
 * @public
 */

"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";

import { clientEnv } from "@/shared/env";
import { CHAIN } from "@/shared/web3";

const env = clientEnv();

export const config = getDefaultConfig({
  appName: "Cogni Template",
  projectId: env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "YOUR_PROJECT_ID",
  chains: [CHAIN],
  // Client-only mode: wagmi hydration gated by skeleton overlay in WalletConnectButton
  ssr: false,
});
