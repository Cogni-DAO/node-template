// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-doltgres-schema/knowledge`
 * Purpose: Poly's Doltgres knowledge schema. Re-exports the base `knowledge`
 *   tables from @cogni/poly-knowledge; poly-specific companion tables
 *   (e.g. polyMarketCategories) land here when needed.
 * Scope: Drizzle table definitions only. Targets Doltgres via pg wire protocol (dialect: postgresql).
 * Invariants:
 *   - DB_PER_NODE: this schema applies to `knowledge_poly` only.
 *   - SCHEMA_GENERIC_CONTENT_SPECIFIC: poly-specific content lives in rows (domain + tags JSONB), not columns. Add companion tables here only for genuinely new entities.
 *   - Dialect separation: this package is NOT globbed by nodes/poly/drizzle.config.ts (which targets Postgres); only by nodes/poly/drizzle.doltgres.config.ts.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/multi-node-tenancy.md
 * @public
 */

export {
  citations,
  domains,
  knowledge,
  knowledgeContributions,
  sources,
} from "@cogni/poly-knowledge";

// Poly-specific companion tables go here as they're needed, e.g.:
// export const polyMarketCategories = pgTable("poly_market_categories", { ... });
