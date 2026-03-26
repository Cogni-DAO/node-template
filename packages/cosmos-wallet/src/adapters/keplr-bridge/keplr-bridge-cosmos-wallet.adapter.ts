// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/adapters/keplr-bridge`
 * Purpose: Scaffold for browser-based Keplr wallet signing.
 * Scope: Adapter stub — production OAuth/browser signing flow. Does NOT implement signing yet.
 * Invariants:
 *   - BROWSER_ONLY: This adapter runs in browser context (window.keplr).
 *   - NO_KEY_MATERIAL: All signing delegated to Keplr extension.
 *   - SCAFFOLD_ONLY: Not yet implemented — placeholder for future work.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type {
  CosmosBalance,
  CosmosTxResult,
  CosmosWalletPort,
} from "../../port/cosmos-wallet.port.js";

/**
 * Keplr browser extension wallet adapter.
 *
 * This adapter bridges to the Keplr browser extension for signing Cosmos
 * transactions. It's the production path for user-facing Akash deployments
 * where the user authenticates with their own wallet.
 *
 * NOT YET IMPLEMENTED — scaffold only. Privy does not support Cosmos chains,
 * so this adapter fills the gap for browser-based signing.
 */
export class KeplrBridgeCosmosWalletAdapter implements CosmosWalletPort {
  constructor(private readonly chainId: string) {}

  async getAddress(): Promise<string> {
    throw new Error(
      "KeplrBridgeCosmosWalletAdapter not yet implemented. " +
        `Chain: ${this.chainId}. ` +
        "Requires browser context with Keplr extension installed."
    );
  }

  async getBalance(_denom?: string): Promise<CosmosBalance> {
    throw new Error("KeplrBridgeCosmosWalletAdapter not yet implemented.");
  }

  async sendTokens(
    _recipient: string,
    _amount: string,
    _denom?: string
  ): Promise<CosmosTxResult> {
    throw new Error("KeplrBridgeCosmosWalletAdapter not yet implemented.");
  }

  async fundDeployment(
    _deploymentId: string,
    _amount: string
  ): Promise<CosmosTxResult> {
    throw new Error("KeplrBridgeCosmosWalletAdapter not yet implemented.");
  }

  async disconnect(): Promise<void> {
    // No-op for scaffold
  }
}
