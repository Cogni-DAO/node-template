// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/vcs.create-pr.v1.contract`
 * Purpose: Validates create-PR input/output shapes against the Zod contract.
 * Scope: Schema compliance only — no network calls, no GitHub API.
 * Invariants:
 *   - CONTRACTS_ARE_TRUTH: wire shape is owned by vcs.create-pr.v1.contract
 * Side-effects: none
 * Links: task.0360, packages/node-contracts/src/vcs.create-pr.v1.contract.ts
 * @internal
 */

import { createPrOperation } from "@cogni/node-contracts";
import { describe, expect, it } from "vitest";

describe("vcs.create-pr.v1 input contract", () => {
  it("accepts minimal valid input", () => {
    const input = { branch: "feat/coco-test", title: "test: probe" };
    const result = createPrOperation.input.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("applies defaults: body='' base='main'", () => {
    const result = createPrOperation.input.parse({
      branch: "feat/x",
      title: "t",
    });
    expect(result.body).toBe("");
    expect(result.base).toBe("main");
  });

  it("rejects empty branch", () => {
    const result = createPrOperation.input.safeParse({
      branch: "",
      title: "t",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = createPrOperation.input.safeParse({ branch: "feat/x" });
    expect(result.success).toBe(false);
  });

  it("rejects title over 256 chars", () => {
    const result = createPrOperation.input.safeParse({
      branch: "feat/x",
      title: "a".repeat(257),
    });
    expect(result.success).toBe(false);
  });
});

describe("vcs.create-pr.v1 output contract", () => {
  it("accepts valid output", () => {
    const output = {
      prNumber: 42,
      url: "https://github.com/Cogni-DAO/node-template/pull/42",
      status: "open",
    };
    expect(() => createPrOperation.output.parse(output)).not.toThrow();
  });

  it("rejects non-positive prNumber", () => {
    const result = createPrOperation.output.safeParse({
      prNumber: 0,
      url: "https://github.com/Cogni-DAO/node-template/pull/0",
      status: "open",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-open status", () => {
    const result = createPrOperation.output.safeParse({
      prNumber: 1,
      url: "https://github.com/Cogni-DAO/node-template/pull/1",
      status: "closed",
    });
    expect(result.success).toBe(false);
  });
});
