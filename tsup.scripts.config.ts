// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `tsup.scripts.config`
 * Purpose: Build configuration for standalone scripts that run outside Next.js.
 * Scope: Compiles src/scripts/* to dist/scripts/* with path alias resolution.
 * @internal
 */

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/scripts/run-scheduler-worker.ts"],
  outDir: "dist/scripts",
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Don't bundle - just transpile and resolve aliases
  bundle: true,
  // Externalize workspace packages and node_modules, but NOT @/ aliases
  external: [
    "@cogni/scheduler-worker",
    "@cogni/ai-core",
    "@cogni/ai-tools",
    "@cogni/langgraph-graphs",
    // Match bare imports (packages) but NOT @/ aliases
    /^(?!@\/)(?!\.)[a-z@]/i,
  ],
  // Resolve path aliases at build time
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
      "@/bootstrap": "./src/bootstrap",
      "@/shared": "./src/shared",
      "@/ports": "./src/ports",
      "@/adapters": "./src/adapters",
      "@/core": "./src/core",
    };
  },
});
