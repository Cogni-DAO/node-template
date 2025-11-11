// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/http/types`
 * Purpose: Base types for HTTP contracts shared across all edge operations.
 * Scope: Defines contract structure; excludes implementation details.
 * Invariants: Stable base interface; all HTTP contracts extend these types.
 * Side-effects: none
 * Notes: Foundation for type-safe contract definitions and tooling.
 * Links: Individual contract files, OpenAPI generation
 * @internal
 */

import type { z } from "zod";

export interface HttpContract<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  readonly path: string;
  readonly input: TInput;
  readonly output: z.ZodSchema<TOutput>;
}
