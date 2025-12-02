// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/auth/WalletConnectButton`
 * Purpose: RainbowKit connect button with responsive variant support for mobile overflow prevention.
 * Scope: Client-side only. Used in header. Does not handle wallet selection UI or persistence.
 * Invariants: Must be wrapped in WagmiProvider and SessionProvider; variant prop controls display mode.
 * Side-effects: none
 * Notes: Compact variant uses accountStatus="avatar", showBalance=false, max-w-[8.5rem] (approved).
 * Links: docs/AUTHENTICATION.md, docs/HANDOFF_WALLET_BUTTON_STABILITY.md
 * @public
 */

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type React from "react";

import { cn } from "@/shared/util";

interface WalletConnectButtonProps {
  /**
   * Variant controls the display mode:
   * - 'default': Full button with address and balance when connected
   * - 'compact': Avatar-only, no balance, for mobile layouts
   */
  readonly variant?: "default" | "compact";
  /**
   * Optional className for layout adjustments (max-w, shrink-0, etc.)
   */
  readonly className?: string;
}

export function WalletConnectButton({
  variant = "default",
  className,
}: WalletConnectButtonProps = {}): React.JSX.Element {
  if (variant === "compact") {
    return (
      // eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- Approved compact wallet max-width for mobile overflow prevention
      <div className={cn("max-w-[8.5rem] shrink-0", className)}>
        <ConnectButton accountStatus="avatar" showBalance={false} />
      </div>
    );
  }

  return (
    <div className={className}>
      <ConnectButton />
    </div>
  );
}
