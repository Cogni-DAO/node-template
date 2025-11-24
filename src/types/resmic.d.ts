// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `resmic` (ambient types)
 * Purpose: Minimal type declarations for the Resmic SDK lacking published types.
 * Scope: Provides compile-time support for CryptoPayment component and chain/token constants.
 * Invariants: Types are best-effort and should be expanded when upstream types are available.
 */

declare module "resmic" {
  import type { FC } from "react";

  export interface ChainConfig {
    id: number;
    name: string;
  }

  export interface TokenConfig {
    name: string;
    chainId: number;
  }

  export const Chains: Record<string, ChainConfig> & {
    Sepolia: ChainConfig;
  };

  export const Tokens: Record<string, TokenConfig> & {
    USDT: TokenConfig;
  };

  export interface CryptoPaymentProps {
    Address: string;
    Tokens: TokenConfig[] | Record<string, TokenConfig>;
    Chains: Record<string, ChainConfig>;
    Amount: number;
    noOfBlockConformation?: number;
    setPaymentStatus?: (status: boolean) => void;
    Style?: Record<string, string>;
  }

  export const CryptoPayment: FC<CryptoPaymentProps>;
}
