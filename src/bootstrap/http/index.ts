// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/http`
 * Purpose: HTTP route utilities for bootstrapping.
 * Scope: Bootstrap-layer exports for route handlers; creates bound wrapPublicRoute singleton.
 * Invariants: All /api/v1/public/** routes MUST use wrapPublicRoute(); enforced by CI test.
 * Side-effects: Initializes bound wrapPublicRoute from container on module load
 * Notes: wrapPublicRoute bound once at composition root; routes get stable wrapper.
 * Links: Re-exports from bootstrap/http/*; CI enforcement in tests/meta/public-route-enforcement.test.ts.
 * @public
 */

import { getContainer } from "@/bootstrap/container";
import { publicApiLimiter } from "./rateLimiter";
import { makeWrapPublicRoute } from "./wrapPublicRoute";

export {
  extractClientIp,
  publicApiLimiter,
  TokenBucketRateLimiter,
} from "./rateLimiter";
export { wrapRouteHandlerWithLogging } from "./wrapRouteHandlerWithLogging";

/**
 * Public route wrapper - bound to container config singleton.
 * Created once at module load; all routes share the same deps.
 *
 * All routes under /api/v1/public/** MUST use this wrapper.
 *
 * @example
 * export const GET = wrapPublicRoute(
 *   { routeId: "analytics.summary", cacheTtlSeconds: 60 },
 *   async (ctx, request) => {
 *     const data = await getSomePublicData();
 *     return NextResponse.json(data);
 *   }
 * );
 */
export const wrapPublicRoute = makeWrapPublicRoute({
  rateLimitBypass: getContainer().config.rateLimitBypass,
  rateLimiter: publicApiLimiter,
  DEPLOY_ENVIRONMENT: getContainer().config.DEPLOY_ENVIRONMENT,
});
