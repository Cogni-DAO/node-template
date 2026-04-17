// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/port/polymarket-order-signer`
 * Purpose: Narrow EIP-712 typed-data signer port — decouples the Polymarket adapter from wallet-custody concerns.
 * Scope: Port interface only. Does not implement signing, does not import any wallet SDK, does not hold key material.
 * Invariants:
 *   - SIGNER_VIA_PORT: the Polymarket adapter depends on this interface only — never on Privy internals or env state.
 *   - NO_GENERIC_SIGNING: this port accepts a Polymarket-scoped EIP-712 typed-data payload only, not arbitrary calldata.
 * Side-effects: none (interface definition only)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/spec/operator-wallet.md
 * @public
 */

/**
 * Standard EIP-712 typed-data envelope. Matches the shape emitted by
 * `@polymarket/clob-client` when it asks the caller to sign an order.
 * Deliberately generic so this port does not import the CLOB SDK.
 */
export interface Eip712TypedData {
  /**
   * Domain separator — per EIP-712. For Polymarket CLOB orders on Polygon:
   *   `{ name: "Polymarket CTF Exchange", version: "1", chainId: 137, verifyingContract: "0x4bFb..." }`
   */
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: number;
    readonly verifyingContract: string;
  };
  /**
   * Struct definitions. The EIP-712 `EIP712Domain` member is optional on the
   * wire (many libraries inject it); implementations MUST accept both shapes.
   */
  readonly types: Readonly<
    Record<
      string,
      ReadonlyArray<{ readonly name: string; readonly type: string }>
    >
  >;
  /** Name of the root type being signed (must exist as a key in `types`). */
  readonly primaryType: string;
  /** The message payload. Field names must match the `types[primaryType]` struct. */
  readonly message: Readonly<Record<string, unknown>>;
}

/**
 * Narrow EIP-712 signer for Polymarket CLOB orders.
 *
 * The Polymarket CLOB adapter depends on this interface — not on `OperatorWalletPort`
 * or Privy SDK types directly — so that (a) the market-provider package has no
 * wallet-custody imports, and (b) future wallet backends (Privy, local keystore,
 * hardware wallet) can satisfy the same contract.
 */
export interface PolymarketOrderSigner {
  /**
   * Sign an EIP-712 typed-data payload representing a Polymarket CLOB order.
   * The signer MUST enforce that the chain scope is Polygon (eip155:137) —
   * passing a non-Polygon typedData SHOULD reject.
   *
   * @returns 0x-prefixed hex-encoded 65-byte signature.
   * @throws if the signer's chain scope does not match `typedData.domain.chainId`.
   */
  signPolymarketOrder(typedData: Eip712TypedData): Promise<`0x${string}`>;
}
