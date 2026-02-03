// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/db/tenant-scope`
 * Purpose: Re-exports tenant-scope helpers from @cogni/db-client.
 * Scope: Passthrough — canonical implementation lives in packages/db-client. Does not contain implementation logic.
 * Invariants:
 * - userId must be a valid UUID v4 (validated before interpolation into SQL)
 * - SET LOCAL scopes the setting to the current transaction only (no cross-request leakage)
 * Side-effects: none (re-export only)
 * Links: docs/DATABASE_RLS_SPEC.md, packages/db-client/src/tenant-scope.ts
 * @public
 */

export { setTenantContext, withTenantScope } from "@cogni/db-client";
