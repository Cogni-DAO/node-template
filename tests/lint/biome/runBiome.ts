// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/lint/biome/runBiome`
 * Purpose: Test harness for running Biome against fixture files with real config.
 * Scope: Runs Biome CLI against test files. Does NOT modify actual config.
 * Invariants: Uses real biome.json; returns same shape as runEslint for 1:1 parity.
 * Side-effects: IO (creates/deletes temp files in repo for testing)
 * Notes: Supports virtualRepoPath for path-sensitive allowlist testing.
 * Links: biome.json, tests/lint/fixtures/
 * @public
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

interface BiomeDiagnostic {
  category: string;
  severity: "error" | "warning" | "info";
  message?: { text?: string };
}

interface BiomeReport {
  diagnostics: BiomeDiagnostic[];
}

const repoRoot = path.resolve(__dirname, "../../..");

interface LintOptions {
  focusRulePrefixes?: string[]; // For compatibility with runEslint
  ignoreRules?: string[];
  virtualRepoPath?: string; // Path where file should appear in repo for allowlist matching
}

export async function lintFixture(
  relPath: string,
  code?: string,
  options: LintOptions = {}
): Promise<{
  errors: number;
  warnings: number;
  messages: { ruleId: string | null; message: string; line: number }[];
}> {
  // Make temp path unique for parallel test execution
  const uniqueSuffix = randomUUID().slice(0, 8);

  // Insert UUID into directory path to preserve filename for pattern matching
  // e.g., src/app/__biome_test__/page.tsx -> src/app/__biome_ABC123__/page.tsx
  const makeUnique = (p: string): string => {
    const dir = path.dirname(p);
    const file = path.basename(p);
    return path.join(
      dir.replace(/__biome_test__/, `__biome_${uniqueSuffix}__`),
      file
    );
  };

  const onDiskPath = options.virtualRepoPath
    ? path.join(repoRoot, makeUnique(options.virtualRepoPath))
    : path.join(
        repoRoot,
        "src",
        relPath.replace(/^/, `__biome_${uniqueSuffix}__/`)
      );

  try {
    // Create directory structure
    mkdirSync(path.dirname(onDiskPath), { recursive: true });

    // Write test content
    if (code) {
      writeFileSync(onDiskPath, code, "utf8");
    } else {
      // Copy from fixture
      const fixturePath = path.join(repoRoot, "tests/lint/fixtures", relPath);
      const fixtureContent = readFileSync(fixturePath, "utf8");
      writeFileSync(onDiskPath, fixtureContent, "utf8");
    }

    // Run Biome check on the actual repo path
    const result = spawnSync(
      "pnpm",
      ["biome", "check", "--reporter", "json", onDiskPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
      }
    );

    // Parse JSON output
    const jsonLine = (result.stdout ?? "")
      .split("\n")
      .map((line: string) => line.trim())
      .reverse()
      .find((line: string) => line.startsWith("{") && line.endsWith("}"));

    const report: BiomeReport | undefined = jsonLine
      ? JSON.parse(jsonLine)
      : undefined;

    const diagnostics = report?.diagnostics ?? [];

    // Apply focus filtering if specified (for ESLint parity)
    let filtered = diagnostics;
    if (options.focusRulePrefixes && options.focusRulePrefixes.length > 0) {
      filtered = diagnostics.filter((d) =>
        options.focusRulePrefixes?.some((prefix) =>
          d.category.startsWith(prefix)
        )
      );
    }

    // Apply ignore filtering if specified
    if (options.ignoreRules && options.ignoreRules.length > 0) {
      filtered = filtered.filter(
        (d) => !options.ignoreRules?.includes(d.category)
      );
    }

    return {
      errors: filtered.filter((d) => d.severity === "error").length,
      warnings: filtered.filter((d) => d.severity === "warning").length,
      messages: filtered.map((d) => ({
        ruleId: d.category,
        message: d.message?.text ?? "",
        line: 0, // Biome diagnostics don't always expose line in JSON
      })),
    };
  } finally {
    // Clean up temp file
    try {
      rmSync(onDiskPath, { force: true });
      // Try to clean up empty parent directories (best effort)
      const parentDir = path.dirname(onDiskPath);
      if (parentDir.includes("__biome_test__")) {
        rmSync(parentDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
