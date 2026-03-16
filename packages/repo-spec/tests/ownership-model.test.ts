// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/repo-spec/tests/ownership-model`
 * Purpose: Unit tests for ownership model schema validation and accessor extraction.
 * Scope: Pure unit tests for Zod schema and accessor. Does not perform I/O.
 * Invariants: Schema defaults match spec (token_decimals=18, claim_window_days=90).
 * Side-effects: none
 * Links: packages/repo-spec/src/schema.ts, packages/repo-spec/src/accessors.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { extractOwnershipModel } from "../src/accessors";
import { ownershipModelSchema, repoSpecSchema } from "../src/schema";

describe("ownershipModelSchema", () => {
  it("parses valid V0 config with defaults", () => {
    const result = ownershipModelSchema.parse({
      template: "attribution-1to1-v0",
    });
    expect(result.template).toBe("attribution-1to1-v0");
    expect(result.token_decimals).toBe(18);
    expect(result.claim_window_days).toBe(90);
  });

  it("parses with explicit values", () => {
    const result = ownershipModelSchema.parse({
      template: "attribution-1to1-v0",
      token_decimals: 6,
      claim_window_days: 30,
    });
    expect(result.token_decimals).toBe(6);
    expect(result.claim_window_days).toBe(30);
  });

  it("rejects unknown template", () => {
    expect(() =>
      ownershipModelSchema.parse({ template: "unknown-v0" })
    ).toThrow();
  });

  it("rejects token_decimals > 18", () => {
    expect(() =>
      ownershipModelSchema.parse({
        template: "attribution-1to1-v0",
        token_decimals: 19,
      })
    ).toThrow();
  });

  it("rejects negative token_decimals", () => {
    expect(() =>
      ownershipModelSchema.parse({
        template: "attribution-1to1-v0",
        token_decimals: -1,
      })
    ).toThrow();
  });

  it("rejects claim_window_days < 1", () => {
    expect(() =>
      ownershipModelSchema.parse({
        template: "attribution-1to1-v0",
        claim_window_days: 0,
      })
    ).toThrow();
  });

  it("rejects non-integer token_decimals", () => {
    expect(() =>
      ownershipModelSchema.parse({
        template: "attribution-1to1-v0",
        token_decimals: 1.5,
      })
    ).toThrow();
  });
});

describe("extractOwnershipModel", () => {
  const MINIMAL_SPEC = {
    node_id: "550e8400-e29b-41d4-a716-446655440000",
    cogni_dao: { chain_id: "8453" },
    payments_in: {
      credits_topup: {
        provider: "cogni-usdc-backend-v1",
        receiving_address: "0x1234567890123456789012345678901234567890",
      },
    },
  };

  it("returns undefined when ownership_model is not present", () => {
    const spec = repoSpecSchema.parse(MINIMAL_SPEC);
    const result = extractOwnershipModel(spec);
    expect(result).toBeUndefined();
  });

  it("returns camelCase config when ownership_model is present", () => {
    const spec = repoSpecSchema.parse({
      ...MINIMAL_SPEC,
      ownership_model: {
        template: "attribution-1to1-v0",
        token_decimals: 18,
        claim_window_days: 90,
      },
    });
    const result = extractOwnershipModel(spec);
    expect(result).toEqual({
      template: "attribution-1to1-v0",
      tokenDecimals: 18,
      claimWindowDays: 90,
    });
  });

  it("uses schema defaults when fields omitted", () => {
    const spec = repoSpecSchema.parse({
      ...MINIMAL_SPEC,
      ownership_model: {
        template: "attribution-1to1-v0",
      },
    });
    const result = extractOwnershipModel(spec);
    expect(result).toEqual({
      template: "attribution-1to1-v0",
      tokenDecimals: 18,
      claimWindowDays: 90,
    });
  });
});
