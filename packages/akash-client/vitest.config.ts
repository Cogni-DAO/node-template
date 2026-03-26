// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-client/vitest.config`
 * Purpose: Vitest test configuration for the akash-client package.
 * Scope: Build configuration only. Does NOT contain runtime code.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { defineConfig } from "vitest/config";

export const vitestConfig = defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

// biome-ignore lint/style/noDefaultExport: vitest requires default export
export default vitestConfig;
