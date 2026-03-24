#!/usr/bin/env node
/**
 * Seed a BYO-AI connection from codex:login tokens.
 *
 * Reads CODEX_ACCESS_TOKEN/CODEX_REFRESH_TOKEN from .env.local (written by pnpm codex:login),
 * encrypts them with AEAD, and inserts a connections row for the first user's billing account.
 *
 * Prerequisites:
 *   1. pnpm codex:login (to get tokens)
 *   2. CONNECTIONS_ENCRYPTION_KEY in .env.local (64 hex chars)
 *   3. Database running with connections table (pnpm db:migrate)
 *
 * Usage: pnpm codex:seed-connection
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const ENV_FILE = resolve(import.meta.dirname, "../../.env.local");

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) {
    console.error("No .env.local found. Run: pnpm codex:login");
    process.exit(1);
  }
  const result: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

async function main() {
  const envVars = readEnv();

  const accessToken = envVars.CODEX_ACCESS_TOKEN;
  const refreshToken = envVars.CODEX_REFRESH_TOKEN;
  const accountId = envVars.CODEX_ACCOUNT_ID;
  const expiresAt = envVars.CODEX_EXPIRES_AT;

  if (!accessToken || !refreshToken) {
    console.error(
      "Missing CODEX_ACCESS_TOKEN or CODEX_REFRESH_TOKEN in .env.local"
    );
    console.error("Run: pnpm codex:login");
    process.exit(1);
  }

  let encKeyHex = envVars.CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) {
    // Auto-generate and append to .env.local
    encKeyHex = randomBytes(32).toString("hex");
    const { appendFileSync } = await import("node:fs");
    appendFileSync(ENV_FILE, `\nCONNECTIONS_ENCRYPTION_KEY=${encKeyHex}\n`);
    console.log(`Generated CONNECTIONS_ENCRYPTION_KEY and saved to .env.local`);
  }

  const encKey = Buffer.from(encKeyHex, "hex");
  if (encKey.length !== 32) {
    console.error("CONNECTIONS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    process.exit(1);
  }

  // Connect to DB
  const dbUrl = envVars.DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set in .env.local or environment");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    // Find the first user's billing account
    const { rows: accounts } = await pool.query(
      "SELECT id FROM billing_accounts LIMIT 1"
    );
    if (accounts.length === 0) {
      console.error("No billing accounts found. Sign in to the app first.");
      process.exit(1);
    }
    const billingAccountId = accounts[0].id;

    // Find the user who owns this billing account
    const { rows: users } = await pool.query(
      "SELECT owner_user_id FROM billing_accounts WHERE id = $1",
      [billingAccountId]
    );
    const userId = users[0].owner_user_id;

    // Check for existing active connection
    const { rows: existing } = await pool.query(
      "SELECT id FROM connections WHERE billing_account_id = $1 AND provider = 'openai-chatgpt' AND revoked_at IS NULL",
      [billingAccountId]
    );

    const connectionId = existing.length > 0 ? existing[0].id : undefined;

    // Build credential blob
    const credBlob = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId || "",
      expires_at: expiresAt ? new Date(Number(expiresAt)).toISOString() : "",
    });

    // AEAD encrypt
    const { createCipheriv } = await import("node:crypto");
    const nonce = randomBytes(12);

    if (connectionId) {
      // Update existing
      const aadFinal = JSON.stringify({
        billing_account_id: billingAccountId,
        connection_id: connectionId,
        provider: "openai-chatgpt",
      });
      const cipher = createCipheriv("aes-256-gcm", encKey, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(Buffer.from(aadFinal, "utf-8"));
      const encrypted = Buffer.concat([
        cipher.update(credBlob, "utf-8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const blob = Buffer.concat([nonce, encrypted, authTag]);

      await pool.query(
        "UPDATE connections SET encrypted_credentials = $1, encryption_key_id = 'v1', expires_at = $2 WHERE id = $3",
        [blob, expiresAt ? new Date(Number(expiresAt)) : null, connectionId]
      );
      console.log(`\nUpdated connection: ${connectionId}`);
    } else {
      // Insert new — need to generate ID first for AAD binding
      const { randomUUID } = await import("node:crypto");
      const newId = randomUUID();
      const aadFinal = JSON.stringify({
        billing_account_id: billingAccountId,
        connection_id: newId,
        provider: "openai-chatgpt",
      });
      const cipher = createCipheriv("aes-256-gcm", encKey, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(Buffer.from(aadFinal, "utf-8"));
      const encrypted = Buffer.concat([
        cipher.update(credBlob, "utf-8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const blob = Buffer.concat([nonce, encrypted, authTag]);

      await pool.query(
        `INSERT INTO connections (id, billing_account_id, provider, credential_type, encrypted_credentials, encryption_key_id, scopes, created_by_user_id, expires_at)
         VALUES ($1, $2, 'openai-chatgpt', 'oauth2', $3, 'v1', ARRAY['openid','profile','email','offline_access'], $4, $5)`,
        [
          newId,
          billingAccountId,
          blob,
          userId,
          expiresAt ? new Date(Number(expiresAt)) : null,
        ]
      );
      console.log(`\nCreated connection: ${newId}`);
    }

    // Fetch the final connection ID for display
    const { rows: final } = await pool.query(
      "SELECT id FROM connections WHERE billing_account_id = $1 AND provider = 'openai-chatgpt' AND revoked_at IS NULL",
      [billingAccountId]
    );

    console.log(`  Billing Account: ${billingAccountId}`);
    console.log(`  Provider: openai-chatgpt`);
    console.log(`  Connection ID: ${final[0].id}`);
    console.log(`  Account ID: ${accountId || "unknown"}`);
    console.log(`\nBYO-AI ready! Use this in chat requests:`);
    console.log(`  modelConnectionId: "${final[0].id}"`);
    console.log(
      `\nOr restart dev:stack — the app auto-resolves connections for users with linked ChatGPT.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
