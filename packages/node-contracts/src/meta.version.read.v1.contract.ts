// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/meta.version.read.v1.contract`
 * Purpose: Contract for build version endpoint (public build metadata).
 * Scope: Defines response schema for /version endpoint; does not validate env, does not perform I/O.
 * Invariants: Always returns valid version schema; force-dynamic runtime.
 * Side-effects: none
 * Notes: Used for artifact verification, debugging, and CI/CD pipelines.
 *        Aligns with /readyz buildSha and /metrics app_build_info gauge.
 * Links: /version endpoint, /readyz, /metrics
 * @internal
 */

import { z } from "zod";

export const metaVersionOutputSchema = z.object({
  version: z.string(),
  buildSha: z.string().optional(),
  buildTime: z.string().optional(),
});

export const metaVersionOperation = {
  id: "meta.version.read.v1",
  summary: "Build version metadata",
  description:
    "Returns build version, git SHA, and build timestamp. Used for artifact verification and debugging.",
  input: null,
  output: metaVersionOutputSchema,
} as const;
