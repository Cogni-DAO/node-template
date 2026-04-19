// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-shared/auth/scheduler-token`
 * Purpose: Constant-time bearer-token verification used by every internal API route protected by SCHEDULER_API_TOKEN.
 * Scope: Pure helpers — extract token from header, compare constant-time. Does not read env vars or import framework code.
 * Invariants: Both values are server-generated API tokens (not user passwords); direct buffer compare is safe.
 * Side-effects: none
 * Links: node-app internal API routes under /api/internal, task.0280
 * @public
 */

import { timingSafeEqual } from "node:crypto";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

export function extractSchedulerBearer(
  authHeader: string | null
): string | null {
  if (!authHeader) return null;
  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice(7).trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

export function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify an incoming request carries the correct SCHEDULER_API_TOKEN bearer.
 * Returns true on match, false otherwise (caller returns 401).
 */
export function verifySchedulerBearer(
  authHeader: string | null,
  configuredToken: string
): boolean {
  const provided = extractSchedulerBearer(authHeader);
  if (!provided) return false;
  return safeTokenCompare(provided, configuredToken);
}
