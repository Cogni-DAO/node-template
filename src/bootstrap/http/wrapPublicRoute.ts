// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/http/wrapPublicRoute`
 * Purpose: Factory for public API route wrapper with mandatory rate limiting and caching.
 * Scope: Public route wrapper (/api/v1/public/*); enforces rate limiting, cache headers, standard error shape. Does NOT implement business logic.
 * Invariants: All public routes MUST use this wrapper; rate limit 10 req/min/IP + burst 5; cache headers auto-applied; 429 on rate limit.
 * Side-effects: IO (rate limiter state, request context, metrics)
 * Notes: Factory pattern allows injecting config for testability; singleton export for routes.
 * Links: Used by all /api/v1/public/** routes; CI validation in tests/meta/public-route-enforcement.test.ts
 * @public
 */

import { type NextRequest, NextResponse } from "next/server";
import type { RateLimitBypassConfig } from "@/bootstrap/container";
import {
  logRequestWarn,
  publicRateLimitExceededTotal,
  type RequestContext,
} from "@/shared/observability";
import {
  extractClientIp,
  publicApiLimiter,
  type TokenBucketRateLimiter,
} from "./rateLimiter";
import { wrapRouteHandlerWithLogging } from "./wrapRouteHandlerWithLogging";

export interface PublicRouteConfig {
  routeId: string;
  cacheTtlSeconds?: number; // Default: 60
  staleWhileRevalidateSeconds?: number; // Default: 300
}

type PublicRouteHandler<TContext = unknown> = (
  ctx: RequestContext,
  request: NextRequest,
  context?: TContext
) => Promise<NextResponse>;

/**
 * Dependencies for public route wrapper factory.
 * Allows injection for testability without global state.
 */
export interface WrapPublicRouteDeps {
  rateLimitBypass: RateLimitBypassConfig;
  rateLimiter: TokenBucketRateLimiter;
  DEPLOY_ENVIRONMENT: string;
}

/**
 * Factory to create public route wrapper with injected dependencies.
 * Internal - use for unit testing only. Routes should use the exported wrapPublicRoute singleton.
 *
 * @example
 * // Unit test usage:
 * const wrapPublicRoute = makeWrapPublicRoute({
 *   rateLimitBypass: { enabled: false, headerName: "x-stack-test", headerValue: "1" },
 *   rateLimiter: publicApiLimiter,
 *   DEPLOY_ENVIRONMENT: "test",
 * });
 */
export function makeWrapPublicRoute(deps: WrapPublicRouteDeps) {
  return function wrapPublicRoute<TContext = unknown>(
    config: PublicRouteConfig,
    handler: PublicRouteHandler<TContext>
  ): (request: NextRequest, context?: TContext) => Promise<NextResponse> {
    const cacheTtl = config.cacheTtlSeconds ?? 60;
    const swr = config.staleWhileRevalidateSeconds ?? 300;

    return wrapRouteHandlerWithLogging<TContext>(
      {
        routeId: config.routeId,
        auth: { mode: "none" },
      },
      async (ctx, request, _sessionUser, context) => {
        // Rate limiting with optional test bypass
        // Security: bypass only works when config.enabled=true (set by APP_ENV=test in container)
        const bypassEnabled =
          deps.rateLimitBypass.enabled &&
          request.headers.get(deps.rateLimitBypass.headerName) ===
            deps.rateLimitBypass.headerValue;

        const clientIp = extractClientIp(request);
        const allowed = bypassEnabled || deps.rateLimiter.consume(clientIp);

        if (!allowed) {
          // Log without IP (aggregated metric provides observability)
          logRequestWarn(
            ctx.log,
            {
              routeId: config.routeId,
              env: deps.DEPLOY_ENVIRONMENT,
              zone: "public_api",
            },
            "RATE_LIMIT_EXCEEDED"
          );

          // Increment counter metric (aggregated, no PII)
          publicRateLimitExceededTotal.inc({
            route: config.routeId,
            env: deps.DEPLOY_ENVIRONMENT,
          });

          return NextResponse.json(
            { error: "Rate limit exceeded" },
            {
              status: 429,
              headers: {
                "Retry-After": "60",
                "Cache-Control": "public, max-age=5", // Short cache to reduce hammering
              },
            }
          );
        }

        // Call handler
        const response = await handler(ctx, request, context);

        // Auto-apply cache headers to successful responses
        if (response.status >= 200 && response.status < 300) {
          response.headers.set(
            "Cache-Control",
            `public, max-age=${cacheTtl}, stale-while-revalidate=${swr}`
          );
        }

        return response;
      }
    );
  };
}

// Singleton wrapper - lazily initialized from container on first use
let _wrapPublicRoute: ReturnType<typeof makeWrapPublicRoute> | null = null;

function getWrapPublicRoute(): ReturnType<typeof makeWrapPublicRoute> {
  if (!_wrapPublicRoute) {
    // Lazy import to avoid circular dependency (container imports from bootstrap/http)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getContainer } = require("@/bootstrap/container") as {
      getContainer: () => {
        config: {
          rateLimitBypass: RateLimitBypassConfig;
          DEPLOY_ENVIRONMENT: string;
        };
      };
    };

    const container = getContainer();
    _wrapPublicRoute = makeWrapPublicRoute({
      rateLimitBypass: container.config.rateLimitBypass,
      rateLimiter: publicApiLimiter,
      DEPLOY_ENVIRONMENT: container.config.DEPLOY_ENVIRONMENT,
    });
  }
  return _wrapPublicRoute;
}

/**
 * Public route wrapper with rate limiting and cache headers.
 * Uses container config singleton - all routes share the same deps.
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
export function wrapPublicRoute<TContext = unknown>(
  config: PublicRouteConfig,
  handler: PublicRouteHandler<TContext>
): (request: NextRequest, context?: TContext) => Promise<NextResponse> {
  return getWrapPublicRoute()(config, handler);
}
