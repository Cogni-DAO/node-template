// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/port/schemas`
 * Purpose: Zod schemas for Cosmos wallet types.
 * Scope: Validation schemas — no runtime logic. Does NOT perform I/O.
 * Invariants: SCHEMAS_ARE_SOURCE_OF_TRUTH
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

import { z } from "zod";

export const cosmosBalanceSchema = z.object({
  amount: z
    .string()
    .describe("Token amount in smallest denomination (e.g., uakt)"),
  denom: z.string().describe("Token denomination (e.g., uakt, uatom)"),
});

export const cosmosTxResultSchema = z.object({
  txHash: z.string().describe("Transaction hash"),
  height: z.number().describe("Block height of inclusion"),
  gasUsed: z.string().describe("Gas consumed"),
  code: z.number().describe("Result code (0 = success)"),
});

export const cosmosWalletConfigSchema = z.object({
  rpcEndpoint: z.string().url().describe("Cosmos RPC endpoint URL"),
  chainId: z.string().describe("Chain ID (e.g., akashnet-2, cosmoshub-4)"),
  prefix: z.string().default("akash").describe("Bech32 address prefix"),
  defaultDenom: z
    .string()
    .default("uakt")
    .describe("Default token denomination"),
  gasPrice: z
    .string()
    .default("0.025uakt")
    .describe("Gas price for transactions"),
});

/** Akash-specific deployment escrow deposit message */
export const akashDepositMsgSchema = z.object({
  deploymentId: z.object({
    owner: z.string(),
    dseq: z.string(),
  }),
  amount: cosmosBalanceSchema,
  depositor: z.string(),
});

export type AkashDepositMsg = z.infer<typeof akashDepositMsgSchema>;
