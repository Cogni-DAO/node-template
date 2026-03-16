// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store`
 * Purpose: Public barrel export for the knowledge store capability package.
 * Scope: Re-exports domain types and Zod schemas. Does not contain I/O or adapter code.
 * Invariants:
 * - PACKAGES_NO_SRC_IMPORTS: No imports from `@/` or `src/` paths.
 * - DB_SCHEMA_OWNS_TABLES: No Drizzle table definitions here — those live in `@cogni/db-schema/knowledge`.
 * Side-effects: none
 * Links: work/projects/proj.knowledge-store.md
 * @public
 */

// Zod schemas and validation
export type {
  AttributeSchemaRegistry,
  EntityWrite,
  ObservationWrite,
  RelationWrite,
} from "./domain/schemas.js";
export {
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
} from "./domain/schemas.js";
// Domain types
export type {
  Entity,
  EntityType,
  Observation,
  Relation,
  RelationType,
  SignalType,
  SourceProvenance,
  TenantId,
} from "./domain/types.js";
export {
  entityType,
  GLOBAL_TENANT,
  relationType,
  signalType,
  tenantId,
} from "./domain/types.js";
