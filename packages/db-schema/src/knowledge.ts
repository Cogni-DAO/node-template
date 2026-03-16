// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/knowledge`
 * Purpose: Drizzle table definitions for the knowledge store canonical layer (Layer 2).
 * Scope: Defines knowledge tables (knowledgeEntities, knowledgeRelations, knowledgeObservations). Does not contain queries, business logic, or I/O.
 * Invariants:
 * - DB_SCHEMA_OWNS_TABLES: These tables are the single source of truth for knowledge store schema.
 * - TYPES_ARE_STRINGS: entity_type, relation_type, signal_type are text columns, not Postgres enums.
 * - TENANT_SCOPED: All tables include tenant_id for RLS.
 * - ATTRIBUTES_JSONB: Entity attributes are JSONB, validated by Zod at app layer.
 * - PROVENANCE_REQUIRED: Every row has source_node_id + source_receipt_id FK to ingestion_receipts.
 * - SEPARATE_TABLES: Entity, relation, observation are separate tables with different lifecycles.
 * Side-effects: none (schema definitions only)
 * Links: work/projects/proj.knowledge-store.md
 * @public
 */

import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ingestionReceipts } from "./attribution";

// ---------------------------------------------------------------------------
// Knowledge Entities — canonical domain objects (Layer 2)
// ---------------------------------------------------------------------------

/**
 * Knowledge entities — one row per real-world thing.
 * TENANT_SCOPED: tenant_id = 'global' for shared, billing_account_id for private.
 * TYPES_ARE_STRINGS: entity_type is text, validated by Zod at app layer.
 * Exact-match dedup via (tenant_id, entity_type, canonical_name) unique index.
 */
export const knowledgeEntities = pgTable(
  "knowledge_entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityType: text("entity_type").notNull(),
    canonicalName: text("canonical_name").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    sourceNodeId: uuid("source_node_id").notNull(),
    sourceReceiptId: text("source_receipt_id").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastUpdatedAt: timestamp("last_updated_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_entities_dedup_idx").on(
      table.tenantId,
      table.entityType,
      table.canonicalName
    ),
    index("knowledge_entities_tenant_type_idx").on(
      table.tenantId,
      table.entityType
    ),
    index("knowledge_entities_tenant_name_idx").on(
      table.tenantId,
      table.canonicalName
    ),
    foreignKey({
      columns: [table.sourceNodeId, table.sourceReceiptId],
      foreignColumns: [ingestionReceipts.nodeId, ingestionReceipts.receiptId],
      name: "knowledge_entities_source_fk",
    }),
  ]
);

// ---------------------------------------------------------------------------
// Knowledge Relations — typed directed edges between entities
// ---------------------------------------------------------------------------

/**
 * Knowledge relations — typed directed edge between two entities.
 * TYPES_ARE_STRINGS: relation_type is text, validated by Zod at app layer.
 * Unique per (tenant_id, source_entity_id, target_entity_id, relation_type).
 */
export const knowledgeRelations = pgTable(
  "knowledge_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => knowledgeEntities.id),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => knowledgeEntities.id),
    relationType: text("relation_type").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    sourceNodeId: uuid("source_node_id").notNull(),
    sourceReceiptId: text("source_receipt_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_relations_dedup_idx").on(
      table.tenantId,
      table.sourceEntityId,
      table.targetEntityId,
      table.relationType
    ),
    index("knowledge_relations_source_idx").on(
      table.tenantId,
      table.sourceEntityId
    ),
    index("knowledge_relations_target_idx").on(
      table.tenantId,
      table.targetEntityId
    ),
    foreignKey({
      columns: [table.sourceNodeId, table.sourceReceiptId],
      foreignColumns: [ingestionReceipts.nodeId, ingestionReceipts.receiptId],
      name: "knowledge_relations_source_fk",
    }),
  ]
);

// ---------------------------------------------------------------------------
// Knowledge Observations — temporal signals (time-series facts about entities)
// ---------------------------------------------------------------------------

/**
 * Knowledge observations — temporal signal about an entity.
 * Observations accumulate; the latest observation is the "current" value.
 * TYPES_ARE_STRINGS: signal_type is text, validated by Zod at app layer.
 */
export const knowledgeObservations = pgTable(
  "knowledge_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => knowledgeEntities.id),
    signalType: text("signal_type").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceNodeId: uuid("source_node_id").notNull(),
    sourceReceiptId: text("source_receipt_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("knowledge_observations_type_idx").on(
      table.tenantId,
      table.entityId,
      table.signalType
    ),
    index("knowledge_observations_time_idx").on(
      table.tenantId,
      table.entityId,
      table.observedAt
    ),
    foreignKey({
      columns: [table.sourceNodeId, table.sourceReceiptId],
      foreignColumns: [ingestionReceipts.nodeId, ingestionReceipts.receiptId],
      name: "knowledge_observations_source_fk",
    }),
  ]
);
