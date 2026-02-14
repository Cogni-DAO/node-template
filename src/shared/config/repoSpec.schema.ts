// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/config/repoSpec.schema`
 * Purpose: Zod schemas and derived types for .cogni/repo-spec.yaml validation (payments + governance).
 * Scope: Validates governance-managed payment and governance schedule configuration structures; does not enforce chain/token values (those checked against chain.ts constants).
 * Invariants: Receiving_address must be valid EVM format; provider must be non-empty; governance schedules require charter + cron + entrypoint.
 * Side-effects: none
 * Links: .cogni/repo-spec.yaml, docs/spec/chain-config.md, docs/spec/payments-design.md
 * @public
 */

import { z } from "zod";

/**
 * Schema for payments_in.credits_topup configuration.
 * Validates inbound payment settings structure.
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

  /** Optional: Informational list of chain names (not enforced by schema; validation against chain.ts happens in loader) */
  allowed_chains: z.array(z.string()).optional(),

  /** Optional: Informational list of token names (not enforced by schema) */
  allowed_tokens: z.array(z.string()).optional(),
});

export type CreditsTopupSpec = z.infer<typeof creditsTopupSpecSchema>;

/**
 * Schema for a single governance schedule entry.
 * Each schedule triggers an OpenClaw gateway run with a 1-word entrypoint.
 * Invariants: Charter must be unique per config; cron must be 5 fields; entrypoint must be 1 token (no spaces).
 */
export const governanceScheduleSchema = z.object({
  /** Charter name (e.g., COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN) */
  charter: z.string().min(1, "Charter must be non-empty"),
  /** 5-field cron expression (minute hour day month weekday) */
  cron: z
    .string()
    .regex(
      /^(\S+\s+){4}\S+$/,
      "Cron must be a 5-field expression (minute hour day month weekday)"
    ),
  /** IANA timezone (defaults to UTC) */
  timezone: z.string().default("UTC"),
  /** Trigger word sent to OpenClaw gateway (single token, no spaces) */
  entrypoint: z
    .string()
    .regex(/^\S+$/, "Entrypoint must be a single token (no spaces)"),
});

export type GovernanceScheduleSpec = z.infer<typeof governanceScheduleSchema>;

/**
 * Schema for the governance section of repo-spec.
 * Optional — existing deployments without this section continue to work.
 */
export const governanceSpecSchema = z.object({
  schedules: z
    .array(governanceScheduleSchema)
    .default([])
    .refine(
      (arr) =>
        new Set(arr.map((s) => s.charter.toLowerCase())).size === arr.length,
      { message: "Duplicate charter names in governance.schedules" }
    ),
});

export type GovernanceSpec = z.infer<typeof governanceSpecSchema>;

/**
 * Schema for full .cogni/repo-spec.yaml structure (payment-relevant subset).
 * Validates structure only; chain alignment checked in repoSpec.server.ts against chain.ts.
 */
export const repoSpecSchema = z.object({
  /** DAO governance configuration */
  cogni_dao: z.object({
    /**
     * Chain ID as string or number (YAML flexibility).
     * Validated against CHAIN_ID constant from chain.ts at load time.
     */
    chain_id: z.union([z.string(), z.number()]),
  }),

  /** Payment configuration (required) */
  payments_in: z.object({
    /** Inbound payment configuration for USDC credits top-up (required) */
    credits_topup: creditsTopupSpecSchema,
  }),

  /** Governance schedule configuration (optional — defaults to empty schedules) */
  governance: governanceSpecSchema.optional().default({ schedules: [] }),
});

export type RepoSpec = z.infer<typeof repoSpecSchema>;
