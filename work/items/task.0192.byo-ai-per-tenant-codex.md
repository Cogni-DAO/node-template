---
id: task.0192
type: task
title: "v1: Per-tenant BYO-AI — profile link + per-user Codex execution"
status: needs_implement
priority: 2
rank: 15
estimate: 5
summary: "Profile page 'Connect ChatGPT' button triggers OAuth PKCE flow, stores encrypted tokens in provider_credentials table, CodexGraphProvider resolves per-user tokens at runtime via env injection."
outcome: "Any authenticated user can link their ChatGPT account on the profile page, select Codex graphs in chat, and run AI at $0 using their own subscription. No file-backed auth, no app-server sidecar."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr:
reviewer:
created: 2026-03-23
updated: 2026-03-22
labels: [ai, oauth, byo-ai, codex, multi-tenant]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 1
blocked_by: [task.0191]
deploy_verified: false
---

## Design

### Outcome

Authenticated users can connect their ChatGPT subscription via a "Link" button on the profile page, then select Codex graphs in the chat UI and execute AI using their own subscription at $0 marginal cost.

### Approach

**Solution**: Extend the existing profile page OAuth linking pattern (GitHub/Discord/Google) with a new "AI Providers" section for ChatGPT. OAuth PKCE flow via Next.js API routes. Encrypted token storage in a new `provider_credentials` table. `CodexGraphProvider` resolves per-user tokens from DB and injects them via the Codex SDK's `env` option.

**Reuses**:

- Profile page `SettingRow` + `ConnectedBadge` components (exact same UX pattern as GitHub/Discord/Google linking)
- `@mariozechner/pi-ai/oauth` — `refreshOpenAICodexToken()` for token refresh (already a dependency)
- OpenAI PKCE OAuth constants/flow from `scripts/dev/codex-login.mts` (same client ID, endpoints, scope)
- Codex SDK `CodexOptions.env` for per-invocation auth injection (no sidecar needed)
- Drizzle schema patterns from `packages/db-schema` (pgTable, RLS, check constraints)
- Existing `billing_accounts` FK pattern for per-user resources

**Rejected**:

- **Codex app-server sidecar with `chatgptAuthTokens`**: The app-server is designed for rich IDE clients (VS Code extension), not for our use case of stateless HTTP-triggered graph runs. It adds a long-running sidecar process, JSON-RPC lifecycle management, and multi-user token routing — all unnecessary complexity when the SDK's `env` option lets us inject auth per-invocation. Reject: adds 3 new moving parts for zero user benefit.
- **LiteLLM virtual keys**: Codex uses non-standard transport (WebSocket + Responses API to `chatgpt.com`), not OpenAI API. LiteLLM can't route Codex traffic. Already rejected in research doc.
- **Token paste UX (user copies refresh token from CLI)**: Poor UX, exposes raw tokens to clipboard, requires users to have CLI access. OAuth redirect is the standard pattern we already use for 3 other providers.

### Architecture

```
Profile page                                           Runtime
┌──────────────────┐                        ┌──────────────────────────┐
│ "Connect ChatGPT"│                        │   CodexGraphProvider     │
│     [Link]       │                        │                          │
│        │         │                        │ 1. Read user tokens from │
│        ▼         │                        │    provider_credentials  │
│ GET /api/.../    │                        │ 2. Write temp auth.json  │
│   authorize      │                        │ 3. new Codex({ env: {   │
│        │         │                        │      HOME: tempDir } })  │
│        ▼         │                        │ 4. Execute graph         │
│ Redirect to      │                        │ 5. Cleanup temp dir      │
│ auth.openai.com  │                        └──────────────────────────┘
│        │         │
│        ▼         │
│ GET /api/.../    │
│   callback       │
│        │         │
│        ▼         │
│ Encrypt + store  │
│ in DB            │
└──────────────────┘
```

### Pre-Implementation Gate

**Redirect URI validation** (must confirm before building):

The public OAuth client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) is designed for CLI use with `redirect_uri=http://localhost:1455/auth/callback`. Web apps need a different redirect URI (e.g., `https://app.cogni.dev/api/v1/auth/openai-codex/callback`).

Test: Make a PKCE authorize request with our web callback URL. If OpenAI rejects it:

- **Fallback A**: Device Code flow (`codex login --device-auth`) — user enters a code on auth.openai.com. Works in web UX but requires user to enable device auth in ChatGPT settings (beta).
- **Fallback B**: Popup relay — open a popup to `localhost:1455`, relay token back via `postMessage`. Only works if user has the Codex CLI installed locally.

If neither fallback is viable, this task is blocked on OpenAI providing a web-compatible OAuth client.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TOKENS_ENCRYPTED_AT_REST: Access/refresh tokens in `provider_credentials` must be encrypted with AES-256-GCM using a server-side key (`PROVIDER_CREDENTIAL_KEY` env var). Never stored plaintext.
- [ ] TOKENS_NEVER_LOGGED: Token values must never appear in logs, error messages, or API responses. Log `accountId` and `expiresAt` only.
- [ ] ON_DEMAND_REFRESH: Token refresh happens at execution time (check expiry with 5min buffer before each Codex run), not via background cron. Simpler, fewer moving parts.
- [ ] TEMP_AUTH_CLEANUP: Temp auth.json files written for Codex CLI must be cleaned up in a `finally` block after execution completes.
- [ ] CREDIT_CHECK_BYPASS_PRESERVED: `codex:` namespace continues to skip platform credit check (already implemented in v0).
- [ ] SAME_UX_PATTERN: Profile page "Connect ChatGPT" uses the same `SettingRow` + `ConnectedBadge` pattern as GitHub/Discord/Google.
- [ ] SIMPLE_SOLUTION: Leverages existing patterns/OSS over bespoke code
- [ ] ARCHITECTURE_ALIGNMENT: Follows established patterns (spec: architecture)

### Files

#### DB Schema & Migration

- Create: `packages/db-schema/src/provider-credentials.ts` — `provider_credentials` table: `id` (text PK), `user_id` (FK → users), `provider` (text, CHECK IN ('openai-codex')), `access_token_enc` (bytea), `refresh_token_enc` (bytea), `expires_at` (timestamp), `account_id` (text), `encryption_key_id` (text), `created_at`, `updated_at`. RLS enabled. UNIQUE(user_id, provider).
- Modify: `packages/db-schema/src/index.ts` — export new table
- Create: `scripts/migrations/XXXX_add_provider_credentials.sql` — DDL + RLS policies

#### Encryption Utility

- Create: `apps/web/src/adapters/server/crypto/credential-cipher.ts` — `encrypt(plaintext, key): { ciphertext, iv, keyId }` and `decrypt(ciphertext, iv, key): string`. AES-256-GCM via Node.js `crypto`. Key from `PROVIDER_CREDENTIAL_KEY` env var.

#### OAuth Routes

- Create: `apps/web/src/app/api/v1/auth/openai-codex/authorize/route.ts` — GET handler. Generates PKCE verifier/challenge, stores verifier in encrypted httpOnly cookie (same pattern as NextAuth CSRF), redirects to `auth.openai.com/oauth/authorize`.
- Create: `apps/web/src/app/api/v1/auth/openai-codex/callback/route.ts` — GET handler. Exchanges code for tokens, decodes JWT for `accountId`, encrypts tokens, upserts `provider_credentials` row, redirects to `/profile?linked=openai-codex`.
- Create: `apps/web/src/app/api/v1/auth/openai-codex/disconnect/route.ts` — POST handler. Deletes `provider_credentials` row for current user + provider. Redirects to `/profile`.

#### Provider Token Resolution

- Create: `apps/web/src/features/ai/services/codex-credential.service.ts` — `resolveCodexCredentials(userId): { accessToken, refreshToken, expiresAt, accountId } | null`. Reads from DB, decrypts, refreshes if expired (using `refreshOpenAICodexToken`), writes refreshed tokens back.

#### CodexGraphProvider v1

- Modify: `apps/web/src/adapters/server/ai/codex/codex-graph.provider.ts` — Accept `userId` from `ExecutionContext`. Call `resolveCodexCredentials(userId)`. Write temp `~/.codex/auth.json` in a temp dir. Pass `env: { HOME: tempDir, ...process.env }` to `new Codex()`. Cleanup in `finally`.

#### Profile Page UI

- Modify: `apps/web/src/app/(app)/profile/view.tsx` — Add "AI Providers" section after "Wallet & Connected Accounts". New `SettingRow` with ChatGPT/OpenAI icon, "Connect ChatGPT" link button (or `ConnectedBadge` if already linked). Add API call to check if `openai-codex` credentials exist for current user.
- Create: `apps/web/src/components/kit/data-display/OpenAIIcon.tsx` — Simple OpenAI logomark SVG component (same pattern as `GitHubIcon`, `DiscordIcon`).
- Modify: `apps/web/src/components/index.ts` — export `OpenAIIcon`

#### API: User Credentials Status

- Create: `apps/web/src/app/api/v1/users/me/ai-providers/route.ts` — GET handler. Returns `{ providers: [{ provider: "openai-codex", connected: true, accountId: "...", expiresAt: "..." }] }`. No tokens in response.

#### Tests

- Test: `tests/unit/adapters/credential-cipher.test.ts` — encrypt/decrypt roundtrip, wrong key fails, different IVs
- Test: `tests/unit/features/codex-credential-service.test.ts` — token resolution, refresh on expiry, null when not connected
- Test: `tests/contract/provider-credentials.test.ts` — DB schema contract (insert, read, unique constraint, RLS)
- Test: `tests/stack/byo-ai-profile-link.stack.test.ts` — full flow: mock OAuth callback → tokens stored → GET ai-providers shows connected → Codex execution uses stored tokens

## Design Requirements (Original, Preserved)

1. **OAuth flow in web UI** — "Connect ChatGPT" button on profile page
2. **Credential storage** — `provider_credentials` table with encrypted access/refresh tokens per user
3. ~~**Codex app-server sidecar**~~ — Replaced by SDK `env` injection (simpler, no sidecar)
4. ~~**Host-managed token refresh via JSON-RPC**~~ — Replaced by on-demand refresh at execution time
5. **CodexGraphProvider v1 backend** — resolves tenant token from DB, supplies via temp auth.json + `env`
6. **No file-backed auth** — v0 pattern does not scale; per-user tokens from DB

## Validation

- [ ] User connects ChatGPT account via browser OAuth on profile page
- [ ] Tokens encrypted at rest in provider_credentials (AES-256-GCM)
- [ ] Codex graphs execute using the user's own subscription
- [ ] Token refresh works transparently when tokens expire (on-demand)
- [ ] Multiple concurrent users with different subscriptions work
- [ ] Disconnecting removes credentials from DB
- [ ] No tokens appear in logs or API responses
