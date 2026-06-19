// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/domains/_handlers`
 * Purpose: HTTP handlers for the knowledge domain registry — list and register, mapping typed errors to HTTP statuses.
 * Scope: Operator-side wiring only. Does not contain business logic, validation, or storage I/O — those live in the port/adapter.
 * Invariants: VALIDATE_IO, AUTH_VIA_GETSESSIONUSER, DOMAIN_LIST_REQUIRES_PRINCIPAL
 *   (any authenticated principal — session human or bearer agent — may list
 *   domains, mirroring KNOWLEDGE_READ_REQUIRES_PRINCIPAL on /knowledge),
 *   DOMAIN_REGISTER_BEARER_OR_SESSION (federation: external bearer agents may
 *   register a domain on-demand so that downstream writes — knowledge
 *   contributions, EDO hypothesize/decide/record-outcome — can proceed against
 *   the DOMAIN_FK_ENFORCED_AT_WRITE adapter invariant without requiring a UI
 *   roundtrip).
 * Side-effects: IO (HTTP response, Doltgres read/write via container port)
 * Links: docs/spec/knowledge-domain-registry.md, docs/spec/knowledge-syntropy.md
 * @internal
 */

import { DomainAlreadyRegisteredError } from "@cogni/knowledge-store";
import {
  DomainsCreateRequestSchema,
  DomainsCreateResponseSchema,
  DomainsListResponseSchema,
} from "@cogni/node-contracts";
import type { SessionUser } from "@cogni/node-shared";
import { NextResponse } from "next/server";

import { getContainer } from "@/bootstrap/container";

function port() {
  return getContainer().knowledgeStorePort ?? null;
}

export async function handleList(
  _request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Any authenticated principal may list domains (DOMAIN_LIST_REQUIRES_PRINCIPAL).
  // Bearer agents need the registry to recall + target writes, mirroring
  // KNOWLEDGE_READ_REQUIRES_PRINCIPAL on /knowledge.
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );
  const domains = await p.listDomainsFull();
  return NextResponse.json(DomainsListResponseSchema.parse({ domains }));
}

export async function handleCreate(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Bearer agents may register a domain on-demand to satisfy
  // DOMAIN_FK_ENFORCED_AT_WRITE before downstream writes
  // (knowledge contributions + EDO hypothesize/decide/record-outcome).
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = DomainsCreateRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  try {
    const domain = await p.registerDomain({
      id: parsed.data.id,
      name: parsed.data.name,
      ...(parsed.data.description != null
        ? { description: parsed.data.description }
        : {}),
    });
    return NextResponse.json(DomainsCreateResponseSchema.parse(domain), {
      status: 201,
    });
  } catch (e: unknown) {
    if (e instanceof DomainAlreadyRegisteredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
