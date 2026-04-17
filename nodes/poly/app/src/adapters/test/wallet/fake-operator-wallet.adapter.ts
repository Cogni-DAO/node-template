// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/wallet/fake-operator-wallet`
 * Purpose: Fake operator wallet adapter for deterministic testing.
 * Scope: In-memory test double returning configurable responses. Does not perform real Privy or chain calls.
 * Invariants: Deterministic behavior based on configuration; tracks call params for assertions.
 * Side-effects: none (in-memory only)
 * Links: Implements OperatorWalletPort
 * @public
 */

import type { Eip712TypedData } from "@cogni/operator-wallet";
import type { OperatorWalletPort, TransferIntent } from "@/ports";

const FAKE_OPERATOR_ADDRESS = "0x1111111111111111111111111111111111111111";
const FAKE_SPLIT_ADDRESS = "0x2222222222222222222222222222222222222222";
const FAKE_TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAKE_EIP712_SIGNATURE = `0x${"b".repeat(130)}` as const;

export class FakeOperatorWalletAdapter implements OperatorWalletPort {
  private address = FAKE_OPERATOR_ADDRESS;
  private splitAddress = FAKE_SPLIT_ADDRESS;
  private distributeSplitResult = FAKE_TX_HASH;
  private fundTopUpResult = FAKE_TX_HASH;
  private signPolymarketResult: `0x${string}` = FAKE_EIP712_SIGNATURE;

  /** Last params passed to distributeSplit */
  public lastDistributeSplitToken: string | undefined;
  /** Last params passed to fundOpenRouterTopUp */
  public lastFundTopUpIntent: TransferIntent | undefined;
  /** Last params passed to signPolymarketOrder */
  public lastSignPolymarketTypedData: Eip712TypedData | undefined;

  async getAddress(): Promise<string> {
    return this.address;
  }

  getSplitAddress(): string {
    return this.splitAddress;
  }

  async distributeSplit(token: string): Promise<string> {
    this.lastDistributeSplitToken = token;
    return this.distributeSplitResult;
  }

  async fundOpenRouterTopUp(intent: TransferIntent): Promise<string> {
    this.lastFundTopUpIntent = intent;
    return this.fundTopUpResult;
  }

  async signPolymarketOrder(
    typedData: Eip712TypedData
  ): Promise<`0x${string}`> {
    this.lastSignPolymarketTypedData = typedData;
    return this.signPolymarketResult;
  }

  // ── Test helpers ──

  setAddress(address: string): void {
    this.address = address;
  }

  setSplitAddress(splitAddress: string): void {
    this.splitAddress = splitAddress;
  }

  setDistributeSplitResult(txHash: string): void {
    this.distributeSplitResult = txHash;
  }

  setFundTopUpResult(txHash: string): void {
    this.fundTopUpResult = txHash;
  }

  setSignPolymarketResult(signature: `0x${string}`): void {
    this.signPolymarketResult = signature;
  }

  reset(): void {
    this.address = FAKE_OPERATOR_ADDRESS;
    this.splitAddress = FAKE_SPLIT_ADDRESS;
    this.distributeSplitResult = FAKE_TX_HASH;
    this.fundTopUpResult = FAKE_TX_HASH;
    this.signPolymarketResult = FAKE_EIP712_SIGNATURE;
    this.lastDistributeSplitToken = undefined;
    this.lastFundTopUpIntent = undefined;
    this.lastSignPolymarketTypedData = undefined;
  }
}

// ============================================================================
// Test Singleton Accessor (APP_ENV=test only)
// ============================================================================

let _testInstance: FakeOperatorWalletAdapter | null = null;

export function getTestOperatorWallet(): FakeOperatorWalletAdapter {
  if (!_testInstance) {
    _testInstance = new FakeOperatorWalletAdapter();
  }
  return _testInstance;
}

export function resetTestOperatorWallet(): void {
  if (_testInstance) {
    _testInstance.reset();
  }
}
