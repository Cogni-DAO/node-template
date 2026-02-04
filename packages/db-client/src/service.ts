// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/service`
 * Purpose: Service-role DB client factory (BYPASSRLS) and system actor identity.
 * Scope: Exports createServiceDbClient, SYSTEM_ACTOR, SystemActorId. Does not export Database type (lives in root entrypoint).
 * Invariants:
 * - MUST NOT be imported from Next.js web runtime code (enforced by dependency-cruiser)
 * - Only drizzle.service-client.ts (getServiceDb singleton) and services/ may import this
 * - SYSTEM_ACTOR is gated here so user-facing code cannot accidentally receive it
 * Side-effects: IO (database connections)
 * Links: docs/DATABASE_RLS_SPEC.md
 * @public
 */

import { buildClient } from "./build-client";

// System actor identity — only available to service-layer code
export { SYSTEM_ACTOR, type SystemActorId } from "./actor";

/**
 * Creates a Drizzle database client for the `app_service` role (BYPASSRLS).
 * Use this for scheduler workers, internal services, and auth bootstrap only.
 * Must NOT be used in the Next.js web runtime (enforced by dependency-cruiser).
 */
export function createServiceDbClient(connectionString: string) {
  return buildClient(connectionString, "cogni_service");
}
