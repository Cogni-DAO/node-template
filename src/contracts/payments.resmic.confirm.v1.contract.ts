// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/payments.resmic.confirm.v1.contract`
 * Purpose: Contract for confirming Resmic payments via HTTP API.
 * Scope: Defines request/response schemas for /api/v1/payments/resmic/confirm; does not perform persistence or authentication.
 * Invariants: amountUsdCents must be positive integer; clientPaymentId must be UUID.
 * Side-effects: none
 * Notes: Billing account is derived from session server-side; not provided in input.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { z } from "zod";

export const resmicConfirmOperation = {
  id: "payments.resmic.confirm.v1",
  summary: "Confirm Resmic payment and credit billing account",
  description:
    "Credits billing account balance after a Resmic payment confirmation using client-provided idempotency keys.",
  input: z.object({
    amountUsdCents: z.number().int().positive(),
    clientPaymentId: z.string().uuid(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    billingAccountId: z.string(),
    balanceCredits: z.number().nonnegative(),
  }),
} as const;

export type ResmicConfirmInput = z.infer<typeof resmicConfirmOperation.input>;
export type ResmicConfirmOutput = z.infer<typeof resmicConfirmOperation.output>;
