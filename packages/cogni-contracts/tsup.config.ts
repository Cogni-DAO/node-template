// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cogni-contracts/tsup.config`
 * Purpose: Build configuration for cogni-contracts package.
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output must be ESM with type declarations.
 * Side-effects: IO
 * Links: docs/PACKAGES_ARCHITECTURE.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: {
    compilerOptions: {
      // Disable composite for tsup DTS generation to avoid TS6307
      composite: false,
    },
  },
  clean: true,
  sourcemap: true,
  platform: "neutral",
});

export default tsupConfig;
