// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/connections/local-broker.adapter`
 * Purpose: Local-auth implementation of ConnectionBrokerPort for single-trusted-runner crawl phase.
 * Scope: Reads credentials from ~/.codex/auth.json. No DB, no encryption. Will be replaced by
 *   DrizzleConnectionBrokerAdapter (walk) or app-server chatgptAuthTokens (run).
 * Invariants:
 * - BROKER_RESOLVES_ALL: Same port interface as the real broker.
 * - TOKENS_NEVER_LOGGED: Resolved credentials must not appear in logs.
 * - SINGLE_TRUSTED_RUNNER: Only safe for one auth.json per machine or serialized workflow stream.
 * Side-effects: IO (reads auth.json from disk)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @internal
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ConnectionBrokerPort, ResolvedConnection } from "@/ports";

/** Shape of ~/.codex/auth.json as written by `codex login` */
interface CodexAuthFile {
  auth_mode: string;
  tokens: {
    id_token?: string;
    access_token: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: number;
}

const AUTH_JSON_PATH = join(homedir(), ".codex", "auth.json");

/**
 * Local connection broker backed by ~/.codex/auth.json.
 *
 * Crawl-phase adapter: any connectionId resolves to the local Codex auth file.
 * The connectionId value is ignored — there's only one set of credentials on this machine.
 * billingAccountId is not verified (single-tenant, no DB).
 *
 * This adapter will be replaced by DrizzleConnectionBrokerAdapter (walk) which
 * reads encrypted credentials from the connections table, or by an app-server
 * adapter (run) using chatgptAuthTokens host-managed auth.
 */
export class LocalConnectionBrokerAdapter implements ConnectionBrokerPort {
  async resolve(
    _connectionId: string,
    _billingAccountId: string
  ): Promise<ResolvedConnection> {
    if (!existsSync(AUTH_JSON_PATH)) {
      throw new Error(
        `Codex auth not found at ${AUTH_JSON_PATH}. Run: codex login`
      );
    }

    const raw = readFileSync(AUTH_JSON_PATH, "utf-8");
    const auth = JSON.parse(raw) as CodexAuthFile;

    if (!auth.tokens?.access_token) {
      throw new Error(
        "No access_token in ~/.codex/auth.json. Run: codex login"
      );
    }

    return {
      connectionId: "local",
      provider: "openai-chatgpt",
      credentialType: "oauth2",
      credentials: {
        accessToken: auth.tokens.access_token,
        ...(auth.tokens.refresh_token
          ? { refreshToken: auth.tokens.refresh_token }
          : {}),
        ...(auth.tokens.account_id
          ? { accountId: auth.tokens.account_id }
          : {}),
        ...(auth.tokens.id_token ? { idToken: auth.tokens.id_token } : {}),
      },
      expiresAt: null,
      scopes: [],
    };
  }
}
