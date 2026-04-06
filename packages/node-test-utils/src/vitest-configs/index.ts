// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-test-utils/vitest-configs`
 * Purpose: Vitest config factory for node apps — replaces per-node config duplication.
 * Scope: Exports config factory functions. Does not run tests or import app code.
 * Invariants: PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE.
 * Side-effects: none
 * Links: docs/guides/testing.md
 * @public
 */

import path from "node:path";
import type { UserConfig } from "vitest/config";

export type NodeVitestConfigKind =
  | "unit"
  | "component"
  | "external"
  | "external-money"
  | "stack"
  | "stack-multi";

export interface NodeVitestConfigOptions {
  /** __dirname of the consuming config file (the node's app/ directory) */
  dirname: string;
  /** Which test suite this config targets */
  kind: NodeVitestConfigKind;
  /** Deep-merge overrides for test config (e.g., operator's multi-node exclude) */
  overrides?: {
    exclude?: string[];
    testTimeout?: number;
    hookTimeout?: number;
    globalSetup?: string[];
  };
}

/** Shared base config — all kinds get these. */
function baseConfig(dirname: string): UserConfig {
  return {
    root: dirname,
    plugins: [
      // Lazy-import to avoid requiring vite-tsconfig-paths as a hard dep at parse time
    ],
    resolve: {
      alias: {
        "@tests": path.resolve(dirname, "./tests"),
      },
    },
  };
}

/**
 * Creates a Vitest config for a node app test suite.
 *
 * Usage in a node's vitest.config.mts:
 * ```ts
 * import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";
 * export default createNodeVitestConfig({ dirname: __dirname, kind: "unit" });
 * ```
 */
export async function createNodeVitestConfig(
  opts: NodeVitestConfigOptions
): Promise<UserConfig> {
  const { dirname, kind, overrides } = opts;
  const base = baseConfig(dirname);

  // Dynamic imports — consumers must have these in their node_modules (hoisted by pnpm)
  const { default: tsconfigPaths } = await import("vite-tsconfig-paths");
  const { defineConfig } = await import("vitest/config");

  // All configs share the tsconfig plugin
  const plugins = [tsconfigPaths({ projects: ["./tsconfig.test.json"] })];

  switch (kind) {
    case "unit":
      return defineConfig({
        ...base,
        plugins,
        esbuild: { jsx: "automatic" },
        test: {
          globals: true,
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          include: [
            "tests/unit/**/*.{test,spec}.{ts,tsx}",
            "tests/meta/**/*.{test,spec}.{ts,tsx}",
            "tests/contract/**/*.{test,spec}.{ts,tsx}",
            "tests/ports/**/*.{test,spec}.{ts,tsx}",
            "tests/security/**/*.{test,spec}.{ts,tsx}",
          ],
          exclude: ["node_modules", "dist", ".next"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      });

    case "component": {
      const { config } = await import("dotenv");
      const { expand } = await import("dotenv-expand");
      const env = config({ path: ".env.test" });
      expand(env);

      return defineConfig({
        ...base,
        plugins,
        test: {
          include: ["tests/component/**/*.int.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          globalSetup: [
            "./tests/component/setup/testcontainers-postgres.global.ts",
          ],
          sequence: { concurrent: false },
        },
      });
    }

    case "external": {
      const { config } = await import("dotenv");
      const { expand } = await import("dotenv-expand");
      const env = config({ path: ".env.test" });
      expand(env);

      return defineConfig({
        ...base,
        plugins,
        test: {
          include: ["tests/external/**/*.external.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          globalSetup: [
            "./tests/component/setup/testcontainers-postgres.global.ts",
          ],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
              execArgv: ["--dns-result-order=ipv4first"],
            },
          },
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      });
    }

    case "external-money": {
      const { config } = await import("dotenv");
      const { expand } = await import("dotenv-expand");
      const local = config({ path: ".env.local" });
      expand(local);
      const test = config({ path: ".env.test" });
      expand(test);

      for (const name of [
        "DATABASE_SERVICE_URL",
        "TIGERBEETLE_ADDRESS",
        "OPENROUTER_API_KEY",
        "TEST_WALLET_PRIVATE_KEY",
      ]) {
        // biome-ignore lint/style/noProcessEnv: Test setup validates env before tests run
        if (!process.env[name]) {
          throw new Error(
            `[external:money] ${name} is required. Add it to .env.test.`
          );
        }
      }

      return defineConfig({
        ...base,
        plugins,
        test: {
          include: ["tests/external/money/*.external.money.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
              execArgv: ["--dns-result-order=ipv4first"],
            },
          },
          sequence: { concurrent: false },
          testTimeout: 60_000,
          hookTimeout: 30_000,
        },
      });
    }

    case "stack": {
      for (const name of [
        "DATABASE_URL",
        "DATABASE_SERVICE_URL",
        "TEST_BASE_URL",
      ]) {
        // biome-ignore lint/style/noProcessEnv: Test setup validates env before tests run
        if (!process.env[name]) {
          throw new Error(`Stack tests require ${name} to be set`);
        }
      }

      return defineConfig({
        ...base,
        plugins,
        test: {
          include: ["tests/stack/**/*.stack.test.ts"],
          exclude: overrides?.exclude,
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          globalSetup: overrides?.globalSetup ?? [
            "./tests/stack/setup/preflight-binaries.ts",
            "./tests/stack/setup/wait-for-probes.ts",
            "./tests/stack/setup/preflight-openclaw-gateway.ts",
            "./tests/stack/setup/preflight-litellm-config.ts",
            "./tests/stack/setup/preflight-mock-llm.ts",
            "./tests/stack/setup/preflight-db-roles.ts",
            "./tests/stack/setup/reset-db.ts",
          ],
          sequence: { concurrent: false },
          testTimeout: overrides?.testTimeout ?? 10_000,
          hookTimeout: overrides?.hookTimeout ?? 10_000,
        },
      });
    }

    case "stack-multi":
      return defineConfig({
        ...base,
        plugins,
        test: {
          include: ["tests/stack/internal/multi-node-*.stack.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          globalSetup: overrides?.globalSetup ?? [
            "./tests/stack/setup/wait-for-probes-multi.ts",
          ],
          sequence: { concurrent: false },
          testTimeout: overrides?.testTimeout ?? 30_000,
          hookTimeout: overrides?.hookTimeout ?? 30_000,
        },
      });

    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown config kind: ${_exhaustive}`);
    }
  }
}
