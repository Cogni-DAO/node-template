// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@eslint/no-vendor-sdk-imports.config.mjs`
 * Purpose: ESLint configuration for preventing vendor SDK imports in core application code.
 * Scope: Applies no-vendor-sdk-imports rule to src files except infra adapters.
 * Invariants: Vendor SDKs trigger errors in core; allowed in src/infra/ adapters only.
 * Side-effects: none
 * Notes: Enforces hexagonal architecture by blocking SaaS vendor lock-in in core code.
 * Links: scripts/eslint/plugins/no-vendor-sdk-imports.cjs, docs/ARCHITECTURE.md
 * @public
 */

import noVendorSdkImports from "../scripts/eslint/plugins/no-vendor-sdk-imports.cjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: { "no-vendor-sdk-imports": noVendorSdkImports },
    rules: {
      "no-vendor-sdk-imports/no-vendor-sdk-imports": "error",
    },
  },
  // Allow vendor SDKs only in infra adapters
  {
    files: ["src/infra/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-vendor-sdk-imports/no-vendor-sdk-imports": "off",
    },
  },
];
