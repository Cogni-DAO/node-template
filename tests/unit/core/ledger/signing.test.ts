// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/core/ledger/signing`
 * Purpose: Unit tests for canonical receipt message builder and SHA-256 hashing.
 * Scope: Pure function testing. Does not test signature verification or wallet integration.
 * Invariants: SIGNATURE_DOMAIN_BOUND — message includes chain_id, app_domain, spec_version.
 * Side-effects: none
 * Links: src/core/ledger/signing.ts, docs/spec/epoch-ledger.md#receipt-signing
 * @public
 */

import type { ReceiptMessageFields, SigningContext } from "@cogni/ledger-core";
import {
  buildReceiptMessage,
  computeReceiptSetHash,
  hashReceiptMessage,
} from "@cogni/ledger-core";
import { describe, expect, it } from "vitest";

const defaultContext: SigningContext = {
  chainId: "8453",
  appDomain: "cogni-template.ledger",
  specVersion: "v0",
};

const defaultFields: ReceiptMessageFields = {
  epochId: "1",
  userId: "user-abc-123",
  workItemId: "task.0054",
  role: "author",
  valuationUnits: "100",
  artifactRef: "https://github.com/org/repo/pull/42",
  rationaleRef: "Quality implementation with tests",
};

describe("core/ledger/signing", () => {
  describe("buildReceiptMessage", () => {
    it("produces canonical domain-bound format per spec", () => {
      const msg = buildReceiptMessage(defaultContext, defaultFields);

      expect(msg).toBe(
        [
          "cogni-template.ledger:v0:8453",
          "epoch:1",
          "receipt:user-abc-123:task.0054:author",
          "units:100",
          "artifact:https://github.com/org/repo/pull/42",
          "rationale:Quality implementation with tests",
        ].join("\n")
      );
    });

    it("includes chain_id in first line (SIGNATURE_DOMAIN_BOUND)", () => {
      const msg = buildReceiptMessage(defaultContext, defaultFields);
      const firstLine = msg.split("\n")[0];
      expect(firstLine).toContain("8453");
    });

    it("includes app_domain in first line (SIGNATURE_DOMAIN_BOUND)", () => {
      const msg = buildReceiptMessage(defaultContext, defaultFields);
      const firstLine = msg.split("\n")[0];
      expect(firstLine).toContain("cogni-template.ledger");
    });

    it("includes spec_version in first line (SIGNATURE_DOMAIN_BOUND)", () => {
      const msg = buildReceiptMessage(defaultContext, defaultFields);
      const firstLine = msg.split("\n")[0];
      expect(firstLine).toContain("v0");
    });

    it("produces different messages for different chains", () => {
      const msgBase = buildReceiptMessage(defaultContext, defaultFields);
      const msgSepolia = buildReceiptMessage(
        { ...defaultContext, chainId: "11155111" },
        defaultFields
      );
      expect(msgBase).not.toBe(msgSepolia);
    });

    it("produces different messages for different roles", () => {
      const msgAuthor = buildReceiptMessage(defaultContext, defaultFields);
      const msgReviewer = buildReceiptMessage(defaultContext, {
        ...defaultFields,
        role: "reviewer",
      });
      expect(msgAuthor).not.toBe(msgReviewer);
    });
  });

  describe("hashReceiptMessage", () => {
    it("returns a 64-character hex string (SHA-256)", async () => {
      const hash = await hashReceiptMessage("test message");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic — same input produces same hash", async () => {
      const msg = buildReceiptMessage(defaultContext, defaultFields);
      const hash1 = await hashReceiptMessage(msg);
      const hash2 = await hashReceiptMessage(msg);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different messages", async () => {
      const hash1 = await hashReceiptMessage("message-a");
      const hash2 = await hashReceiptMessage("message-b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("computeReceiptSetHash", () => {
    it("returns a 64-character hex string", async () => {
      const hash = await computeReceiptSetHash(["id-1", "id-2"]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is order-independent — sorted internally", async () => {
      const hash1 = await computeReceiptSetHash(["id-b", "id-a", "id-c"]);
      const hash2 = await computeReceiptSetHash(["id-c", "id-a", "id-b"]);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different receipt sets", async () => {
      const hash1 = await computeReceiptSetHash(["id-1", "id-2"]);
      const hash2 = await computeReceiptSetHash(["id-1", "id-3"]);
      expect(hash1).not.toBe(hash2);
    });

    it("handles single receipt", async () => {
      const hash = await computeReceiptSetHash(["single-id"]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles empty set", async () => {
      const hash = await computeReceiptSetHash([]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
