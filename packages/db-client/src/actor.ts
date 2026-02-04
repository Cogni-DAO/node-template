// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/actor`
 * Purpose: Branded types for RLS actor identity — compile-time enforcement that every DB operation carries a validated actor.
 * Scope: Type definitions and constructors only. Does not perform DB operations.
 * Invariants:
 * - toUserId() is the single entry point for creating a UserId (validated UUID v4 via UUID_RE)
 * - userActor() is the only way to create an ActorId from a user
 * - SYSTEM_ACTOR is the only system constant (deterministic UUID for audit trails)
 * - No raw string escape hatches in db-client — withTenantScope accepts ActorId only
 * Side-effects: none
 * Links: docs/DATABASE_RLS_SPEC.md, tenant-scope.ts
 * @public
 */

import { UUID_RE } from "./tenant-scope";

/** Branded userId — validated UUID v4, single source of truth for user identity. */
export type UserId = string & { readonly __brand: "UserId" };

/** Actor from a user-initiated operation. Accepted by user-facing AND worker ports. */
export type UserActorId = string & { readonly __brand: "UserActorId" };

/** Actor from a system-initiated operation. Accepted by worker ports ONLY. */
export type SystemActorId = string & { readonly __brand: "SystemActorId" };

/**
 * Union actor type — accepted by withTenantScope/setTenantContext and worker ports.
 * User-facing ports must use UserActorId to reject SYSTEM_ACTOR at compile time.
 */
export type ActorId = UserActorId | SystemActorId;

/** Validate and brand a raw string as UserId. Single entry point. */
export function toUserId(raw: string): UserId {
  if (!UUID_RE.test(raw)) {
    throw new Error(`Invalid UserId (expected UUID v4): ${raw}`);
  }
  return raw as UserId;
}

/** User-initiated operation (callerUserId, grant.userId, ownerUserId). */
export function userActor(userId: UserId): UserActorId {
  return userId as unknown as UserActorId;
}

/**
 * System-initiated operation (scheduler reconciler, settlement pipeline).
 * Deterministic UUID so SET LOCAL is valid and audit logs are traceable.
 */
export const SYSTEM_ACTOR: SystemActorId =
  "00000000-0000-4000-a000-000000000000" as SystemActorId;
