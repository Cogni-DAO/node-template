// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/http/registry`
 * Purpose: Registry of all HTTP operations for API documentation and tooling.
 * Scope: Lists all contracts for /api endpoints; excludes internal operations.
 * Invariants: All public API operations registered; contracts match implementations.
 * Side-effects: none
 * Notes: Used for OpenAPI generation and MCP tooling registration.
 * Links: Individual contract files, /api route handlers
 * @internal
 */

import { metaRoutesContract } from "@/contracts/meta.routes.read.v1.contract";

export const httpOperations = [
  {
    id: metaRoutesContract.id,
    method: metaRoutesContract.method,
    path: metaRoutesContract.path,
    summary: "Route manifest for UI + a11y meta",
    description: "Lists public routes and tags used by e2e and agents.",
    input: metaRoutesContract.input,
    output: metaRoutesContract.output,
  },
  // ...other operations
] as const;
