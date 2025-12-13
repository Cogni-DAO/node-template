// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@setup-core/tests/exports`
 * Purpose: Validates package.json exports field blocks deep imports at runtime.
 * Scope: Tests built dist/ artifact, not source. Does NOT test architecture boundaries (see arch probes).
 * Invariants: Root import allowed, subpath imports blocked.
 * Side-effects: IO (dynamic imports)
 * Notes: Requires `pnpm --filter @cogni/setup-core build` to run first.
 * Links: packages/setup-core/package.json (exports field)
 * @public
 */

import { describe, expect, it } from "vitest";

describe("@cogni/setup-core exports enforcement", () => {
  it("allows root import (workspace resolution check)", async () => {
    // This test MUST pass or exports tests are invalid (setup broken)
    const mod = await import("@cogni/setup-core");

    expect(mod.encodeTokenVotingSetup).toBeTypeOf("function");
    expect(mod.getAragonAddresses).toBeTypeOf("function");
  });

  it("blocks subpath import @cogni/setup-core/encoding", async () => {
    // Realistic bypass attempt: consumers often try package/module pattern
    const importPath = "@cogni/setup-core" + "/encoding";
    await expect(async () => {
      await import(/* @vite-ignore */ importPath);
    }).rejects.toThrow(
      /not exported|does not provide an export|Missing .* specifier in/
    );
  });

  it("blocks deep import to /src/encoding (source path)", async () => {
    // Use dynamic string to prevent Vite static analysis
    const importPath = "@cogni/setup-core" + "/src/encoding";
    await expect(async () => {
      await import(/* @vite-ignore */ importPath);
    }).rejects.toThrow(
      /not exported|does not provide an export|Missing .* specifier in/
    );
  });

  it("blocks deep import to /dist/encoding (dist internal)", async () => {
    // Use dynamic string to prevent Vite static analysis
    const importPath = "@cogni/setup-core" + "/dist/encoding";
    await expect(async () => {
      await import(/* @vite-ignore */ importPath);
    }).rejects.toThrow(
      /not exported|does not provide an export|Missing .* specifier in/
    );
  });

  it("blocks deep import to /src/aragon (source path)", async () => {
    // Use dynamic string to prevent Vite static analysis
    const importPath = "@cogni/setup-core" + "/src/aragon";
    await expect(async () => {
      await import(/* @vite-ignore */ importPath);
    }).rejects.toThrow(
      /not exported|does not provide an export|Missing .* specifier in/
    );
  });
});
