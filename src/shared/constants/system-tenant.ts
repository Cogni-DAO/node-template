// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/constants/system-tenant`
 * Purpose: System tenant identity constants and revenue share reason string.
 * Scope: Fixed IDs for the cogni_system billing account and its owner principal. Does not contain business logic or authorization checks.
 * Invariants: IDs match the seeded records in migration 0007_system_tenant.sql.
 * Side-effects: none
 * Links: docs/spec/system-tenant.md
 * @public
 */

/** Billing account ID for the system tenant. Seeded by migration. */
export const SYSTEM_TENANT_ID = "cogni_system" as const;

/** User (principal) ID that owns the system tenant billing account. Seeded by migration. */
export const SYSTEM_TENANT_PRINCIPAL_ID = "cogni_system_principal" as const;

/** Credit ledger reason for revenue share bonus credits minted to system tenant. */
export const PLATFORM_REVENUE_SHARE_REASON = "platform_revenue_share" as const;
