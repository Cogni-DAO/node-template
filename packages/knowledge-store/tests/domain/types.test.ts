// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/tests/domain/types`
 * Purpose: Unit tests for domain type constructors and branded string helpers.
 * Scope: Tests type constructor functions only; does not test Zod schemas or I/O.
 * Invariants:
 *   - TYPES_ARE_STRINGS: Branded types are string-based.
 * Side-effects: none
 * Links: src/domain/types.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  entityType,
  GLOBAL_TENANT,
  relationType,
  signalType,
  tenantId,
} from "../../src/domain/types.js";

describe("branded type constructors", () => {
  it("entityType creates a branded string", () => {
    const et = entityType("oss_project");
    expect(et).toBe("oss_project");
    // Branded strings are still usable as strings
    expect(et.toUpperCase()).toBe("OSS_PROJECT");
  });

  it("relationType creates a branded string", () => {
    const rt = relationType("alternative_to");
    expect(rt).toBe("alternative_to");
  });

  it("signalType creates a branded string", () => {
    const st = signalType("star_count");
    expect(st).toBe("star_count");
  });

  it("tenantId creates a branded string", () => {
    const tid = tenantId("billing-account-123");
    expect(tid).toBe("billing-account-123");
  });

  it("GLOBAL_TENANT is 'global'", () => {
    expect(GLOBAL_TENANT).toBe("global");
  });
});
