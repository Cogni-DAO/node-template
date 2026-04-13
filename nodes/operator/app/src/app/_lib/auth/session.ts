// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/auth/session`
 * Purpose: Server-side session resolver using NextAuth.
 * Scope: Server-only helper that derives a SessionUser from a NextAuth session. Does not perform database access or user existence checks.
 * Invariants: Returns null unless id is present. walletAddress may be null for OAuth-only users.
 *   MUST re-export the NextAuth-backed resolver directly (not resolveRequestIdentity), because
 *   request-identity.ts imports getSessionUser from this module — a resolveRequestIdentity re-export
 *   would create a circular call chain and unbounded async recursion on non-bearer requests.
 * Side-effects: IO (NextAuth session retrieval)
 * Notes: Thin wrapper around NextAuth session retrieval. Supports both wallet (SIWE) and OAuth-only users.
 *   Routes that need machine bearer auth must import resolveRequestIdentity from request-identity.ts directly.
 * Links: docs/spec/security-auth.md
 * @public
 */
import { getServerSessionUser } from "@/lib/auth/server";

export { getServerSessionUser as getSessionUser };
