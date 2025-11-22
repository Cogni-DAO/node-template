// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/auth/session`
 * Purpose: Temporary session resolver until Auth.js + SIWE integration is wired.
 * Scope: Server-only helper that derives a SessionUser from request headers; does not perform network or database access.
 * Invariants: Returns null when no override header is present; no network or database access.
 * Side-effects: none
 * Notes: Uses Auth.js session helper; no header overrides.
 * Links: docs/SECURITY_AUTH_SPEC.md
 * @public
 */
import { auth } from "@/auth";
import type { SessionUser } from "@/shared/auth";

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const walletAddress = session.user?.walletAddress;
  return walletAddress ? { id, walletAddress } : { id };
}
