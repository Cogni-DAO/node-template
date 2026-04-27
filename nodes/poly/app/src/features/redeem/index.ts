// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem`
 * Purpose: Barrel for the event-driven redeem feature (task.0388).
 * @public
 */

export {
  type RedeemCatchupDeps,
  runRedeemCatchup,
} from "./redeem-catchup";
export {
  RedeemSubscriber,
  type RedeemSubscriberDeps,
} from "./redeem-subscriber";
export {
  RedeemWorker,
  type RedeemWorkerDeps,
} from "./redeem-worker";
export {
  type ResolvedRedeemCandidate,
  resolveRedeemCandidatesForCondition,
} from "./resolve-redeem-decision";
