"use client";

import type { ReactNode } from "react";
import type { Config } from "wagmi";

import { AuthProvider } from "./auth-provider";
import { QueryProvider } from "./query-provider";
import { WalletProvider } from "./wallet-provider";

/**
 * Composition of all platform providers for a Cogni node app.
 *
 * Order: Auth → Query → Wallet.
 * Query must wrap Wallet because wagmi depends on React Query.
 */
export function AppProviders({
  wagmiConfig,
  children,
}: {
  readonly wagmiConfig: Config;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <AuthProvider>
      <QueryProvider>
        <WalletProvider wagmiConfig={wagmiConfig}>{children}</WalletProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
