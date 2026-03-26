// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/tsup.config`
 * Purpose: tsup build configuration for the cosmos-wallet package.
 * Scope: Build configuration only. Does NOT contain runtime code.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts", "src/adapters/direct/index.ts"],
  format: ["esm"],
  dts: true,
  clean: false,
  sourcemap: true,
  platform: "neutral",
});

// biome-ignore lint/style/noDefaultExport: tsup requires default export
export default tsupConfig;
