// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/domain/types`
 * Purpose: Domain types for the knowledge store canonical layer (Layer 2).
 * Scope: Pure TypeScript types — Entity, Relation, Observation, and string-typed taxonomy fields. Does not contain Zod schemas, I/O, or adapter code.
 * Invariants:
 * - TYPES_ARE_STRINGS: entity_type, relation_type, signal_type are branded strings, not enums.
 * - ATTRIBUTES_JSONB: Entity attributes are typed as Record<string, unknown>.
 * - PROVENANCE_REQUIRED: Every row references source_node_id + source_receipt_id.
 * Side-effects: none
 * Links: work/projects/proj.knowledge-store.md
 * @public
 */

// ---------------------------------------------------------------------------
// Branded string types for taxonomy fields
// ---------------------------------------------------------------------------

/** Entity type identifier (e.g., "oss_project", "license", "category"). */
export type EntityType = string & { readonly __brand: "EntityType" };

/** Relation type identifier (e.g., "alternative_to", "depends_on"). */
export type RelationType = string & { readonly __brand: "RelationType" };

/** Signal type identifier (e.g., "star_count", "commit_frequency"). */
export type SignalType = string & { readonly __brand: "SignalType" };

/** Tenant identifier — either 'global' or a billing_account_id. */
export type TenantId = string & { readonly __brand: "TenantId" };

// ---------------------------------------------------------------------------
// Constructor helpers
// ---------------------------------------------------------------------------

export function entityType(value: string): EntityType {
  return value as EntityType;
}

export function relationType(value: string): RelationType {
  return value as RelationType;
}

export function signalType(value: string): SignalType {
  return value as SignalType;
}

export function tenantId(value: string): TenantId {
  return value as TenantId;
}

/** Well-known tenant for shared domain knowledge visible to all tenants. */
export const GLOBAL_TENANT: TenantId = tenantId("global");

// ---------------------------------------------------------------------------
// Provenance — FK reference back to ingestion_receipts
// ---------------------------------------------------------------------------

/** Composite reference to a raw ingestion receipt (Layer 0). */
export interface SourceProvenance {
  readonly sourceNodeId: string;
  readonly sourceReceiptId: string;
}

// ---------------------------------------------------------------------------
// Entity — one row per real-world thing
// ---------------------------------------------------------------------------

export interface Entity {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly entityType: EntityType;
  readonly canonicalName: string;
  readonly attributes: Record<string, unknown> | null;
  readonly sourceNodeId: string;
  readonly sourceReceiptId: string;
  readonly firstSeenAt: Date;
  readonly lastUpdatedAt: Date;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Relation — typed directed edge between two entities
// ---------------------------------------------------------------------------

export interface Relation {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly relationType: RelationType;
  readonly attributes: Record<string, unknown> | null;
  readonly sourceNodeId: string;
  readonly sourceReceiptId: string;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Observation — temporal signal (time-series fact about an entity)
// ---------------------------------------------------------------------------

export interface Observation {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly entityId: string;
  readonly signalType: SignalType;
  readonly value: Record<string, unknown>;
  readonly observedAt: Date;
  readonly sourceNodeId: string;
  readonly sourceReceiptId: string;
  readonly createdAt: Date;
}
