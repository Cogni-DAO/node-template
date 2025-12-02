// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/auth/SafeWalletConnectButton`
 * Purpose: SSR-safe dynamic wrapper for WalletConnectButton.
 * Scope: Client-side only. Handles dynamic loading. Does not render wallet logic on server.
 * Invariants: No loading placeholder (prevents duplicate flash); forwards all props including variant; prevents hydration mismatch.
 * Side-effects: none
 * Notes: Exported as "WalletConnectButton" via components/index.ts for convenience.
 * Links: src/components/kit/auth/WalletConnectButton.tsx, docs/HANDOFF_WALLET_BUTTON_STABILITY.md
 * @public
 */

"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { WalletConnectButton } from "./WalletConnectButton";

type WalletConnectButtonProps = ComponentProps<typeof WalletConnectButton>;

const DynamicWalletConnectButton = dynamic(
  () => import("./WalletConnectButton").then((mod) => mod.WalletConnectButton),
  {
    ssr: false,
    loading: () => null, // No placeholder to prevent duplicate flash
  }
);

export function SafeWalletConnectButton(
  props: WalletConnectButtonProps
): React.JSX.Element {
  return <DynamicWalletConnectButton {...props} />;
}
