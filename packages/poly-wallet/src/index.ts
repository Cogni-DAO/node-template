// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet`
 * Purpose: Package root — re-export the port surface. Adapters are
 *   accessed via subpath imports (`@cogni/poly-wallet/adapters/privy`)
 *   so consumers opt into vendor deps only when wiring an adapter.
 * Scope: Barrel only.
 * Invariants: none (re-export).
 * Side-effects: none.
 * Links: docs/spec/poly-trader-wallet-port.md
 * @public
 */

export type {
  AuthorizationFailure,
  AuthorizedSigningContext,
  AuthorizeIntentResult,
  OrderIntentSummary,
  PolyClobApiKeyCreds,
  PolyTraderSigningContext,
  PolyTraderWalletPort,
} from "./port";
