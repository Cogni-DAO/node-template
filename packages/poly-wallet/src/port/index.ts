// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet/port`
 * Purpose: Barrel — re-export the port interface + types.
 * Scope: Types only; no runtime.
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
} from "./poly-trader-wallet.port";
