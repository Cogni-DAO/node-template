---
id: secrets-add-new-guide
type: guide
title: Add a New Secret to a Service
status: draft
trust: draft
summary: How to add a new secret to a Cogni service-env path. Spoiler — it's one CLI command. No pod spec edit, no kustomize edit, no YAML PR.
read_when: A developer or agent needs to add a new secret (e.g., a new API key for a service to consume).
owner: derekg1729
created: 2026-05-19
verified: 2026-05-19
tags:
  - secrets
  - guides
---

# Add a New Secret to a Service

> **The whole guide is one paragraph long.** That's the point — adding a secret is a control-plane operation, not a YAML rewrite. If you find yourself editing a pod spec or an ExternalSecret YAML, you're doing it wrong; come back here.

## The flow

Adding a new secret named `OPENAI_API_KEY` to `node-template` service on `candidate-a`:

```bash
pnpm secrets:set candidate-a node-template OPENAI_API_KEY
# Prompts for value via secure stdin (never echoes, never enters shell history)
```

Done. The CLI writes to OpenBao at `cogni/candidate-a/node-template`, key `OPENAI_API_KEY`. ESO pulls on the next refresh (default 1h; can be forced — see below). Stakater Reloader detects the k8s Secret change and triggers a rolling pod restart. The new env var `OPENAI_API_KEY` is available to the pod after restart.

**If your CODE needs to read the new value:** that's still a normal PR — your code change (`process.env.OPENAI_API_KEY`, or your typed-config schema) goes through CI like any other code. But the SECRET itself does not require a PR.

## What you didn't have to do

- Edit `infra/k8s/secrets/external-secrets/candidate-a/node-template/external-secret.yaml` (the ExternalSecret already pulls every key at the path)
- Edit `infra/k8s/base/node-app/deployment.yaml` (the pod's `envFrom: secretRef` already pulls every key from the synced k8s Secret)
- Run `kubectl` anything (Argo reconciles + ESO syncs + Reloader restarts)
- Touch the `OPENBAO_SEED_TOKEN` in GitHub env secrets (that's an automated path; you never touch it)

This is the contract from [`docs/spec/secrets-management.md`](../spec/secrets-management.md), enforced by ESO's `dataFrom: extract` pattern (one ExternalSecret per service-env, pulls all keys; published canonical pattern: [ESO docs](https://external-secrets.io/latest/api/externalsecret/#external-secrets.io/v1beta1.ExternalSecretDataFromRemoteRef)).

## Three entry points — pick the one for your context

| Context                     | Entry                                                                                                    | Why                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Developer at terminal       | `pnpm secrets:set <env> <service> <KEY>`                                                                 | Interactive, secure-input, validates path against catalog                                                                                                          |
| Operator / on-call          | [`.github/workflows/secrets-manage.yml`](../../.github/workflows/secrets-manage.yml) → workflow_dispatch | Audit-logged, OIDC-auth'd, env-protection-gated for production                                                                                                     |
| AI agent (via operator MCP) | `secret.declare` tool → human fills value via one-time URL                                               | Agent declares SHAPE; never sees VALUE. See [`spec.secrets-management § Operator API`](../spec/secrets-management.md#entry-3--operator-api-ai-agents-mcp-mediated) |

All three call the same OpenBao primitive (`bao kv patch`) with different auth methods. You don't choose which OpenBao call happens; you choose which interface fits your context.

## Per-env behavior

| Env           | Tooling required?                                                          | Approval gate                                                                    |
| ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `candidate-a` | Recommended but not enforced — local OpenBao access OK for experimentation | None                                                                             |
| `preview`     | **Required.** Direct `bao kv put` refused by policy                        | Workflow auto-approves if actor has `preview-writer` role                        |
| `production`  | **Required + protected.** Direct `bao kv put` refused by policy            | GitHub environment-protection rule requires explicit reviewer approval per write |

The candidate-a slack is intentional — it's the experiment slot. The preview/production lockdown is the SOC 2 CC6.1 / CC8.1 boundary.

## Cross-service or system secrets

If a secret needs to be shared across services (e.g., `OPENROUTER_API_KEY` consumed by multiple services), put it at `cogni/<env>/_shared`. Each consuming service explicitly references the shared path in its ExternalSecret via a SECOND `dataFrom: extract` entry — this is the one case where the per-service ExternalSecret has more than one extract line. Document the shared-key dependency in the service's `AGENTS.md`.

System-level bootstrap secrets (Cherry token, Cloudflare token, GH PAT, OpenBao root + unseal keys) live in GitHub Environment secrets + `.local/<env>-openbao-init.json` — written ONCE during `pnpm bootstrap` (see [`docs/runbooks/fork-quickstart.md`](../runbooks/fork-quickstart.md) Step 6 + 6.5). **Never set them via this guide.** Substrate-token rotation is documented in [`secrets-rotate.md`](./secrets-rotate.md#substrate-token-rotation-root-token--unseal-keys).

## Forcing immediate sync (for impatient developers)

```bash
kubectl annotate externalsecret <service>-env-secrets \
  force-sync=$(date +%s) --overwrite -n <namespace>
# ESO syncs on next reconcile (seconds, not the configured 1h)
# Reloader picks up the Secret change and restarts the pod
```

Don't make this a habit. The 1h refresh interval is a feature — it bounds OpenBao read pressure. Use force-sync for the immediate post-`set` validation, then leave the interval alone.

## What if the secret is `OPENAI_API_KEY` and the code is `const apiKey = process.env.OPENAI_API_KEY`?

Both halves happen, in either order:

1. **Code PR**: add `process.env.OPENAI_API_KEY` to your typed config / Zod schema; consume it where needed. Goes through CI like any feature.
2. **Secret write**: `pnpm secrets:set candidate-a node-template OPENAI_API_KEY` (interactive).

Order doesn't matter:

- Write secret first → pod restart picks up env var → your code starts consuming on next deploy
- Deploy code first → env var is `undefined` until secret is written → write secret → next pod restart has it

The code MUST fail fast at startup if a required secret is missing (don't return `undefined` from `process.env.X` and silently malfunction). Reference: `docs/spec/secrets-management.md § TRANSITION_SAFE`.

## Anti-patterns this guide assumes you won't do

- Hardcode the value in a Kubernetes Secret YAML and commit it
- Add a `valueFrom: secretKeyRef` line to the pod spec per new secret (forces a pod spec edit per secret; wrong shape — see `spec.secrets-management § POD_CONSUMES_VIA_ENVFROM`)
- Create a per-secret ExternalSecret YAML (forces a YAML edit per secret; wrong shape — see `spec.secrets-management § ONE_EXTERNAL_SECRET_PER_SERVICE_ENV`)
- Use `bao kv put` (replaces ALL keys at the path; use `bao kv patch` instead — but the CLI handles this for you)
- Paste the secret value into a chat / commit message / PR description
- Skip the tooling for production-env writes "just this once"

## What the CLI does under the hood

```bash
# pnpm secrets:set candidate-a node-template OPENAI_API_KEY
# Approximate logic in scripts/secrets/set-secret.sh:

ENV=$1; SERVICE=$2; KEY=$3
# 1. Validate ENV is one of {candidate-a, preview, production}
# 2. Validate SERVICE exists in infra/catalog/
# 3. Validate KEY format (uppercase, alphanumeric + underscore)
# 4. Refuse if SERVICE matches "_system" or "_shared" (separate flow)
# 5. Authenticate to OpenBao:
#    - If $BAO_TOKEN set, use it
#    - Else use OIDC flow (browser handoff for humans; mTLS for CI)
# 6. Prompt for value via `read -s` (no echo)
# 7. bao kv patch cogni/$ENV/$SERVICE "$KEY=$VALUE"
# 8. Emit success: "✓ Wrote cogni/$ENV/$SERVICE/$KEY (v<N>). ESO refresh ≤ 1h."
# 9. Optionally annotate force-sync if --immediate flag passed
```

The whole thing is ~30 lines of bash. Same primitive, three faces (CLI / workflow / API).

## Related

- [`docs/spec/secrets-management.md`](../spec/secrets-management.md) — the canonical contract
- [`docs/guides/secrets-rotate.md`](./secrets-rotate.md) — rotation playbook
- [`docs/runbooks/fork-quickstart.md`](../runbooks/fork-quickstart.md) — bootstrap flow (substrate install + unseal + role bind happen here)
- [External Secrets Operator `dataFrom` docs](https://external-secrets.io/latest/api/externalsecret/#external-secrets.io/v1beta1.ExternalSecretDataFromRemoteRef)
- [OpenBao KV v2 docs](https://openbao.org/docs/secrets/kv/kv-v2/)
- [Stakater Reloader](https://github.com/stakater/Reloader)
