// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/auth/use-wallet-session-consistency`
 * Purpose: React hook to enforce consistency between the connected wallet and the NextAuth session.
 * Scope: Client-side only. Does not handle server-side validation.
 * Invariants: Signs out if wallet is disconnected or address mismatches session address.
 * Side-effects: IO (Triggers signOut() side effect)
 * Links: docs/AUTHENTICATION.md
 * @public
 */

import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useAccount } from "wagmi";

import {
  computeWalletSessionAction,
  normalizeWalletAddress,
} from "@/shared/auth";

export function useWalletSessionConsistency(): void {
  const { address, isConnected } = useAccount();
  const { data: session, status } = useSession();

  useEffect(() => {
    // Only run check when session is authenticated
    if (status !== "authenticated" || !session) return;

    const action = computeWalletSessionAction({
      isConnected,
      connectedAddress: normalizeWalletAddress(address),
      sessionAddress: normalizeWalletAddress(
        (session.user as { walletAddress?: string | null })?.walletAddress
      ),
    });

    if (action === "sign_out") {
      void signOut({ redirect: false });
    }
  }, [address, isConnected, session, status]);
}
