// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/grants.validate.internal.v1.contract`
 * Purpose: Contract for validating an execution grant against a graph (scheduler-worker → node app).
 * Scope: Wire format for POST /api/internal/grants/{grantId}/validate. Does not implement the route or hold business logic.
 * Invariants:
 *   - Bearer SCHEDULER_API_TOKEN required
 *   - 403 on invalid/expired/revoked/scope-mismatch with machine-readable `error` code
 *   - All consumers use z.infer types
 * Side-effects: none
 * Links: /api/internal/grants/[grantId]/validate route, docs/spec/scheduler.md, task.0280
 * @internal
 */

import { z } from "zod";

export const InternalValidateGrantInputSchema = z.object({
  graphId: z.string(),
});

export const InternalValidateGrantOutputSchema = z.object({
  ok: z.literal(true),
  grant: z.object({
    id: z.string(),
    userId: z.string(),
    billingAccountId: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
});

export const GrantValidationErrorCode = z.enum([
  "grant_not_found",
  "grant_expired",
  "grant_revoked",
  "grant_scope_mismatch",
]);

export const InternalValidateGrantErrorSchema = z.object({
  ok: z.literal(false),
  error: GrantValidationErrorCode,
});

export const internalValidateGrantOperation = {
  id: "grants.validate.internal.v1",
  summary: "Validate execution grant for graph (scheduler-worker → node app)",
  description:
    "Internal endpoint called by scheduler-worker to validate a grant before graph execution. Node owns grants table; worker owns no DB credentials.",
  input: InternalValidateGrantInputSchema,
  output: InternalValidateGrantOutputSchema,
} as const;

export type InternalValidateGrantInput = z.infer<
  typeof InternalValidateGrantInputSchema
>;
export type InternalValidateGrantOutput = z.infer<
  typeof InternalValidateGrantOutputSchema
>;
export type InternalValidateGrantError = z.infer<
  typeof InternalValidateGrantErrorSchema
>;
