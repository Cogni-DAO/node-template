// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-data-traded-events`
 * Purpose: AI tool — list events a wallet traded on (category-focus analysis) via `GET /traded-events`.
 * Scope: Read-only. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, USER_PARAM_IS_PROXY_WALLET, PAGINATION_CONSISTENT, NO_LANGCHAIN_IMPORT.
 * Side-effects: IO (capability)
 * Links: work/items/task.0368.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { PolyDataCapability } from "../capabilities/poly-data";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

const PolyAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex proxy-wallet");

export const PolyDataTradedEventsInputSchema = z.object({
  user: PolyAddressSchema.describe(
    "Polymarket proxy-wallet (Safe) address, NOT the signing EOA."
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Rows per page (1-100, default 20)."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Pagination offset (default 0)."),
});
export type PolyDataTradedEventsInput = z.infer<
  typeof PolyDataTradedEventsInputSchema
>;

const TradedEventEntrySchema = z.object({
  eventId: z.string(),
  eventSlug: z.string(),
  title: z.string(),
  numTrades: z.number(),
  firstTradeAt: z.number(),
  lastTradeAt: z.number(),
});

export const PolyDataTradedEventsOutputSchema = z.object({
  user: z.string(),
  events: z.array(TradedEventEntrySchema),
  count: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PolyDataTradedEventsOutput = z.infer<
  typeof PolyDataTradedEventsOutputSchema
>;
export type PolyDataTradedEventsRedacted = PolyDataTradedEventsOutput;

export const POLY_DATA_TRADED_EVENTS_NAME =
  "core__poly_data_traded_events" as const;

export const polyDataTradedEventsContract: ToolContract<
  typeof POLY_DATA_TRADED_EVENTS_NAME,
  PolyDataTradedEventsInput,
  PolyDataTradedEventsOutput,
  PolyDataTradedEventsRedacted
> = {
  name: POLY_DATA_TRADED_EVENTS_NAME,
  description:
    "List Polymarket events (parent groupings of markets) that a wallet has traded on, with " +
    "per-event trade counts and first/last trade timestamps. Use this to detect category " +
    "specialization (sports, politics, crypto) — consistent winners usually focus one domain. " +
    "`user` MUST be the proxy-wallet.",
  effect: "read_only",
  inputSchema: PolyDataTradedEventsInputSchema,
  outputSchema: PolyDataTradedEventsOutputSchema,
  redact: (out) => out,
  allowlist: ["user", "events", "count", "hasMore"] as const,
};

export interface PolyDataTradedEventsDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataTradedEventsImplementation(
  deps: PolyDataTradedEventsDeps
): ToolImplementation<PolyDataTradedEventsInput, PolyDataTradedEventsOutput> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.listTradedEvents({
        user: input.user,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      }),
  };
}

export const polyDataTradedEventsStubImplementation: ToolImplementation<
  PolyDataTradedEventsInput,
  PolyDataTradedEventsOutput
> = {
  execute: async (input) => ({
    user: input.user,
    events: [],
    count: 0,
    hasMore: false,
  }),
};

export const polyDataTradedEventsBoundTool: BoundTool<
  typeof POLY_DATA_TRADED_EVENTS_NAME,
  PolyDataTradedEventsInput,
  PolyDataTradedEventsOutput,
  PolyDataTradedEventsRedacted
> = {
  contract: polyDataTradedEventsContract,
  implementation: polyDataTradedEventsStubImplementation,
};
