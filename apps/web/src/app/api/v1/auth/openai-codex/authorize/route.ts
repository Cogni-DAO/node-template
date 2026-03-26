// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/authorize`
 * Purpose: Initiate OpenAI Codex OAuth PKCE flow for BYO-AI.
 * Scope: Generates PKCE verifier + challenge, stores verifier in signed cookie, returns redirect URL.
 * Invariants:
 *   - PKCE_REQUIRED: Uses S256 challenge, no client secret
 *   - STATE_VALIDATED: Random state stored in signed cookie
 *   - COOKIE_SIGNED: HttpOnly, short-TTL, SameSite=Lax for top-level redirect
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

  // Store verifier + state + userId in signed cookie (consumed by callback)
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

  // Build OpenAI authorize URL
  // The public Codex client ID is locked to redirect_uri=http://localhost:1455/auth/callback.
  // We use that exact URI and run a one-shot relay server on port 1455 that forwards
  // the OAuth code to our real callback route on the Next.js server.
  const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
  const realCallbackUrl = `${serverEnv().APP_BASE_URL}/api/v1/auth/openai-codex/callback`;

  // Start one-shot relay server on port 1455
  const http = await import("node:http");
  const relay = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost:1455");
    if (reqUrl.pathname === "/auth/callback") {
      // Forward all query params to our real callback
      const target = `${realCallbackUrl}?${reqUrl.searchParams.toString()}`;
      res.writeHead(302, { Location: target });
      res.end();
      // Close server after handling the one callback
      relay.close();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Listen with error handling for port-in-use
  try {
    await new Promise<void>((resolve, reject) => {
      relay.once("error", reject);
      relay.listen(1455, "127.0.0.1", () => resolve());
    });
    // Auto-close after 5 minutes if no callback received
    setTimeout(() => relay.close(), 5 * 60 * 1000);
  } catch {
    // Port 1455 in use — another flow may be running
    return NextResponse.json(
      { error: "Port 1455 in use — close any running codex login" },
      { status: 409 }
    );
  }

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
