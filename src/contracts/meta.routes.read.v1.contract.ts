// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/meta.routes.read.v1.contract`
 * Purpose: Contract for meta routes endpoint exposing site route manifest.
 * Scope: Defines HTTP contract for route discovery; excludes auth/private routes.
 * Invariants: Stable API contract; schema validates all responses.
 * Side-effects: none
 * Notes: Used by e2e testing and future MCP tooling; follows hex architecture.
 * Links: \@features/site-meta/routeManifest, /api/v1/meta/routes endpoint
 * @internal
 */

import { z } from "zod";

export const routeTagSchema = z.enum(["public", "a11y-smoke", "auth", "docs"]);

export const routeEntrySchema = z.object({
  path: z.string(),
  tags: z.array(routeTagSchema),
});

export const metaRoutesOutputSchema = z.object({
  version: z.literal(1),
  routes: z.array(routeEntrySchema),
});

export const metaRoutesContract = {
  id: "meta.routes.read.v1",
  method: "GET" as const,
  path: "/api/v1/meta/routes",
  input: null,
  output: metaRoutesOutputSchema,
};
