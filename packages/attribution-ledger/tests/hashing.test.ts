// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/tests/hashing`
 * Purpose: Unit tests for canonical JSON serialization and evaluation hashing.
 * Scope: Tests canonicalJsonStringify determinism, BigInt handling, and computeArtifactsHash sorting. Does not test store or I/O.
 * Invariants: CANONICAL_JSON — sorted keys, no whitespace, BigInt as string.
 * Side-effects: none
 * Links: packages/attribution-ledger/src/hashing.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJsonStringify,
  computeArtifactsHash,
  computeStatementHash,
  sha256OfCanonicalJson,
} from "../src/hashing";

describe("canonicalJsonStringify", () => {
  it("sorts keys at every depth", () => {
    const obj = { z: 1, a: { c: 3, b: 2 } };
    const result = canonicalJsonStringify(obj);
    expect(result).toBe('{"a":{"b":2,"c":3},"z":1}');
  });

  it("serializes BigInt as string", () => {
    const obj = { amount: BigInt("12345678901234567890") };
    const result = canonicalJsonStringify(obj);
    expect(result).toBe('{"amount":"12345678901234567890"}');
  });

  it("produces identical output regardless of key insertion order", () => {
    const a = { foo: 1, bar: 2, baz: 3 };
    const b = { baz: 3, foo: 1, bar: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it("handles arrays without sorting elements", () => {
    const arr = [3, 1, 2];
    expect(canonicalJsonStringify(arr)).toBe("[3,1,2]");
  });

  it("handles null values", () => {
    expect(canonicalJsonStringify({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it("handles nested arrays of objects", () => {
    const obj = { items: [{ z: 1, a: 2 }] };
    expect(canonicalJsonStringify(obj)).toBe('{"items":[{"a":2,"z":1}]}');
  });

  it("handles empty objects and arrays", () => {
    expect(canonicalJsonStringify({})).toBe("{}");
    expect(canonicalJsonStringify([])).toBe("[]");
  });
});

describe("sha256OfCanonicalJson", () => {
  it("returns deterministic hash", async () => {
    const hash1 = await sha256OfCanonicalJson({ b: 2, a: 1 });
    const hash2 = await sha256OfCanonicalJson({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("computeArtifactsHash", () => {
  it("produces deterministic hash sorted by evaluationRef", async () => {
    const evaluations = [
      {
        evaluationRef: "cogni.work_item_links.v0",
        algoRef: "work-item-linker-v0",
        inputsHash: "hash1",
        payloadHash: "hash2",
      },
      {
        evaluationRef: "cogni.ai_scores.v0",
        algoRef: "ai-scorer-v0",
        inputsHash: "hash3",
        payloadHash: "hash4",
      },
    ];

    const hash1 = await computeArtifactsHash(evaluations);
    const hash2 = await computeArtifactsHash([...evaluations].reverse());
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hash for different inputs", async () => {
    const hash1 = await computeArtifactsHash([
      {
        evaluationRef: "a",
        algoRef: "b",
        inputsHash: "c",
        payloadHash: "d",
      },
    ]);
    const hash2 = await computeArtifactsHash([
      {
        evaluationRef: "a",
        algoRef: "b",
        inputsHash: "c",
        payloadHash: "e",
      },
    ]);
    expect(hash1).not.toBe(hash2);
  });
});

describe("computeStatementHash", () => {
  const BASE_STATEMENT = {
    epochId: 1n,
    nodeId: "550e8400-e29b-41d4-a716-446655440000",
    scopeId: "660e8400-e29b-41d4-a716-446655440000",
    finalAllocationSetHash: "abc123",
    poolTotalCredits: 1000n,
  };

  it("returns a 64-char hex SHA-256 hash", async () => {
    const hash = await computeStatementHash(BASE_STATEMENT);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic — same inputs produce same hash", async () => {
    const a = await computeStatementHash(BASE_STATEMENT);
    const b = await computeStatementHash(BASE_STATEMENT);
    expect(a).toBe(b);
  });

  it("different epochId produces different hash", async () => {
    const a = await computeStatementHash(BASE_STATEMENT);
    const b = await computeStatementHash({ ...BASE_STATEMENT, epochId: 2n });
    expect(a).not.toBe(b);
  });

  it("different nodeId produces different hash", async () => {
    const a = await computeStatementHash(BASE_STATEMENT);
    const b = await computeStatementHash({
      ...BASE_STATEMENT,
      nodeId: "770e8400-e29b-41d4-a716-446655440000",
    });
    expect(a).not.toBe(b);
  });

  it("different finalAllocationSetHash produces different hash", async () => {
    const a = await computeStatementHash(BASE_STATEMENT);
    const b = await computeStatementHash({
      ...BASE_STATEMENT,
      finalAllocationSetHash: "def456",
    });
    expect(a).not.toBe(b);
  });

  it("different poolTotalCredits produces different hash", async () => {
    const a = await computeStatementHash(BASE_STATEMENT);
    const b = await computeStatementHash({
      ...BASE_STATEMENT,
      poolTotalCredits: 2000n,
    });
    expect(a).not.toBe(b);
  });

  it("uses canonical JSON — key order does not matter", async () => {
    // canonicalJsonStringify sorts keys, so field order in the object literal
    // should not affect the hash. This is already guaranteed by the implementation
    // but we verify it explicitly.
    const hash = await computeStatementHash(BASE_STATEMENT);

    // Rebuild with fields in different order (JS preserves insertion order
    // but canonicalJsonStringify sorts keys)
    const reordered = await computeStatementHash({
      poolTotalCredits: BASE_STATEMENT.poolTotalCredits,
      scopeId: BASE_STATEMENT.scopeId,
      epochId: BASE_STATEMENT.epochId,
      finalAllocationSetHash: BASE_STATEMENT.finalAllocationSetHash,
      nodeId: BASE_STATEMENT.nodeId,
    });
    expect(hash).toBe(reordered);
  });

  it("handles large BigInt values correctly", async () => {
    const hash = await computeStatementHash({
      ...BASE_STATEMENT,
      epochId: 999999999999n,
      poolTotalCredits: 10n ** 30n,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
