// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/decision-to-enqueue-input`
 * Purpose: Translate a Capability A `ResolvedRedeemCandidate` into the
 *   `EnqueueRedeemJobInput` shape consumed by the port. `redeem` decisions
 *   become work the worker will pick up; `skip` decisions become `'skipped'`
 *   rows whose only role is to back the dashboard's lifecycle projection
 *   (Open vs History tab membership). `malformed` returns `null` — those
 *   are code defects that need a Class-A page, not a row.
 * Scope: Pure function. No I/O.
 * Side-effects: none
 * Links: docs/design/poly-positions.md § Dust-state UI semantics, work/items/task.0388
 * @public
 */

import type { RedeemLifecycleState } from "@/core";
import type { EnqueueRedeemJobInput } from "@/ports";

import type { ResolvedRedeemCandidate } from "./resolve-redeem-decision";

export function decisionToEnqueueInput(
  funderAddress: `0x${string}`,
  c: ResolvedRedeemCandidate
): EnqueueRedeemJobInput | null {
  const base = {
    funderAddress,
    conditionId: c.conditionId,
    positionId: c.positionId.toString(),
    outcomeIndex: c.outcomeIndex,
  };

  if (c.decision.kind === "redeem") {
    return {
      ...base,
      flavor: c.decision.flavor,
      indexSet: c.decision.indexSet.map((b) => b.toString()),
      expectedShares: c.decision.expectedShares.toString(),
      expectedPayoutUsdc: c.decision.expectedPayoutUsdc.toString(),
      lifecycleState: "winner",
    };
  }

  if (c.decision.kind === "skip") {
    const lifecycleState: RedeemLifecycleState = (() => {
      switch (c.decision.reason) {
        case "losing_outcome":
          return "loser";
        case "zero_balance":
          return "redeemed";
        case "market_not_resolved":
          return "resolving";
        case "read_failed":
          return "unresolved";
      }
    })();
    return {
      ...base,
      flavor: c.negativeRisk ? "neg-risk-parent" : "binary",
      indexSet: [],
      expectedShares: "0",
      expectedPayoutUsdc: "0",
      lifecycleState,
      status: "skipped",
    };
  }

  return null;
}
