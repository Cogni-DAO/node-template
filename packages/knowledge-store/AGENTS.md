# knowledge-store · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

Domain types, Zod schemas, and attribute validation registry for the knowledge store canonical layer (Layer 2). Ports and adapters are added in subsequent tasks. Drizzle table definitions live in `@cogni/db-schema/knowledge` (DB_SCHEMA_OWNS_TABLES).

## Pointers

- [Knowledge Store Project](../../work/projects/proj.knowledge-store.md)
- [Research: Knowledge Store Architecture](../../docs/research/data-management-specialized-agents.md)
- [Packages Architecture](../../docs/spec/packages-architecture.md)

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** `zod`.

## Public Surface

- **Exports:**
  - Domain types: `Entity`, `Relation`, `Observation`, `EntityType`, `RelationType`, `SignalType`, `TenantId`, `SourceProvenance`
  - Type constructors: `entityType()`, `relationType()`, `signalType()`, `tenantId()`, `GLOBAL_TENANT`
  - Zod schemas: `entityWriteSchema`, `relationWriteSchema`, `observationWriteSchema`, `entityTypeSchema`, `relationTypeSchema`, `signalTypeSchema`, `tenantIdSchema`, `sourceProvenanceSchema`
  - Inferred types: `EntityWrite`, `RelationWrite`, `ObservationWrite`
  - Attribute registry: `AttributeSchemaRegistry`, `createAttributeSchemaRegistry()`, `validateAttributes()`

## Ports

- **Uses ports:** none (ports added in future task)
- **Implements ports:** none (adapters added in future task)

## Responsibilities

- This directory **does**: Define domain types, Zod schemas, attribute validation registry
- This directory **does not**: Define Drizzle tables (those are in `db-schema`), perform I/O, contain queries or adapters

## Usage

```bash
pnpm --filter @cogni/knowledge-store typecheck
pnpm --filter @cogni/knowledge-store build
```

## Standards

- Per PACKAGES_NO_SRC_IMPORTS: No `@/`, `src/`, or `services/` imports
- Per TYPES_ARE_STRINGS: Taxonomy fields are branded strings, not enums
- Per ATTRIBUTE_REGISTRY_IN_PACKAGE: Per-entity-type Zod schemas registered here, not in db-schema

## Dependencies

- **Internal:** none (standalone domain package)
- **External:** `zod`

## Change Protocol

- Update this file when public exports change
- Coordinate with `db-schema/AGENTS.md` for schema changes

## Notes

- Attribute schema registry is permissive by default — unknown entity types pass validation
- Future tasks will add `src/port/` and `src/adapters/` directories
