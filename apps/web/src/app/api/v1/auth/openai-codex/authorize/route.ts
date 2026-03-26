// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/authorize`
 * Purpose: Initiate OpenAI Codex OAuth PKCE flow for BYO-AI.
 * Scope: Generates PKCE verifier + challenge, stores verifier in signed cookie, returns auth URL.
 *   The user opens the URL in a popup, authenticates at OpenAI, and pastes the redirect URL back.
 *   Works on both local dev and cloud deployments.
 * Invariants:
 *   - PKCE_REQUIRED: Uses S256 challenge, no client secret
 *   - STATE_VALIDATED: Random state stored in signed cookie
 *   - COOKIE_SIGNED: HttpOnly, short-TTL, SameSite=Lax
 * Side-effects: IO (cookie set)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @public
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

import { authSecret } from "@/auth";
import { getServerSessionUser } from "@/lib/auth/server";
import { serverEnv } from "@/shared/env";

export const runtime = "nodejs";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
// The public Codex client ID is locked to this exact redirect URI.
// After auth, the browser navigates here — the user copies the URL
// (which contains the auth code) and pastes it back into our UI.
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const PKCE_COOKIE = "codex_pkce";
const PKCE_SALT = "codex-pkce";
const PKCE_TTL = 5 * 60; // 5 minutes

export async function POST() {
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Generate PKCE verifier + S256 challenge
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  // Store verifier + state + userId in signed cookie (consumed by exchange endpoint)
  const token = await encode({
    token: { verifier, state, userId: session.id, purpose: "codex_pkce" },
    secret: authSecret,
    salt: PKCE_SALT,
    maxAge: PKCE_TTL,
  });

  const cookieStore = await cookies();
  cookieStore.set(PKCE_COOKIE, token, {
    httpOnly: true,
    secure: serverEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth/openai-codex",
    maxAge: PKCE_TTL,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: OPENAI_REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    codex_cli_simplified_flow: "true",
    id_token_add_organizations: "true",
  });

  return NextResponse.json({
    url: `${OPENAI_AUTHORIZE_URL}?${params.toString()}`,
  });
}
