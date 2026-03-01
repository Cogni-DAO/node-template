// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/review/view`
 * Purpose: Client component for epoch review admin page — review allocations, adjust final units, sign & finalize.
 * Scope: Thin composition of EpochDetail + useSignEpoch + useReviewEpochs. Does not perform server-side logic or direct DB access.
 * Invariants: WRITE_ROUTES_APPROVER_GATED (UI gate via isApprover prop, server enforces). BigInt units displayed via Number() for presentation only.
 * Side-effects: IO (via useReviewEpochs, useSignEpoch hooks, allocation PATCH)
 * Links: src/features/governance/types.ts, work/items/task.0119.epoch-signer-ui.md
 * @public
 */

"use client";

import { CheckCircle2, FileSignature, Loader2, Lock } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback } from "react";
import { Button } from "@/components";
import { EpochDetail } from "@/features/governance/components/EpochDetail";
import { useReviewEpochs } from "@/features/governance/hooks/useReviewEpochs";
import { useSignEpoch } from "@/features/governance/hooks/useSignEpoch";
import type { EpochView } from "@/features/governance/types";

interface ReviewViewProps {
  readonly isApprover: boolean;
}

export function ReviewView({ isApprover }: ReviewViewProps): ReactElement {
  const { data: reviewEpochs, isLoading, error } = useReviewEpochs();

  if (!isApprover) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-12 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <div>
          <h2 className="font-semibold text-lg">Not Authorized</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Only ledger approvers can access the epoch review page. Connect an
            approver wallet via SIWE to proceed.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <h2 className="font-semibold text-destructive text-lg">
          Error loading review data
        </h2>
        <p className="text-muted-foreground text-sm">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (isLoading || !reviewEpochs) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-64 rounded-md bg-muted" />
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">Epoch Review</h1>
        <p className="text-muted-foreground text-sm">
          Review allocations, adjust final units, and sign to finalize.
        </p>
      </div>

      {reviewEpochs.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            No epochs currently in review.
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Epochs will appear here when they transition from open to review.
          </p>
        </div>
      ) : (
        reviewEpochs.map((epoch) => (
          <ReviewEpochSection key={epoch.id} epoch={epoch} />
        ))
      )}
    </div>
  );
}

// ── Per-epoch review section ─────────────────────────────────────────────────

function ReviewEpochSection({
  epoch,
}: {
  readonly epoch: EpochView;
}): ReactElement {
  const { state, sign, reset } = useSignEpoch(epoch.id);

  const handleSign = useCallback(() => {
    void sign();
  }, [sign]);

  return (
    <div className="space-y-4">
      <EpochDetail epoch={epoch} />

      {/* Sign & Finalize action */}
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        {state.phase === "IDLE" && (
          <Button onClick={handleSign}>
            <FileSignature className="mr-2 h-4 w-4" />
            Sign & Finalize
          </Button>
        )}

        {state.isInFlight && (
          <Button disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {state.phase === "FETCHING_DATA" && "Preparing..."}
            {state.phase === "AWAITING_SIGNATURE" && "Awaiting wallet..."}
            {state.phase === "SUBMITTING" && "Submitting..."}
          </Button>
        )}

        {state.phase === "SUCCESS" && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Finalization started (workflow: {state.workflowId})</span>
          </div>
        )}

        {state.phase === "ERROR" && (
          <div className="flex items-center gap-3">
            <div className="text-destructive text-sm">{state.errorMessage}</div>
            <Button variant="outline" size="sm" onClick={reset}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
