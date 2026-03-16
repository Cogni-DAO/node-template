// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/tests/domain/schemas`
 * Purpose: Unit tests for Zod schemas and attribute schema registry.
 * Scope: Tests validation logic only; does not test DB operations or I/O.
 * Invariants:
 *   - TYPES_ARE_STRINGS: Verifies type fields validated as non-empty strings.
 *   - ATTRIBUTE_REGISTRY_IN_PACKAGE: Verifies registry validation behavior.
 * Side-effects: none
 * Links: src/domain/schemas.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createAttributeSchemaRegistry,
  entityTypeSchema,
  entityWriteSchema,
  observationWriteSchema,
  relationTypeSchema,
  relationWriteSchema,
  signalTypeSchema,
  sourceProvenanceSchema,
  tenantIdSchema,
  validateAttributes,
} from "../../src/domain/schemas.js";

// ---------------------------------------------------------------------------
// Taxonomy field schemas
// ---------------------------------------------------------------------------

describe("taxonomy field schemas", () => {
  it("entityTypeSchema accepts non-empty strings", () => {
    expect(entityTypeSchema.parse("oss_project")).toBe("oss_project");
  });

  it("entityTypeSchema rejects empty strings", () => {
    expect(() => entityTypeSchema.parse("")).toThrow();
  });

  it("relationTypeSchema accepts non-empty strings", () => {
    expect(relationTypeSchema.parse("alternative_to")).toBe("alternative_to");
  });

  it("signalTypeSchema accepts non-empty strings", () => {
    expect(signalTypeSchema.parse("star_count")).toBe("star_count");
  });

  it("tenantIdSchema accepts 'global'", () => {
    expect(tenantIdSchema.parse("global")).toBe("global");
  });
});

// ---------------------------------------------------------------------------
// Source provenance schema
// ---------------------------------------------------------------------------

describe("sourceProvenanceSchema", () => {
  it("accepts valid provenance", () => {
    const result = sourceProvenanceSchema.parse({
      sourceNodeId: "550e8400-e29b-41d4-a716-446655440000",
      sourceReceiptId: "github:pr:org/repo:42",
    });
    expect(result.sourceNodeId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.sourceReceiptId).toBe("github:pr:org/repo:42");
  });

  it("rejects invalid UUID for sourceNodeId", () => {
    expect(() =>
      sourceProvenanceSchema.parse({
        sourceNodeId: "not-a-uuid",
        sourceReceiptId: "receipt-1",
      })
    ).toThrow();
  });

  it("rejects empty sourceReceiptId", () => {
    expect(() =>
      sourceProvenanceSchema.parse({
        sourceNodeId: "550e8400-e29b-41d4-a716-446655440000",
        sourceReceiptId: "",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Entity write schema
// ---------------------------------------------------------------------------

describe("entityWriteSchema", () => {
  const validEntity = {
    tenantId: "global",
    entityType: "oss_project",
    canonicalName: "lodash",
    attributes: { language: "JavaScript", stars: 58000 },
    sourceNodeId: "550e8400-e29b-41d4-a716-446655440000",
    sourceReceiptId: "github:repo:lodash/lodash",
    firstSeenAt: new Date("2026-01-15T00:00:00Z"),
    lastUpdatedAt: new Date("2026-03-16T00:00:00Z"),
  };

  it("accepts a valid entity write", () => {
    const result = entityWriteSchema.parse(validEntity);
    expect(result.canonicalName).toBe("lodash");
    expect(result.entityType).toBe("oss_project");
  });

  it("accepts null attributes", () => {
    const result = entityWriteSchema.parse({
      ...validEntity,
      attributes: null,
    });
    expect(result.attributes).toBeNull();
  });

  it("coerces ISO date strings to Date objects", () => {
    const result = entityWriteSchema.parse({
      ...validEntity,
      firstSeenAt: "2026-01-15T00:00:00Z",
      lastUpdatedAt: "2026-03-16T00:00:00Z",
    });
    expect(result.firstSeenAt).toBeInstanceOf(Date);
    expect(result.lastUpdatedAt).toBeInstanceOf(Date);
  });

  it("rejects empty canonicalName", () => {
    expect(() =>
      entityWriteSchema.parse({ ...validEntity, canonicalName: "" })
    ).toThrow();
  });

  it("rejects empty entityType", () => {
    expect(() =>
      entityWriteSchema.parse({ ...validEntity, entityType: "" })
    ).toThrow();
  });

  it("rejects invalid sourceNodeId", () => {
    expect(() =>
      entityWriteSchema.parse({ ...validEntity, sourceNodeId: "bad" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Relation write schema
// ---------------------------------------------------------------------------

describe("relationWriteSchema", () => {
  const validRelation = {
    tenantId: "global",
    sourceEntityId: "550e8400-e29b-41d4-a716-446655440001",
    targetEntityId: "550e8400-e29b-41d4-a716-446655440002",
    relationType: "alternative_to",
    attributes: { reason: "Both are utility libraries" },
    sourceNodeId: "550e8400-e29b-41d4-a716-446655440000",
    sourceReceiptId: "github:comparison:lodash-vs-underscore",
  };

  it("accepts a valid relation write", () => {
    const result = relationWriteSchema.parse(validRelation);
    expect(result.relationType).toBe("alternative_to");
  });

  it("rejects non-UUID entity IDs", () => {
    expect(() =>
      relationWriteSchema.parse({
        ...validRelation,
        sourceEntityId: "not-a-uuid",
      })
    ).toThrow();
  });

  it("rejects empty relationType", () => {
    expect(() =>
      relationWriteSchema.parse({ ...validRelation, relationType: "" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Observation write schema
// ---------------------------------------------------------------------------

describe("observationWriteSchema", () => {
  const validObservation = {
    tenantId: "global",
    entityId: "550e8400-e29b-41d4-a716-446655440001",
    signalType: "star_count",
    value: { count: 58000 },
    observedAt: new Date("2026-03-16T00:00:00Z"),
    sourceNodeId: "550e8400-e29b-41d4-a716-446655440000",
    sourceReceiptId: "github:api:lodash/lodash:stars",
  };

  it("accepts a valid observation write", () => {
    const result = observationWriteSchema.parse(validObservation);
    expect(result.signalType).toBe("star_count");
  });

  it("rejects empty signalType", () => {
    expect(() =>
      observationWriteSchema.parse({ ...validObservation, signalType: "" })
    ).toThrow();
  });

  it("coerces ISO date string for observedAt", () => {
    const result = observationWriteSchema.parse({
      ...validObservation,
      observedAt: "2026-03-16T00:00:00Z",
    });
    expect(result.observedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Attribute Schema Registry
// ---------------------------------------------------------------------------

describe("AttributeSchemaRegistry", () => {
  const ossProjectSchema = z.object({
    language: z.string(),
    stars: z.number(),
  });

  const licenseSchema = z.object({
    spdxId: z.string(),
    isCopyleft: z.boolean(),
  });

  const registry = createAttributeSchemaRegistry({
    oss_project: ossProjectSchema,
    license: licenseSchema,
  });

  describe("createAttributeSchemaRegistry", () => {
    it("creates a registry from a plain object", () => {
      expect(registry.size).toBe(2);
      expect(registry.has("oss_project")).toBe(true);
      expect(registry.has("license")).toBe(true);
    });

    it("registry is a ReadonlyMap", () => {
      expect(registry).toBeInstanceOf(Map);
    });
  });

  describe("validateAttributes", () => {
    it("returns null for null attributes", () => {
      expect(validateAttributes(registry, "oss_project", null)).toBeNull();
    });

    it("returns null for undefined attributes", () => {
      expect(validateAttributes(registry, "oss_project", undefined)).toBeNull();
    });

    it("validates attributes against a registered schema", () => {
      const attrs = { language: "TypeScript", stars: 42000 };
      const result = validateAttributes(registry, "oss_project", attrs);
      expect(result).toEqual(attrs);
    });

    it("throws ZodError for invalid attributes against registered schema", () => {
      const attrs = { language: 123, stars: "not-a-number" };
      expect(() =>
        validateAttributes(
          registry,
          "oss_project",
          attrs as unknown as Record<string, unknown>
        )
      ).toThrow();
    });

    it("passes through attributes for unregistered entity types", () => {
      const attrs = { anything: "goes" };
      const result = validateAttributes(registry, "unknown_type", attrs);
      expect(result).toEqual(attrs);
    });
  });
});
