// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/ledger`
 * Purpose: Epoch ledger tables for auditable credit payout decisions.
 * Scope: Defines ledger_issuers, epochs, work_receipts, receipt_events, epoch_pool_components, payout_statements. Does not contain queries or business logic.
 * Invariants:
 * - All credit/unit columns use BIGINT (ALL_MATH_BIGINT).
 * - work_receipts, receipt_events, epoch_pool_components are append-only (DB triggers in migration).
 * - ONE_OPEN_EPOCH: partial unique index on epochs.status WHERE status = 'open'.
 * - IDEMPOTENT_RECEIPTS: unique index on work_receipts.idempotency_key.
 * - No RLS in V0 — worker uses service-role connection.
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./refs";

/**
 * Issuer authorization allowlist.
 * Role flags: can_issue, can_approve, can_close_epoch (ISSUER_AUTHORIZED).
 * Address stored in lowercase hex (ADDRESS_NORMALIZED).
 */
export const ledgerIssuers = pgTable("ledger_issuers", {
  address: text("address").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  canIssue: boolean("can_issue").notNull().default(false),
  canApprove: boolean("can_approve").notNull().default(false),
  canCloseEpoch: boolean("can_close_epoch").notNull().default(false),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Epochs — one open epoch at a time (ONE_OPEN_EPOCH).
 * Policy reference pinned at open time (EPOCH_POLICY_PINNED).
 */
export const epochs = pgTable(
  "epochs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    status: text("status").notNull().default("open"),
    policyRepo: text("policy_repo").notNull(),
    policyCommitSha: text("policy_commit_sha").notNull(),
    policyPath: text("policy_path").notNull(),
    policyContentHash: text("policy_content_hash").notNull(),
    poolTotalCredits: bigint("pool_total_credits", { mode: "bigint" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("epochs_status_check", sql`${table.status} IN ('open', 'closed')`),
    uniqueIndex("epochs_one_open_unique")
      .on(table.status)
      .where(sql`${table.status} = 'open'`),
  ]
);

/**
 * Work receipts — immutable facts, append-only (RECEIPTS_IMMUTABLE).
 * DB trigger rejects UPDATE/DELETE.
 * No status column — lifecycle tracked via receipt_events.
 */
export const workReceipts = pgTable(
  "work_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    workItemId: text("work_item_id").notNull(),
    artifactRef: text("artifact_ref").notNull(),
    role: text("role").notNull(),
    valuationUnits: bigint("valuation_units", { mode: "bigint" }).notNull(),
    rationaleRef: text("rationale_ref"),
    issuerAddress: text("issuer_address").notNull(),
    issuerId: text("issuer_id")
      .notNull()
      .references(() => users.id),
    signature: text("signature").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "work_receipts_role_check",
      sql`${table.role} IN ('author', 'reviewer', 'approver')`
    ),
    check(
      "work_receipts_valuation_units_nonneg",
      sql`${table.valuationUnits} >= 0`
    ),
    uniqueIndex("work_receipts_idempotency_key_unique").on(
      table.idempotencyKey
    ),
    index("work_receipts_epoch_id_idx").on(table.epochId),
  ]
);

/**
 * Receipt events — append-only state transitions (EVENTS_APPEND_ONLY).
 * DB trigger rejects UPDATE/DELETE.
 * LATEST_EVENT_WINS: most recent event_type determines receipt state.
 */
export const receiptEvents = pgTable(
  "receipt_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => workReceipts.id),
    eventType: text("event_type").notNull(),
    actorAddress: text("actor_address").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "receipt_events_event_type_check",
      sql`${table.eventType} IN ('proposed', 'approved', 'revoked')`
    ),
    index("receipt_events_receipt_created_idx").on(
      table.receiptId,
      table.createdAt.desc()
    ),
  ]
);

/**
 * Epoch pool components — immutable, append-only (POOL_IMMUTABLE).
 * DB trigger rejects UPDATE/DELETE.
 * POOL_UNIQUE_PER_TYPE: UNIQUE(epoch_id, component_id).
 */
export const epochPoolComponents = pgTable(
  "epoch_pool_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    componentId: text("component_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    inputsJson: jsonb("inputs_json").$type<Record<string, unknown>>().notNull(),
    amountCredits: bigint("amount_credits", { mode: "bigint" }).notNull(),
    evidenceRef: text("evidence_ref"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("epoch_pool_components_epoch_component_unique").on(
      table.epochId,
      table.componentId
    ),
  ]
);

/**
 * Payout statements — one per closed epoch, derived artifact.
 * No signature in V0.
 */
export const payoutStatements = pgTable("payout_statements", {
  id: uuid("id").defaultRandom().primaryKey(),
  epochId: bigint("epoch_id", { mode: "bigint" })
    .notNull()
    .unique()
    .references(() => epochs.id),
  policyContentHash: text("policy_content_hash").notNull(),
  receiptSetHash: text("receipt_set_hash").notNull(),
  poolTotalCredits: bigint("pool_total_credits", { mode: "bigint" }).notNull(),
  payoutsJson: jsonb("payouts_json")
    .$type<
      Array<{
        user_id: string;
        total_units: string;
        share: string;
        amount_credits: string;
      }>
    >()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
