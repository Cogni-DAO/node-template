// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/policy`
 * Purpose: Subpath barrel for pure decision policies (no I/O, no SDK).
 * Scope: Currently re-exports the redeem policy. Future Capability A
 *   policies (close, exit) land alongside.
 * Invariants: PURE_POLICY_NO_IO — see individual modules.
 * Side-effects: none.
 * @public
 */

export {
  decideRedeem,
  REDEEM_PARENT_COLLECTION_ID_ZERO,
  type RedeemDecision,
  type RedeemFlavor,
  type RedeemMalformedReason,
  type RedeemPolicyInput,
  type RedeemSkipReason,
} from "./redeem.js";
