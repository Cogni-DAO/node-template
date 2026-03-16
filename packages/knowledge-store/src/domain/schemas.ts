// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/domain/schemas`
 * Purpose: Zod validation schemas for knowledge store domain types and attribute registry.
 * Scope: Zod schemas for entity/relation/observation validation + AttributeSchemaRegistry for per-entity-type attribute validation. Does not contain I/O or adapter code.
 * Invariants:
 * - TYPES_ARE_STRINGS: Type fields validated as non-empty strings via Zod.
 * - ATTRIBUTES_JSONB: Attribute schemas are validated per entity_type via registry lookup.
 * - ATTRIBUTE_REGISTRY_IN_PACKAGE: Registry lives here, not in db-schema.
 * Side-effects: none
 * Links: work/projects/proj.knowledge-store.md
 * @public
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Taxonomy field schemas
// ---------------------------------------------------------------------------

/** Non-empty string for entity type identifiers. */
export const entityTypeSchema = z.string().min(1);

/** Non-empty string for relation type identifiers. */
export const relationTypeSchema = z.string().min(1);

/** Non-empty string for signal type identifiers. */
export const signalTypeSchema = z.string().min(1);

/** Tenant ID — either 'global' or a UUID billing_account_id. */
export const tenantIdSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Source provenance schema
// ---------------------------------------------------------------------------

export const sourceProvenanceSchema = z.object({
  sourceNodeId: z.string().uuid(),
  sourceReceiptId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Entity schema (for write validation)
// ---------------------------------------------------------------------------

export const entityWriteSchema = z.object({
  tenantId: tenantIdSchema,
  entityType: entityTypeSchema,
  canonicalName: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  sourceNodeId: z.string().uuid(),
  sourceReceiptId: z.string().min(1),
  firstSeenAt: z.coerce.date(),
  lastUpdatedAt: z.coerce.date(),
});

export type EntityWrite = z.infer<typeof entityWriteSchema>;

// ---------------------------------------------------------------------------
// Relation schema (for write validation)
// ---------------------------------------------------------------------------

export const relationWriteSchema = z.object({
  tenantId: tenantIdSchema,
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationType: relationTypeSchema,
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  sourceNodeId: z.string().uuid(),
  sourceReceiptId: z.string().min(1),
});

export type RelationWrite = z.infer<typeof relationWriteSchema>;

// ---------------------------------------------------------------------------
// Observation schema (for write validation)
// ---------------------------------------------------------------------------

export const observationWriteSchema = z.object({
  tenantId: tenantIdSchema,
  entityId: z.string().uuid(),
  signalType: signalTypeSchema,
  value: z.record(z.string(), z.unknown()),
  observedAt: z.coerce.date(),
  sourceNodeId: z.string().uuid(),
  sourceReceiptId: z.string().min(1),
});

export type ObservationWrite = z.infer<typeof observationWriteSchema>;

// ---------------------------------------------------------------------------
// Attribute Schema Registry
// ---------------------------------------------------------------------------

/**
 * A map of entity_type → Zod schema for validating JSONB attributes.
 * The adapter constructor accepts this map; the wiring layer injects fork-specific schemas.
 *
 * Example usage:
 * ```ts
 * const registry = createAttributeSchemaRegistry({
 *   oss_project: z.object({ language: z.string(), stars: z.number() }),
 *   license: z.object({ spdxId: z.string(), isCopyleft: z.boolean() }),
 * });
 * ```
 */
export type AttributeSchemaRegistry = ReadonlyMap<string, z.ZodType>;

/**
 * Create an AttributeSchemaRegistry from a plain object of entity_type → ZodSchema entries.
 */
export function createAttributeSchemaRegistry(
  schemas: Record<string, z.ZodType>
): AttributeSchemaRegistry {
  return new Map(Object.entries(schemas));
}

/**
 * Validate entity attributes against the registry for the given entity_type.
 * Returns the validated attributes if a schema exists, or the raw attributes if no schema
 * is registered for this type (permissive by default — forks register schemas progressively).
 *
 * @throws {z.ZodError} if attributes fail validation against a registered schema.
 */
export function validateAttributes(
  registry: AttributeSchemaRegistry,
  entityTypeValue: string,
  attributes: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (attributes == null) return null;

  const schema = registry.get(entityTypeValue);
  if (!schema) return attributes;

  return schema.parse(attributes) as Record<string, unknown>;
}
