---
description: "Guide for adding or changing environment variables and secrets"
user-invocable: true
---

You are adding or changing an environment value. First classify it, because the
modern OpenBao/ESO substrate means most secrets do **not** require pod-spec,
compose, workflow, or deployment-script edits.

## 1. Classify the Value

Choose exactly one:

- **Runtime secret**: API keys, tokens, passwords, signing secrets, private URLs
  or anything that should not be committed. Default here.
- **Runtime config**: Non-secret values the deployed app/service reads, such as
  feature flags, public origins, service names, or numeric limits.
- **Build/test-only config**: Values only needed by local tests, CI test fixtures,
  or compile-time tooling.
- **Infrastructure/bootstrap secret**: Cherry, Cloudflare, GitHub admin tokens,
  OpenBao root/unseal material, Grafana Cloud admin roots. These are not normal
  app secrets and must follow the relevant runbook.

## 2. Runtime Secrets

Use the canonical guide, do not duplicate it here:

- `docs/guides/secrets-add-new.md`

Expected shape:

1. Add code support only if the application will read the value:
   - server-side typed env: `nodes/<node>/app/src/shared/env/server-env.ts`
   - client-side typed env: the local client env schema
   - keep optional secrets optional unless the service must fail fast without it
2. Add or update the per-node secret catalog entry:
   - `nodes/<node>/.cogni/secrets-catalog.yaml`
3. Write the secret value through OpenBao:
   - get a short-lived Kubernetes-auth OpenBao token for `<env>-writer`
   - run `pnpm secrets:set <env> <service> <KEY>`
4. Let External Secrets Operator sync the service Secret, or force one sync for
   validation:
   - `kubectl annotate externalsecret <service>-env-secrets force-sync=$(date +%s) --overwrite -n <namespace>`
5. Ensure the consuming pod restarts if the runtime reads env vars via `envFrom`.
   ESO updates the Kubernetes Secret; existing process env does not change inside
   an already-running container.

Do **not** add a per-secret `valueFrom`, hand-edit a Kubernetes Secret YAML, or
edit an ExternalSecret just to add another key. The normal service ExternalSecret
extracts the whole OpenBao service path.

## 3. Runtime Config

For non-secret deployed config, follow the local deployment substrate rather than
assuming the old compose/deploy.sh path. Check the repo you are in.

Typical places to inspect:

- typed env schema used by the service
- service configmap/kustomize overlay if the value is deployed through k8s
- GitHub repo/environment variables if the value is provided by workflow input
- local/test env fixtures if tests call `serverEnv()`

Keep config additions narrow. Do not edit every workflow or compose file unless
the value is actually consumed in that path.

## 4. Build/Test-Only Config

Update only the test/build surfaces that need the value:

- shared env fixtures such as `tests/_fixtures/env/*`
- test workflow `env:` blocks if CI actually evaluates the schema there
- `.env.example` or local docs when humans need to provide it

Prefer a safe fake value in tests.

## 5. Infrastructure/Bootstrap Secrets

Stop and use the owning runbook. These values bootstrap the substrate itself and
are not written with `pnpm secrets:set`.

Examples:

- `CHERRY_AUTH_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `GITHUB_ADMIN_PAT`
- OpenBao root/unseal artifacts
- Grafana Cloud admin/root tokens

Relevant docs are usually under `docs/runbooks/` or `docs/guides/secrets-rotate.md`.

## Quick Sanity Check

For a normal new app secret, the PR should usually contain only:

- code that consumes the variable
- typed env/schema updates
- the per-node catalog entry
- tests/docs for that behavior

The secret value itself is not in the PR; it is written to OpenBao with
`pnpm secrets:set`.
