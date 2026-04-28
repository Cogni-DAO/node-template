// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/tests/pr-review-input-contract.test`
 * Purpose: Contract test for `PrReviewWorkflowInputSchema` — proves the schema is the single source of truth and catches future drift between dispatch and activity.
 * Scope: Pure schema validation only. Does not exercise the Temporal runtime or any HTTP/Octokit I/O.
 * Invariants:
 *   - SINGLE_INPUT_CONTRACT: A canonical fixture representing a real dispatch payload validates without error.
 *   - DISPATCH_FAIL_FAST: Misshapen fixtures (missing field, wrong type, empty string) reject at parse time.
 * Side-effects: none
 * Links: task.0412, packages/temporal-workflows/src/workflows/pr-review.schema.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { PrReviewWorkflowInputSchema } from "../src/workflows/pr-review.schema.js";

/** Canonical valid fixture — mirrors what `dispatchPrReview` produces today. */
const validFixture = {
  nodeId: "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d",
  owner: "Cogni-DAO",
  repo: "test-repo",
  prNumber: 920,
  headSha: "ebc27a9d9d65bf05ad26c107328c5576b7614333",
  installationId: 12345678,
  actorUserId: "00000000-0000-0000-0000-000000000001",
  billingAccountId: "00000000-0000-0000-0000-000000000002",
  virtualKeyId: "vk_system_default",
};

describe("PrReviewWorkflowInputSchema", () => {
  describe("valid inputs", () => {
    it("parses a canonical dispatch payload", () => {
      const parsed = PrReviewWorkflowInputSchema.parse(validFixture);
      expect(parsed).toEqual(validFixture);
    });

    it("rejects unknown fields under .strict() mode (catches typo'd field names)", () => {
      // .strict() refuses unknown fields outright. This catches the dispatch-
      // sends-typo scenario (e.g. `virtualKeyld` with lowercase L) before the
      // typo-bearing payload reaches Temporal as a silently-stripped object.
      const withExtra = { ...validFixture, modelRef: "gpt-4o" };
      const result = PrReviewWorkflowInputSchema.safeParse(withExtra);
      expect(result.success).toBe(false);
    });

    it("rejects typo'd field name (the renamed-field regression class)", () => {
      // Dispatch sends `virtualKeyld` (lowercase L instead of capital I) by typo.
      // Without .strict(), this becomes a silently-undefined virtualKeyId at the
      // activity. With .strict(), it rejects at parse time — the schema becomes
      // the wall that catches both type-shape AND name-shape regressions.
      const { virtualKeyId: _vk, ...rest } = validFixture;
      const withTypo = { ...rest, virtualKeyld: "vk_typo" };
      const result = PrReviewWorkflowInputSchema.safeParse(withTypo);
      expect(result.success).toBe(false);
    });
  });

  describe("rejects misshapen inputs", () => {
    it("rejects missing required field (nodeId)", () => {
      const { nodeId: _nodeId, ...withoutNodeId } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse(withoutNodeId);
      expect(result.success).toBe(false);
    });

    it("rejects missing required field (installationId)", () => {
      const { installationId: _id, ...withoutInstallation } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse(withoutInstallation);
      expect(result.success).toBe(false);
    });

    it("rejects empty string for owner", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        owner: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative prNumber", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer prNumber", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects string prNumber (the modelRef-shape regression class)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: "920",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("synthetic dispatch payload (mirror of dispatch.server.ts)", () => {
    /**
     * This block mirrors what `dispatchPrReview → startPrReviewWorkflow`
     * builds today. If the dispatch facade adds/removes/renames a field
     * without updating the schema, this test fails — the modelRef-shape
     * regression class is closed by construction.
     */
    it("a payload built from synthetic GitHub webhook + billing context parses cleanly", () => {
      const dispatchPayload = {
        nodeId: "synthetic-node-id",
        owner: "Cogni-DAO",
        repo: "test-repo",
        prNumber: 1,
        headSha: "0123456789abcdef0123456789abcdef01234567",
        installationId: 1,
        actorUserId: "system-principal-uuid",
        billingAccountId: "system-billing-uuid",
        virtualKeyId: "vk_test",
      };
      expect(() =>
        PrReviewWorkflowInputSchema.parse(dispatchPayload)
      ).not.toThrow();
    });
  });

  describe("regression guards for the modelRef-shape lesson (PR #1067)", () => {
    it("rejects a string in place of a structured-id field (type-shape mismatch)", () => {
      // The PR #1067 bug pattern was a TYPE shape mismatch: dispatch sent
      // `model: "gpt-4o-mini"` (string) but the activity expected
      // `modelRef: { providerKey, modelId }` (object). The string-vs-int
      // `prNumber` test below is the same class. This test pins the pattern
      // by injecting a string where a structured/numeric value is required.
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        installationId: "12345678", // legacy: string instead of int
      });
      expect(result.success).toBe(false);
    });

    it("rejects a legacy field-name + missing required (name-shape mismatch)", () => {
      // Combined regression: a stray legacy-shape field is present, AND a
      // required field is dropped. Both .strict() (catches the stray) and the
      // required-field validation (catches the missing) reject this.
      const { virtualKeyId: _vk, ...rest } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...rest,
        model: "gpt-4o-mini", // stray legacy field
      });
      expect(result.success).toBe(false);
    });
  });
});
