// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/auth/WalletConnectButton`
 * Purpose: Renders the canonical RainbowKit connect button.
 * Scope: Client-side only. Used in the app header. Does not handle wallet selection UI.
 * Invariants: Must be wrapped in WagmiProvider and SessionProvider. Sign-out is explicit via RainbowKit UI, not background effects.
 * Side-effects: none
 * Links: docs/AUTHENTICATION.md
 * @public
 */

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type React from "react";

export function WalletConnectButton(): React.JSX.Element {
  return <ConnectButton />;
}
