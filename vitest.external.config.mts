// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.external.config.mts`
 * Purpose: Vitest configuration for external integration tests that hit real 3rd-party APIs.
 * Scope: Tests in tests/external/ — require internet + real API keys. NOT part of default CI.
 * Invariants: Uses testcontainers for ledger round-trip; skips gracefully if tokens missing.
 * Side-effects: process.env (.env.test injection), database connections, real HTTP to GitHub/etc.
 * Links: tests/external/AGENTS.md, vitest.component.config.mts (similar pattern)
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { expand } from "dotenv-expand";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.test for DB config (testcontainers overrides DATABASE_URL at runtime)
const env = config({ path: ".env.test" });
expand(env);

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.base.json"] })],
  test: {
    include: ["tests/external/**/*.external.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/component/setup/testcontainers-postgres.global.ts"],
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
