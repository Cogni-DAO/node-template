// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/providers/wallet.client`
 * Purpose: Wallet provider for EVM wallet connections using wagmi and RainbowKit.
 * Scope: Wraps app with WagmiProvider and RainbowKitProvider. Does not handle server-side rendering of wallet context.
 * Invariants: Uses canonical config; passes authenticationStatus to RainbowKitProvider.
 * Side-effects: none
 * Links: https://rainbowkit.com/docs/authentication
 * @public
 */

"use client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { RainbowKitSiweNextAuthProvider } from "@rainbow-me/rainbowkit-siwe-next-auth";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";

import { createAppDarkTheme, createAppLightTheme } from "./rainbowkit-theme";
import { config } from "./wagmi-config.client";

export function WalletProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Invariant: server and first client render must produce identical HTML.
  // next-themes resolves the actual theme only after mount, so we hardcode
  // "dark" pre-mount and switch to the real theme once mounted.
  // This avoids hydration errors while keeping WagmiProvider always present.
  useEffect(() => {
    setMounted(true);
  }, []);

  const rainbowKitTheme =
    mounted && resolvedTheme === "light"
      ? createAppLightTheme()
      : createAppDarkTheme();

  return (
    <WagmiProvider config={config}>
      <RainbowKitSiweNextAuthProvider
        getSiweMessageOptions={() => ({
          statement: "Sign in with Ethereum to the app.",
        })}
      >
        <RainbowKitProvider theme={rainbowKitTheme}>
          {children}
        </RainbowKitProvider>
      </RainbowKitSiweNextAuthProvider>
    </WagmiProvider>
  );
}
