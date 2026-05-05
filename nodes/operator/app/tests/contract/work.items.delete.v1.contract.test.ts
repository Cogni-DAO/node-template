// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/work.items.delete.v1.contract`
 * Purpose: Validates Zod schema for work items delete contract — input + output shapes.
 * Scope: Pure Zod schema validation. Does not test HTTP transport or DB.
 * Invariants:
 *   - INPUT_REQUIRES_ID: input requires a string `id`.
 *   - OUTPUT_DELETED_LITERAL_TRUE: output rejects `deleted: false` so the contract is unambiguous (404 is the channel for "not found").
 * Side-effects: none
 * Links: packages/node-contracts/src/work.items.delete.v1.contract.ts
 * @internal
 */

import { workItemsDeleteOperation } from "@cogni/node-contracts";
import { describe, expect, it } from "vitest";

describe("workItemsDeleteOperation.input", () => {
  it("accepts a valid id", () => {
    expect(
      workItemsDeleteOperation.input.safeParse({ id: "bug.0002" }).success
    ).toBe(true);
  });

  it("rejects missing id", () => {
    expect(workItemsDeleteOperation.input.safeParse({}).success).toBe(false);
  });
});

describe("workItemsDeleteOperation.output", () => {
  it("accepts {id, deleted: true}", () => {
    expect(
      workItemsDeleteOperation.output.safeParse({
        id: "bug.0002",
        deleted: true,
      }).success
    ).toBe(true);
  });

  it("rejects deleted: false (404 is the channel for not-found)", () => {
    expect(
      workItemsDeleteOperation.output.safeParse({
        id: "bug.0002",
        deleted: false,
      }).success
    ).toBe(false);
  });
});
