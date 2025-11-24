// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/payments.resmic.summary.v1.contract`
 * Purpose: Contract for fetching Resmic credits balance and ledger summary.
 * Scope: Defines response schema for /api/v1/payments/resmic/summary; does not resolve auth or persistence.
 * Invariants: Ledger entries ordered newest first; createdAt serialized as ISO string.
 * Side-effects: none
 * Notes: Billing account resolved from session on server.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { z } from "zod";

const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  amount: z.number(),
  balanceAfter: z.number(),
  reason: z.string(),
  reference: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const resmicSummaryOperation = {
  id: "payments.resmic.summary.v1",
  summary: "Fetch Resmic credits balance and ledger entries",
  description:
    "Returns billing account balance and recent credit ledger entries for the authenticated account.",
  input: z.object({
    limit: z.number().int().positive().max(100).optional(),
  }),
  output: z.object({
    billingAccountId: z.string(),
    balanceCredits: z.number().nonnegative(),
    ledger: z.array(ledgerEntrySchema),
  }),
} as const;

export type ResmicSummaryInput = z.infer<typeof resmicSummaryOperation.input>;
export type ResmicSummaryOutput = z.infer<typeof resmicSummaryOperation.output>;
export type ResmicLedgerEntryDto = z.infer<typeof ledgerEntrySchema>;
