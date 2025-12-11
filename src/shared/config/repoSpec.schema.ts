// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/config/repoSpec.schema`
 * Purpose: Zod schemas and derived types for .cogni/repo-spec.yaml validation.
 * Scope: Defines schema for governance-managed payment configuration; validates structure at runtime; does not perform I/O or business logic.
 * Invariants: Chain names and token names are constrained to known values; receiving_address must be valid EVM format; provider must be non-empty.
 * Side-effects: none
 * Notes: Sepolia is test-only; production repos must use Base. Once tests use ephemeral configs, Sepolia may be removed from RepoSpecChainName enum.
 * Links: .cogni/repo-spec.yaml, docs/PAYMENTS_DESIGN.md
 * @public
 */

import { z } from "zod";

/**
 * Allowed chain names in repo-spec.
 * Sepolia: Test-only, used in temporary test fixtures
 * Base: Production chain for deployed nodes
 *
 * @deprecated Sepolia support will be removed once all tests use ephemeral repo-specs
 */
export const RepoSpecChainName = z.enum(["Sepolia", "Base"]);
export type RepoSpecChainName = z.infer<typeof RepoSpecChainName>;

/**
 * Allowed token names in repo-spec.
 * Currently only USDC is supported for inbound payments.
 */
export const RepoSpecTokenName = z.enum(["USDC"]);
export type RepoSpecTokenName = z.infer<typeof RepoSpecTokenName>;

/**
 * Schema for payments_in.credits_topup configuration.
 * Validates inbound payment settings for USDC credit top-ups.
 */
export const creditsTopupSpecSchema = z.object({
  /** Payment provider identifier (e.g., "cogni-usdc-backend-v1") */
  provider: z.string().min(1, "Provider must be a non-empty string"),

  /** EVM address receiving inbound payments (DAO wallet) */
  receiving_address: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Receiving address must be a valid EVM address (0x + 40 hex chars)"
    ),

  /** Optional: List of allowed chain names for payments (default: inferred from chain_id) */
  allowed_chains: z.array(RepoSpecChainName).optional(),

  /** Optional: List of allowed token names for payments (default: ["USDC"]) */
  allowed_tokens: z.array(RepoSpecTokenName).optional(),
});

export type CreditsTopupSpec = z.infer<typeof creditsTopupSpecSchema>;

/**
 * Schema for full .cogni/repo-spec.yaml structure (payment-relevant subset).
 * Only validates fields used by payment configuration; other repo-spec fields are ignored.
 */
export const repoSpecSchema = z.object({
  /** DAO governance configuration */
  cogni_dao: z.object({
    /**
     * Chain ID as string or number (YAML flexibility).
     * Must match application CHAIN_ID constant after conversion to number.
     * Sepolia: "11155111" (test-only)
     * Base: "8453" (production)
     */
    chain_id: z.union([z.string(), z.number()]),
  }),

  /** Payment configuration (required) */
  payments_in: z.object({
    /** Inbound payment configuration for USDC credits top-up (required) */
    credits_topup: creditsTopupSpecSchema,
  }),
});

export type RepoSpec = z.infer<typeof repoSpecSchema>;
