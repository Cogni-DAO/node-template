// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/connect`
 * Purpose: HTTP POST — provision a per-tenant Polymarket trading wallet via
 *   the `PolyTraderWalletPort`. Idempotent per the port contract. First slice
 *   of task.0318 Phase B; allows exercising the Privy-per-user plumbing on
 *   candidate-a before the full onboarding UX ships.
 * Scope: Thin validator; delegates to the adapter. No on-chain allowances
 *   here (B3), no grant issuance here (B4), no withdraw here (follow-up).
 * Invariants:
 *   - CUSTODIAL_CONSENT: request must carry `custodialConsentAcknowledged:
 *     true`; backend persists the acceptance on the row.
 *   - TENANT_SCOPED: tenant is derived from the authenticated session's
 *     billing account; the request body cannot override it.
 *   - SEPARATE_PRIVY_APP: enforced at adapter construction time (see
 *     `@/adapters/server/wallet#getPolyTraderWalletAdapter`).
 * Side-effects: IO (Privy API call, DB writes).
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318
 * @public
 */

import { toUserId } from "@cogni/ids";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/app/_lib/auth/session";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/adapters/server/wallet";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";

const ConnectRequestSchema = z.object({
  custodialConsentAcknowledged: z.literal(true, {
    errorMap: () => ({
      message:
        "Custodial consent must be explicitly acknowledged — set custodialConsentAcknowledged: true.",
    }),
  }),
  custodialConsentActorKind: z.enum(["user", "agent"]),
  custodialConsentActorId: z.string().min(1),
});

const ConnectResponseSchema = z.object({
  connection_id: z.string().uuid(),
  funder_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  requires_funding: z.boolean(),
  suggested_usdc: z.number().positive(),
  suggested_matic: z.number().positive(),
});

export type PolyWalletConnectResponse = z.infer<typeof ConnectResponseSchema>;

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.connect",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = ConnectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Defense-in-depth: if the request claims actor_kind=user, the actor_id
    // MUST match the session user's id. Agent-kind callers carry their own
    // id (API-key binding — validated in a follow-up slice).
    if (
      parsed.data.custodialConsentActorKind === "user" &&
      parsed.data.custodialConsentActorId !== sessionUser.id
    ) {
      return NextResponse.json(
        { error: "Consent actor id mismatches session user" },
        { status: 400 },
      );
    }

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.logger);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        ctx.logger.warn(
          { err: err.message },
          "poly.wallet.connect rejected — adapter unconfigured",
        );
        return NextResponse.json(
          {
            error: "Poly trading wallets not configured on this deployment",
            reason: err.message,
          },
          { status: 503 },
        );
      }
      throw err;
    }

    const result = await adapter.provision({
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
      custodialConsent: {
        acceptedAt: new Date(),
        actorKind: parsed.data.custodialConsentActorKind,
        actorId: parsed.data.custodialConsentActorId,
      },
    });

    const payload: PolyWalletConnectResponse = {
      connection_id: result.connectionId,
      funder_address: result.funderAddress,
      requires_funding: true,
      suggested_usdc: 5,
      suggested_matic: 0.1,
    };
    return NextResponse.json(ConnectResponseSchema.parse(payload));
  },
);
