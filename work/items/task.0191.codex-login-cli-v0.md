---
id: task.0191
type: task
title: "v0: CLI Codex login script for dev environment"
status: needs_triage
priority: 2
rank: 10
estimate: 2
summary: "Create scripts/codex-login.ts using @mariozechner/pi-ai to run OpenAI Codex PKCE OAuth flow locally. Stores access/refresh tokens in .env.local. Add LiteLLM model config for Codex models. Include token refresh check at dev startup."
outcome: "Developer with ChatGPT Plus/Pro can run pnpm codex:login, authenticate via browser, and use Codex models through LiteLLM proxy at $0 marginal cost"
spec_refs: []
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-03-22
updated: 2026-03-22
labels: [ai, oauth, byo-ai, cost-control, dev-tooling]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 0
blocked_by: [spike.0190]
deploy_verified: false
---

## Acceptance Criteria

1. `pnpm codex:login` runs PKCE OAuth flow, opens browser, stores tokens to `.env.local`
2. LiteLLM config includes Codex model entries that use the stored token
3. Token refresh runs automatically if expired when dev server starts
4. `.env.local` entries: `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_EXPIRES_AT`, `CODEX_ACCOUNT_ID`
5. Works on macOS (primary dev platform)

## Validation

- [ ] `pnpm codex:login` completes OAuth flow and writes .env.local
- [ ] Dev server starts with Codex model available in LiteLLM
- [ ] Token refresh works when expired token present in .env.local
