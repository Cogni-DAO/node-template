// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@eslint/base.config.mjs`
 * Purpose: Minimal ESLint base config for parser setup only.
 * Scope: All linting rules migrated to Biome. ESLint only handles boundaries + UI governance.
 * Invariants: Parser configured for TypeScript files.
 * Side-effects: none
 * Notes: All TS/import/core rules now enforced by Biome.
 * Links: eslint.config.mjs, app.config.mjs
 * @public
 */

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,

  // JS/MJS config files - use Espree (default JS parser)
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
      },
    },
  },

  // TypeScript files - parser only, no rules (Biome handles linting)
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },

  prettierConfig,

  {
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "*.d.ts",
      "**/*.gen.*",
      "node_modules/**",
      "commitlint.config.cjs",
      "*.config.cjs",
      "test*/**/fixtures/**",
      "**/*.md",
      "**/*.css",
      "**/.env*",
      "**/*.yaml",
      "**/*.yml",
    ],
  },
];
