// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/port`
 * Purpose: Cosmos SDK wallet abstraction for AKT funding on Akash Network.
 * Scope: Port interface only — no runtime dependencies. Does NOT contain adapter implementations.
 * Invariants:
 *   - COSMOS_ONLY: This port handles Cosmos SDK chains (ATOM, AKT, OSMO). No EVM.
 *   - KEY_NEVER_IN_APP: Adapters must use external signers (Keplr, Ledger, mnemonic file).
 *   - DENOMINATION_EXPLICIT: All amounts include denom. No implicit "default token".
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type { z } from "zod";
import type {
  cosmosBalanceSchema,
  cosmosTxResultSchema,
  cosmosWalletConfigSchema,
} from "./cosmos-wallet.schemas.js";

export type CosmosBalance = z.infer<typeof cosmosBalanceSchema>;
export type CosmosTxResult = z.infer<typeof cosmosTxResultSchema>;
export type CosmosWalletConfig = z.infer<typeof cosmosWalletConfigSchema>;

/**
 * Port for interacting with Cosmos SDK chains.
 * Primary use case: funding Akash deployments with AKT tokens.
 */
export interface CosmosWalletPort {
  /** Return the bech32 address of the wallet (e.g., akash1...) */
  getAddress(): Promise<string>;

  /** Query token balance for a specific denomination */
  getBalance(denom?: string): Promise<CosmosBalance>;

  /** Send tokens to a recipient address. Returns tx hash. */
  sendTokens(
    recipient: string,
    amount: string,
    denom?: string
  ): Promise<CosmosTxResult>;

  /**
   * Fund an Akash deployment escrow account.
   * This is a specialized send to the deployment's escrow address.
   */
  fundDeployment(deploymentId: string, amount: string): Promise<CosmosTxResult>;

  /** Disconnect and clean up resources */
  disconnect(): Promise<void>;
}
