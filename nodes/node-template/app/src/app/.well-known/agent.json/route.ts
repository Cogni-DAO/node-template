// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Resolve the public origin this request reached us through. In prod the app
 * runs behind Caddy / k8s ingress, so Next.js's `request.url` exposes the
 * in-pod bind address (e.g. `http://0.0.0.0:3000`) rather than the external
 * host clients are using. Prefer the forwarded headers the proxy injects,
 * falling back to the raw `host` and `request.url` for local/dev usage.
 */
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  return NextResponse.json({
    name: "Cogni Node API",
    version: "v1",
    registrationUrl: `${origin}/api/v1/agent/register`,
    auth: { type: "bearer", keyPrefix: "cogni_ag_sk_v1_" },
    endpoints: {
      completions: `${origin}/api/v1/chat/completions`,
      runs: `${origin}/api/v1/agent/runs`,
      runStream: `${origin}/api/v1/agent/runs/{runId}/stream`,
    },
  });
}
