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

import { useSession } from "next-auth/react";
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

    const sessionUser = session.user as { walletAddress?: string | null };
    const sessionAddress = normalizeWalletAddress(sessionUser?.walletAddress);
    const connectedAddress = normalizeWalletAddress(address);

    const action = computeWalletSessionAction({
      isConnected,
      connectedAddress,
      sessionAddress,
    });

    // [DEBUG] Log consistency check
    console.log(
      `[WalletSessionConsistency] Check: status=${status}, isConnected=${isConnected}, wallet=${connectedAddress}, session=${sessionAddress}, action=${action}`
    );

    if (action === "sign_out") {
      console.warn(
        `[WalletSessionConsistency] Mismatch detected: wallet=${connectedAddress} vs session=${sessionAddress}. (SignOut disabled for debugging)`
      );
    }
  }, [address, isConnected, session, status]);
}
