---
name: node-setup
description: "Agentic node setup for Cogni forks. Orchestrates the full lifecycle: DAO formation, payment activation, repo identity, infrastructure provisioning, and deploy verification. Delegates to guide docs for step-by-step details."
---

# Node Setup — Agentic Fork Onboarding

You are an infrastructure setup agent. Your job: take a fresh Cogni fork from clone to **successful preview and production deployments**. Prompt the user only for credentials that require their browser.

## References (read these — they own the details)

- [Node Formation Guide](../../../docs/guides/node-formation-guide.md) — DAO deployment via wizard
- [Payment Activation Guide](../../../docs/guides/operator-wallet-setup.md) — Privy wallet + Split contract
- [SETUP_DESIGN.md](../../../scripts/setup/SETUP_DESIGN.md) — canonical secret list, personas, full setup flow
- [INFRASTRUCTURE_SETUP.md](../../../docs/runbooks/INFRASTRUCTURE_SETUP.md) — VM provisioning runbook
- `nodes/<node>/app/src/shared/env/server-env.ts` — app runtime env schema (Zod, validated at boot). Note: app boot validates a separate list from deploy-infra.sh's `REQUIRED_SECRETS` — keep both lists in sync.
- [scripts/ci/deploy-infra.sh](../../../scripts/ci/deploy-infra.sh) — `REQUIRED_SECRETS` + `OPTIONAL_SECRETS` (infra-side env gate)
- [dns-ops skill](../dns-ops/SKILL.md) — DNS create/destroy + stale-record handling

## Pre-flight

Verify: `gh auth status`, `tofu --version`, `pnpm --version`. Detect repo name from `git remote get-url origin`.

## Node Lifecycle State Machine

```
clone → formation → local env → activation → infra → deploy
         (pending)    (dev:infra)   (active)
```

Check `payments.status` in `.cogni/repo-spec.yaml` to determine current state.

### Phase 0: Formation (`payments.status` missing or no repo-spec)

**Goal:** DAO deployed on-chain, repo-spec generated.

1. Direct user to https://cognidao.org/setup/dao
2. User copies generated YAML into `.cogni/repo-spec.yaml`
3. Follow [Node Formation Guide](../../../docs/guides/node-formation-guide.md) for details
4. **Gate:** `.cogni/repo-spec.yaml` has valid `cogni_dao.chain_id` and `payments.status: pending_activation`

### Phase 1: Repo Identity

**Goal:** All template references point to this fork.

Derive `REPO_SLUG` (e.g., `my-cogni-node`) and `REPO_SNAKE` (e.g., `my_cogni_node`) from the repo name. Update:

- `package.json` → `name`
- `.cogni/repo-spec.yaml` → `intent.name`, `activity_sources.github.source_refs`
- `sonar-project.properties` → `sonar.projectKey`, `sonar.projectName`
- `.github/workflows/ci.yaml` → DB names (`REPO_SNAKE_test`)
- `.env.local.example`, `.env.test.example` → DB names

**Gate:** `pnpm check` passes.

### Phase 2: Local Environment

**Goal:** `.env.local` configured, dev stack running, database provisioned.

1. Copy `.env.local.example` → `.env.local`, update DB names and `COGNI_REPO_URL`
2. Prompt user for credentials they must create (see [SETUP_DESIGN.md](../../../scripts/setup/SETUP_DESIGN.md) for full list):

   | Secret                     | Where to create                                                                         |
   | -------------------------- | --------------------------------------------------------------------------------------- |
   | `CHERRY_AUTH_TOKEN`        | https://portal.cherryservers.com/settings/api-keys                                      |
   | `OPENROUTER_API_KEY`       | https://openrouter.ai/settings/keys                                                     |
   | `EVM_RPC_URL`              | https://dashboard.alchemy.com/apps (Base Mainnet)                                       |
   | `GHCR_DEPLOY_TOKEN`        | https://github.com/settings/tokens/new — **Classic PAT**, `read:packages` scope         |
   | `GIT_READ_TOKEN`           | https://github.com/settings/personal-access-tokens/new — Fine-grained, `Contents: Read` |
   | `OPENCLAW_GITHUB_RW_TOKEN` | https://github.com/settings/tokens/new — Classic PAT, `repo` scope                      |

3. Auto-generate: `LITELLM_MASTER_KEY`, `AUTH_SECRET`, `OPENCLAW_GATEWAY_TOKEN` via `openssl rand`
4. Start dev infrastructure: `pnpm dev:infra`
5. Provision database + run migrations: `pnpm dev:setup`
6. Start dev server: `pnpm dev`

**Gate:** `pnpm check` passes. App boots at http://localhost:3000 without DB errors.

### Phase 3: Payment Activation (`payments.status: pending_activation`)

**Goal:** Split contract deployed, payments active.

1. User adds `operator_wallet.address` to repo-spec (provision via Privy if needed — see [Payment Activation Guide](../../../docs/guides/operator-wallet-setup.md))
2. Restart dev server to pick up repo-spec changes
3. User navigates to http://localhost:3000/setup/dao/payments and deploys Split contract via browser wallet
4. User pastes the output `payments_in` + `payments.status: active` into repo-spec

**Gate:** `payments.status: active` in repo-spec, `payments_in.credits_topup.receiving_address` populated.

### Phase 4: Infrastructure (preview first, then production)

**Goal:** VMs provisioned, SSH keys generated and stored.

Follow [INFRASTRUCTURE_SETUP.md](../../../docs/runbooks/INFRASTRUCTURE_SETUP.md) for detailed steps. Key points:

1. Generate SSH keypairs, commit public keys
2. Discover Cherry project ID via API (never hardcode)
3. Create tfvars (plan: **`B1-6-6gb-100s-shared`** — 4GB OOMs under the full k3s + Argo + Compose stack)
4. `tofu init && tofu apply` — **from the user's main checkout**, not a throwaway worktree (state files live in `.local/` + `terraform.tfstate.d/`)
5. Wait for cloud-init (~3 min). Marker: `/var/lib/cogni/bootstrap.ok` on the VM.
6. **For per-node-AppSet repos** (forks with their own per-node deploy branches): create deploy branches before first Argo sync. Use `gh api` (husky pre-push runs tests on every push):
   ```bash
   MAIN_SHA=$(git ls-remote origin refs/heads/main | awk '{print $1}')
   for ref in deploy/${env} deploy/${env}-<node>; do
     gh api -X POST repos/<org>/<repo>/git/refs -f ref="refs/heads/${ref}" -f sha="$MAIN_SHA"
   done
   ```

**Gate:** SSH succeeds, `cat /var/lib/cogni/bootstrap.ok` shows `BOOTSTRAP_OK=1`, `kubectl -n argocd get pods` shows controllers `Running`.

### Phase 5: GitHub Secrets

**Goal:** All secrets set for CI/CD deployment.

Follow the secret list in [SETUP_DESIGN.md](../../../scripts/setup/SETUP_DESIGN.md). Three categories:

1. **Auto-generated per env** — DB creds, service tokens, Temporal creds (use `openssl rand`)
2. **From .env.local** — shared credentials (OpenRouter, EVM RPC, PostHog, etc.)
3. **Repo-level** — CHERRY_AUTH_TOKEN, GHCR_DEPLOY_TOKEN, GIT_READ_TOKEN

Set `DOMAIN` as both variable AND secret per environment. Ask user for domain names.

**Pre-flight:** Create the GitHub environment first — `setup:secrets` aborts with a misleading "Is gh authenticated?" if the env doesn't exist:

```bash
gh api -X PUT repos/<org>/<repo>/environments/<env>
```

**Gate:** `gh secret list --env preview` shows all required secrets.

### Phase 6: DNS — two layers, both required

Pods reach host-network infra (Postgres, Temporal, LiteLLM, Redis) through a separate DNS layer from the user-facing one. The kustomize overlays use `Service: type: ExternalName → <env>.vm.cognidao.org` (per `bug.0295`). If only the user-facing record exists, the app crashes with Temporal/DB connection timeouts.

Create A records for both:

| Record                  | Purpose                                             | Example                                 |
| ----------------------- | --------------------------------------------------- | --------------------------------------- |
| `<user-fqdn>`           | User-facing app via Caddy (matches `DOMAIN` secret) | `myfork-test.cognidao.org → <vm-ip>`    |
| `<env>.vm.cognidao.org` | Pod-to-host service discovery (`bug.0295`)          | `candidate-a.vm.cognidao.org → <vm-ip>` |

**Stale records from prior destroyed VMs silently break this** — always list-then-delete before POSTing a new A record. See [dns-ops skill](../dns-ops/SKILL.md).

**Gate:** `dig +short <user-fqdn> @1.1.1.1` AND `dig +short <env>.vm.cognidao.org @1.1.1.1` both return the new VM IP.

### Phase 6b: Declare per-env public URLs in the catalog (bug.5002)

**Every new node in this repo MUST add `public_url` to its `infra/catalog/<name>.yaml` entry for each env it serves.** Verify scripts (`wait-for-candidate-ready.sh`, `smoke-candidate.sh`, `verify-buildsha.sh`, `verify-deployment.sh`) read URLs from here — without it they fall back to a legacy `${node}-${DOMAIN}` builder that produces NXDOMAIN URLs on single-node-shaped forks. Schema is enforced by `infra/catalog/_schema.json`.

```yaml
# infra/catalog/<your-node>.yaml
public_url:
  candidate-a: https://<user-fqdn-for-candidate-a>
  preview: https://<user-fqdn-for-preview>
  production: https://<user-fqdn-for-production>
```

URLs MUST match the `<user-fqdn>` A records you just created in Phase 6. Service-type entries (e.g. `scheduler-worker`) that have no Ingress omit this block.

**Gate:** `bash -c '. scripts/ci/lib/image-tags.sh && public_url_for_target candidate-a <your-node>'` prints the candidate-a URL non-empty.

### Phase 7: Deploy & Verify

**Goal:** Green CI run, app responding.

1. Merge to `main` to trigger canary promotion workflow
2. Monitor: `gh run view <id> --json status,conclusion,jobs`
3. On failure: check logs, fix, rerun
4. **Checkpoint:** Preview green → repeat Phases 4-7 for production

**Gate:** `curl -I https://<domain>/readyz` returns 200.

## Done

- [ ] Preview deployment green
- [ ] Production deployment green
- [ ] DNS resolves for both environments
- [ ] `/readyz` returns 200 on both domains
- [ ] `infra/catalog/<node>.yaml::public_url` declared for every env the node serves (bug.5002)

## Anti-patterns

1. **NEVER `source .env.local`** — use `grep` extraction for individual vars
2. **NEVER use fine-grained PATs for GHCR** — only Classic PATs work
3. **NEVER use 4GB VMs for the full stack** — k3s + Argo + Postgres + Temporal + LiteLLM + Redis + Caddy OOMs at bootstrap. Use `B1-6-6gb-100s-shared`.
4. **NEVER hardcode `cogni-template` names** — derive from repo name
5. **NEVER trust `/v1/regions` for auth verification** — it's public; use `/v1/teams`
