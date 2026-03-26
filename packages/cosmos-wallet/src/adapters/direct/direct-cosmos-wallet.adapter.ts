// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/adapters/direct`
 * Purpose: Mnemonic-based Cosmos wallet for dev/testing and automated deployments.
 * Scope: Adapter — implements CosmosWalletPort using @cosmjs/stargate. Does NOT handle browser-based signing.
 * Invariants:
 *   - DEV_AND_AUTOMATION_ONLY: Mnemonic signing is for dev, CI, and automated DAO operations.
 *   - MNEMONIC_FROM_ENV: Mnemonic loaded from environment, never hardcoded.
 *   - SINGLE_CHAIN: One adapter instance per chain. No multi-chain state.
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 */

import type { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import type { SigningStargateClient } from "@cosmjs/stargate";
import type {
  CosmosBalance,
  CosmosTxResult,
  CosmosWalletConfig,
  CosmosWalletPort,
} from "../../port/cosmos-wallet.port.js";

export class DirectCosmosWalletAdapter implements CosmosWalletPort {
  private client: SigningStargateClient | null = null;
  private wallet: DirectSecp256k1HdWallet | null = null;
  private address: string | null = null;

  constructor(
    private readonly config: CosmosWalletConfig,
    private readonly mnemonic: string
  ) {
    if (!mnemonic || mnemonic.split(" ").length < 12) {
      throw new Error(
        "DirectCosmosWalletAdapter requires a valid BIP-39 mnemonic (12+ words)"
      );
    }
  }

  private async ensureClient(): Promise<{
    client: SigningStargateClient;
    address: string;
  }> {
    if (this.client && this.address) {
      return { client: this.client, address: this.address };
    }

    // Dynamic imports to keep @cosmjs as peer dependencies
    const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
    const { SigningStargateClient, GasPrice } = await import(
      "@cosmjs/stargate"
    );

    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic, {
      prefix: this.config.prefix,
    });

    const [account] = await this.wallet.getAccounts();
    if (!account) {
      throw new Error("No accounts found in wallet");
    }
    this.address = account.address;

    this.client = await SigningStargateClient.connectWithSigner(
      this.config.rpcEndpoint,
      this.wallet,
      { gasPrice: GasPrice.fromString(this.config.gasPrice) }
    );

    return { client: this.client, address: this.address };
  }

  async getAddress(): Promise<string> {
    const { address } = await this.ensureClient();
    return address;
  }

  async getBalance(denom?: string): Promise<CosmosBalance> {
    const { client, address } = await this.ensureClient();
    const balance = await client.getBalance(
      address,
      denom ?? this.config.defaultDenom
    );
    return { amount: balance.amount, denom: balance.denom };
  }

  async sendTokens(
    recipient: string,
    amount: string,
    denom?: string
  ): Promise<CosmosTxResult> {
    const { client, address } = await this.ensureClient();
    const coin = {
      amount,
      denom: denom ?? this.config.defaultDenom,
    };

    const result = await client.sendTokens(address, recipient, [coin], "auto");

    return {
      txHash: result.transactionHash,
      height: result.height,
      gasUsed: result.gasUsed.toString(),
      code: result.code,
    };
  }

  async fundDeployment(
    deploymentId: string,
    amount: string
  ): Promise<CosmosTxResult> {
    const { client, address } = await this.ensureClient();

    // Akash deployment escrow deposit uses MsgDepositDeployment
    // The deploymentId format is "owner/dseq" (e.g., "akash1.../12345")
    const [owner, dseq] = deploymentId.split("/");
    if (!owner || !dseq) {
      throw new Error(
        `Invalid deploymentId format "${deploymentId}". Expected "owner/dseq".`
      );
    }

    const msg = {
      typeUrl: "/akash.deployment.v1beta3.MsgDepositDeployment",
      value: {
        id: { owner, dseq: BigInt(dseq) },
        amount: { denom: this.config.defaultDenom, amount },
        depositor: address,
      },
    };

    const result = await client.signAndBroadcast(address, [msg], "auto");

    return {
      txHash: result.transactionHash,
      height: result.height,
      gasUsed: result.gasUsed.toString(),
      code: result.code,
    };
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.wallet = null;
    this.address = null;
  }
}
