"use client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { RainbowKitSiweNextAuthProvider } from "@rainbow-me/rainbowkit-siwe-next-auth";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Config } from "wagmi";
import { WagmiProvider } from "wagmi";

import { createAppDarkTheme, createAppLightTheme } from "./rainbowkit-theme";

/**
 * Nested component that handles RainbowKit theme switching.
 * Isolates theme changes from WagmiProvider to prevent Hydrate errors.
 */
function RainbowKitThemeProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const theme = useMemo(
    () =>
      mounted && resolvedTheme === "light"
        ? createAppLightTheme()
        : createAppDarkTheme(),
    [mounted, resolvedTheme]
  );

  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}

export function WalletProvider({
  wagmiConfig,
  children,
}: {
  readonly wagmiConfig: Config;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitSiweNextAuthProvider
        getSiweMessageOptions={() => ({
          statement: "Sign in with Ethereum to the app.",
        })}
      >
        <RainbowKitThemeProvider>{children}</RainbowKitThemeProvider>
      </RainbowKitSiweNextAuthProvider>
    </WagmiProvider>
  );
}
