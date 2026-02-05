---
work_item_id: wi.gh-deploy-secret-exposure
work_item_type: issue
title: "P0 SECURITY: Deploy artifacts expose all secrets"
state: In Progress
priority: 0
estimate: 2
summary: Deploy workflow uploads secrets as GitHub Actions artifact, exposing all production credentials
outcome: Secrets rotated, deploy script fixed to exclude secrets from artifacts
assignees: derek
initiative: ini.docs-system-infrastructure
created: 2026-02-06
updated: 2026-02-06
labels: [security, p0, secrets, ci]
pr:
external_refs:
---

## Summary

Deploy workflow uploads `deploy-secrets.env` as a GitHub Actions artifact, exposing ALL production and preview secrets to anyone with repo read access.

## Impact

**CRITICAL** - All secrets compromised and must be rotated:

- Database passwords (POSTGRES_ROOT_PASSWORD, APP_DB_PASSWORD, APP_DB_SERVICE_PASSWORD)
- API keys (OPENROUTER_API_KEY, LITELLM_MASTER_KEY)
- Auth secrets (AUTH_SECRET)
- GitHub tokens (SOURCECRED_GITHUB_TOKEN, GHCR_DEPLOY_TOKEN, GIT_READ_TOKEN)
- Grafana Cloud credentials (LOKI, Prometheus)
- Langfuse keys
- EVM RPC URL (contains API key)

## Root Cause

`platform/ci/scripts/deploy.sh` line 784-838 creates `deploy-secrets.env` in `$ARTIFACT_DIR`, which gets uploaded as workflow artifact.

## Fix Required

1. **Immediate**: Rotate ALL secrets for preview and production environments
2. **Code fix**: Don't upload secrets file as artifact - create it in /tmp or exclude from artifact upload
3. **Audit**: Check artifact retention, delete any existing artifacts containing secrets

## Files

- `platform/ci/scripts/deploy.sh` - Creates secrets file in artifact dir
- `.github/workflows/staging-preview.yml` - Uploads artifacts
- `.github/workflows/deploy-production.yml` - Uploads artifacts
