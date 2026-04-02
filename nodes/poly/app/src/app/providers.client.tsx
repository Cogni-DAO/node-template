// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/providers.client`
 * Purpose: Client boundary wrapper that composes platform providers with node-local wagmiConfig.
 * Scope: Thin client component. Does not contain business logic or own provider implementations.
 * Invariants: wagmiConfig must stay inside a "use client" boundary — it calls getDefaultConfig() which is client-only.
 * Side-effects: none
 * Links: packages/node-app/src/providers/app-providers.tsx, src/shared/web3/wagmi.config.ts
 * @public
 */

"use client";

import { AppProviders } from "@cogni/node-app/providers";
import type { ReactNode } from "react";

import { wagmiConfig } from "@/shared/web3/wagmi.config";

export function Providers({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <AppProviders wagmiConfig={wagmiConfig}>{children}</AppProviders>;
}
