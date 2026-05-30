---
id: fork-quickstart-runbook
type: runbook
title: Fork Quickstart — From Zero to Green Deploy
status: draft
summary: Hand-off prompt + autonomous agent guide that drives a node-template fork from zero to `/readyz=200`. Human role is bounded to a bot PAT, 7 GH env secrets, and one `gh variable set FORK_DOMAIN_ROOT`. Companion to docs/spec/agentic-fork-bootstrap.md.
read_when: A new user wants their own node-template instance; an external agent is dropped in cold.
owner: derekg1729
created: 2026-05-17
updated: 2026-05-27
tags: [onboarding, agent, bootstrap]
---

# Fork Quickstart

## The one sentence

Paste this into a fresh Claude Code (or equivalent) session, in whatever parent directory you want the fork to land in:

> Follow `docs/runbooks/fork-quickstart.md` in github.com/Cogni-DAO/node-template end-to-end.

The agent reads this file and drives. You touch the keyboard for: a bot PAT, one `gh variable set FORK_DOMAIN_ROOT`, and 6 env secrets via `gh secret set` prompts.

## Agent guide

You are an autonomous fork-provisioning agent. Take `github.com/Cogni-DAO/node-template` from zero to `/readyz=200`. Pick defaults, install missing tools, retry transient failures. Report only when (a) `/readyz` returns 200, or (b) you hit a genuinely unrecoverable blocker.

### Communication contract (binding)

- **≤ 3 lines per reply.** No preamble, no recap.
- **Every reply is an action** — clickable URL, one copy/paste line, or a file pointer.
- **Pre-fill everything.** URLs with scopes in query params; fill `pwd` yourself.
- **No questions where the answer is in this doc.** Re-read before asking.

### Auth principle (binding)

Your only authority is `$GH_TOKEN` (the bot PAT). Every action must succeed using just that token, against resources the bot owns.

- Before any git/gh action, verify `git remote get-url origin` points at the bot's account. Wrong owner = STOP.
- On 403, surface the setup gap (one URL + one copy/paste line). Never borrow other auth — keychain, browser, the human's shell, nothing.
- A step assigned to "the human" is the human's. Even if you could execute it via local creds, doing so collapses the contract this runbook exists to test.

### Steps

#### 0 · Identity gate

Run `gh api user --jq .login`. If the login is the human's account (not the bot), STOP and emit this template verbatim (substitute `<PWD>` with `pwd`):

```
🛑 I need my own GitHub identity to continue.
Mint a PAT here (signed in as your bot account): https://github.com/settings/tokens/new?scopes=repo,workflow,admin:org,admin:public_key,write:packages&description=cogni-fork-bootstrap
Then in a new terminal: `cd <PWD> && GH_TOKEN=<paste-pat> claude` and repaste the one-sentence prompt.
```

Once the bot login returns, continue silently.

#### 1 · Prereqs — auto-install, do not ask

Tools: bash 4+, gh, pnpm, tofu, age, jq, yq.

**Bash 4 is a hard prereq** — macOS `/bin/bash` 3.2 fails opaquely inside `provision-env-vm.sh`. Run this first and ensure the resulting bash takes precedence on PATH:

```
bash scripts/bootstrap/install/install-bash.sh
```

Then prefer the repo's installers over brew/apt:

```
bash scripts/bootstrap/install/install-{pnpm,tofu,yq,ripgrep}.sh
```

For tools without a wrapper (gh, age, jq, openssl, curl): brew or apt.

`gh auth status` must show the bot from Step 0's `GH_TOKEN`.

#### 2 · Fork + clone (default; do not ask)

```
USER=$(gh api user --jq .login)
```

- If `gh api repos/$USER/node-template` returns 200 AND `.parent.full_name == "Cogni-DAO/node-template"` → reuse: `gh repo clone $USER/node-template`.
- If it exists but isn't a fork of the template → defaulted name: `cogni-node-$(date +%Y%m%d)` and `gh repo fork Cogni-DAO/node-template --clone --remote --fork-name <name>`.
- Otherwise: `gh repo fork Cogni-DAO/node-template --clone --remote`.

**Never accept gh's silent `-1`, `-2` suffix** — it produces slugs that drift from anything registered ahead of time. Use `--fork-name` explicitly if you'd get one.

`cd` into the cloned directory.

#### 3 · hardships.md — create now, append as you go

Create at the cloned repo's root. Every blocker, surprise, undocumented step, or doc-vs-reality drift gets a dated entry:

```
## YYYY-MM-DD HH:MM <one-line title>
What you saw, what you did, whether it's a template bug or just friction.
```

Commit + push at the end of each working session. Empty `hardships.md` is suspicious — either you missed friction or you didn't write it down.

#### 4 · Install

```
pnpm install
```

#### 5 · `FORK_DOMAIN_ROOT` — one GH repo variable, no commit

Non-secret, plaintext, fork-scoped. The workflow preflight refuses to run if it's unset (no half-provisioned VMs on a missing zone). Public node URLs derive from this + the catalog. VM aliases are repo/env-scoped: `<slug>-candidate-a.vm.<FORK_DOMAIN_ROOT>`, etc. The fork slug auto-derives from the GitHub repo name (override via `FORK_SLUG` env if needed).

#### 6 · Bootstrap — runs in a workflow, not on your laptop

Substrate + VM provisioning lives at [`.github/workflows/provision-env.yml`](../../.github/workflows/provision-env.yml). You ship one GH repo variable + 7 GH env secrets; the runner handles the 30-min `tofu apply` + `bao init` + `kubectl` session. Init artifacts come back passphrase-encrypted.

##### 6.1 · Set `FORK_DOMAIN_ROOT`

```
REPO=$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')
gh variable set FORK_DOMAIN_ROOT --repo "$REPO" --body "<your-cloudflare-zone-name>"
```

##### 6.2 · Create the target GH environment + set 7 minting tokens

The 7 tokens live in the fork's **GitHub Actions environment secrets** — nowhere else. No `.env.bootstrap` file, no operator laptop path, no `~/dev/...`. The workflow runner reads them and seeds OpenBao; after bootstrap, OpenBao is the only place these values exist at runtime.

GitHub reserves the `GITHUB_*` secret-name prefix (HTTP 422 on set). Use `GH_ADMIN_*`; the workflow maps them back internally.

For each secret below, the agent should: (a) emit the URL to the human, (b) tell them what to copy, (c) paste the value into the `gh secret set` prompt. Each `gh secret set` prompt reads stdin silently and never echoes the value.

```
REPO=$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')
ENV=candidate-a
gh api -X PUT repos/$REPO/environments/$ENV
```

Per-secret walkthrough:

| #   | Secret                 | Where to get it                                                                                                                                                                                                                                                                                                     | Notes                                                                                        |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `CHERRY_AUTH_TOKEN`    | <https://portal.cherryservers.com/settings/api-keys> → "Create new API key"                                                                                                                                                                                                                                         | Provisions the VM. Free tier OK for candidate-a.                                             |
| 2   | `CHERRY_PROJECT_ID`    | <https://portal.cherryservers.com/> → click your project → copy the numeric ID from the URL (`/projects/<ID>/`)                                                                                                                                                                                                     | One per Cherry account; OK to reuse across envs.                                             |
| 3   | `CLOUDFLARE_API_TOKEN` | <https://dash.cloudflare.com/profile/api-tokens> → "Create Token" → "Custom token"                                                                                                                                                                                                                                  | **Two scopes required** (see below).                                                         |
| 4   | `CLOUDFLARE_ZONE_ID`   | <https://dash.cloudflare.com/> → click your domain → right sidebar → **API** section → copy "Zone ID"                                                                                                                                                                                                               | One per zone; reusable across envs.                                                          |
| 5   | `GH_ADMIN_PAT`         | <https://github.com/settings/tokens?type=beta> (signed in **as the bot**, not the human) → "Generate new token" (fine-grained) → Resource owner = the fork's owner; Repository access = the fork repo; Permissions: Contents R/W + Pull requests R/W + Actions R/W + Workflows R/W + Environments R/W + Secrets R/W | Workflow uses this to write back into the fork (GHCR pulls, env-secret writes, etc.).        |
| 6   | `GH_ADMIN_USERNAME`    | `gh api user --jq .login` (run as the bot)                                                                                                                                                                                                                                                                          | Just the bot account's GitHub login string.                                                  |
| 7   | `OPENROUTER_API_KEY`   | <https://openrouter.ai/keys> → "Create key"                                                                                                                                                                                                                                                                         | LiteLLM uses it to reach providers. Without it, `/api/v1/chat/completions` returns HTTP 000. |

Then set all 7:

```
for k in CHERRY_AUTH_TOKEN CHERRY_PROJECT_ID CLOUDFLARE_API_TOKEN \
         CLOUDFLARE_ZONE_ID GH_ADMIN_PAT GH_ADMIN_USERNAME \
         OPENROUTER_API_KEY; do
  gh secret set "$k" --repo "$REPO" --env "$ENV"
done
```

**`CLOUDFLARE_API_TOKEN` scopes (both required):**

- **Zone — DNS — Edit** (creates the A records)
- **Zone — Zone Settings — Edit** (flips zone SSL mode to "Full" so Cloudflare's edge-trusted cert covers the origin via Caddy's `tls internal`)

Zone Resources: **Include — Specific zone — `<your zone>`**.

The dns-ops skill's default template only covers DNS:Edit; add the Zone Settings:Edit permission too. `bootstrap.sh` Phase 1 probes both scopes BEFORE the Cherry VM is provisioned — if only DNS:Edit is present, the run fails fast at zero spend with a literal copy-pasteable mint-token template (same shape as Step 0's identity gate).

These 7 cover the MVP path (substrate boot + agent register + chat + work-items). Feature-gated externals — Posthog telemetry, OAuth providers (Discord/Google/GitHub), on-chain RPC, Tavily web search, etc. — go through Step 6.6 (writer-role → OpenBao path). Paste only what your fork actually uses; the app schema treats all of them as optional.

**Optional — observability auto-mint (3 keys, ungates scorecard row 5):**

If you have a Grafana Cloud stack, paste these 3 GH-env-secrets. ONE Cloud admin token derives BOTH the read path (Viewer child SA + `glsa_*` token used by the validator scorecard + laptop queries) AND the write path (Loki/Prom access-policy + `glc_*` push token used by Alloy from cold-start). Phase 5e calls the Cloud API + the stack instance API to mint all 8 derived fields, seeds them to `cogni/<env>/_shared`, and bundles a one-shot snapshot into the encrypted init-artifact. Skip = row 5 stays 🟡 with `no-grafana-data-available`; bootstrap still completes 🟢.

> **Why the org slug is its own secret (row 8)**: Cloud access-policy tokens are _scoped to one org_. A token with the recommended 4 scopes can read `GET /api/orgs/<your-org-slug>` and its sub-paths, but **cannot list all orgs at `/api/orgs`** — that requires `orgs:read`, which is intentionally not in the recommended scope set. Phase 5e's preflight + lookup use the org-specific endpoint, so the operator pastes the slug rather than the script trying to discover it.

| #   | Secret                         | Where to get it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `GH_GRAFANA_ORG_SLUG`          | Your Grafana Cloud org slug — the `<slug>` segment in `https://grafana.com/orgs/<slug>`. Typically your account name (e.g., `derekg1729`). Visit <https://grafana.com/orgs> while signed in and copy the slug from the URL of your org's page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Required when the admin token is set. Verified by Phase 5e preflight as `GET /api/orgs/<slug>` → 200.                                                                                                                                                                                         |
| 9   | `GH_GRAFANA_URL`               | Your Grafana stack URL — Grafana Cloud: `https://<stack>.grafana.net` (find it in <https://grafana.com/orgs>); self-hosted: whatever URL the stack lives at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | No trailing slash. Phase 5e uses this to disambiguate stacks when the org has more than one.                                                                                                                                                                                                  |
| 10  | `GH_GRAFANA_CLOUD_ADMIN_TOKEN` | Open `https://grafana.com/orgs/<your-org-slug>/access-policies` (sign up at <https://grafana.com/auth/sign-up/create-user> first if you don't have a Grafana Cloud account). **The default scope checkboxes are data-plane (metrics:write / logs:write / traces:write / etc.) — ignore them; we need ADMIN scopes.** Click **Create access policy** → enter display name `cogni-bootstrap-admin` → choose a Realm (org-wide "all stacks" is fine for v1) → scroll to the **Add scope** dropdown near the bottom → add these four by name (one at a time): `stacks:read`, `stack-service-accounts:write`, `accesspolicies:read`, `accesspolicies:write` → click **Create** → on the new policy's detail page click **Add token** → copy the `glc_*` value (shown once).<br><br>**Do NOT add `orgs:read`** — the script is org-scoped on purpose. Adding `orgs:read` works but grants a broader surface than needed; the 4 scopes above are the minimum-priv set for Phase 5e. | MUST start with `glc_*`. Stack SA tokens (`glsa_*`) and bearer tokens (`glb_*`) are rejected by the workflow preflight + Phase 5e mint script with a clear error before any VM spend. ONE root → derives all 8 observability keys (Viewer child SA + `glsa_*` read + `glc_*` Loki/Prom push). |

```
gh secret set GH_GRAFANA_ORG_SLUG          --repo "$REPO" --env "$ENV"
gh secret set GH_GRAFANA_URL               --repo "$REPO" --env "$ENV"
gh secret set GH_GRAFANA_CLOUD_ADMIN_TOKEN --repo "$REPO" --env "$ENV"
```

**Trust boundary**: the `glc_*` Cloud admin root lives only in GH-env-secrets + the workflow runner env for the ~30s of Phase 5e. It is never written to OpenBao, never propagated to pods, never reaches the VM. Phase 5e derives two scoped tokens from it — the Viewer child SA's `glsa_*` read token (`<fork-slug>-<env>-validator`) AND a `glc_*` push token bound to the `cogni-<fork-slug>-<env>-push` access-policy (4 scopes: `logs:write` + `metrics:write` + `logs:read` + `metrics:read`). Both derived tokens land at `cogni/<env>/_shared` (Invariant 1) and are the only credentials pods + the validator ever see.

##### 6.3 · Generate the init-artifact passphrase

Operator-owned. Never stored in GH or in this repo.

```
PP=$(openssl rand -hex 24)
echo "$PP"   # save to your password manager BEFORE running the workflow
```

##### 6.4 · Dispatch the workflow

```
gh workflow run provision-env.yml --repo "$REPO" \
  -f env="$ENV" \
  -f encryption_passphrase="$PP"
gh run watch --repo "$REPO" \
  $(gh run list --repo "$REPO" --workflow provision-env.yml --limit 1 --json databaseId --jq '.[0].databaseId') \
  --exit-status
```

The workflow validates inputs (admin role, push access, Cloudflare zone, Cherry token), generates agent secrets, provisions the Cherry VM, configures Cloudflare DNS, **installs the secrets substrate (OpenBao + ESO), auto-unseals OpenBao (Shamir 1-of-1 default), binds the writer-role**, seeds per-service OpenBao paths, applies Argo ApplicationSets (which reconcile the deploy/\* branches), and polls `/readyz` on every node with a 5-min budget. It fails BEFORE spending Cherry money if any pre-flight check fails. See [`docs/spec/secrets-management.md`](../spec/secrets-management.md).

##### 6.5 · Download + decrypt init artifacts

```
gh run download --repo "$REPO" --name "$ENV-init-artifacts" --dir .local
for f in .local/*.enc; do
  out="${f%.enc}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$f" -out "$out" \
    -pass pass:"$PP"
done
```

Move `.local/<env>-openbao-init.json` + `<env>-vm-key` + `<env>-kubeconfig.yaml` to your password manager. THEN delete the artifact from the run page (retention is 1 day — safety net, not the contract).

If you set `GH_GRAFANA_CLOUD_ADMIN_TOKEN`, a fourth file `<env>-grafana-sa-token.json` will be present — an 11-field one-shot bootstrap snapshot of everything Phase 5e derived from your Cloud admin root:

- 6 read-path fields: `url`, `token` (glsa\_ Viewer child read), `sa_id`, `sa_name` (`<fork-slug>-<env>-validator`), `token_name`, `minted_at`
- 5 write-path fields: `loki_write_url`, `loki_username`, `prometheus_remote_write_url`, `prometheus_username`, `push_token` (glc\_ Loki/Prom push, single 4-scope policy)

Move it to your password manager. Post-rotation laptop access uses `bao kv get -mount=cogni <env>/_shared`, which returns the same 8 derived keys: `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_URL`, `LOKI_WRITE_URL`, `LOKI_USERNAME`, `LOKI_PASSWORD`, `PROMETHEUS_REMOTE_WRITE_URL`, `PROMETHEUS_USERNAME`, `PROMETHEUS_PASSWORD` (the `LOKI_PASSWORD` and `PROMETHEUS_PASSWORD` values are the same glc\_ push token — one access-policy holds both write scopes).

**Invariant 13** (`secrets-management.md`): the root token in `<env>-openbao-init.json` is for unseal-key recovery on pod restart only. Day-2 writes use the writer-role JWT (Step 6.6), not the root token.

Multi-operator forks (Shamir 3-of-5) override `OPENBAO_KEY_SHARES=5` + `OPENBAO_KEY_THRESHOLD=3` at workflow trigger time. v1 default is 1-of-1.

##### 6.6 · App secrets via writer-role (only for opt-in features)

The minimal fork is fully seeded by 6.2 + Phase 5c: all `required: true` catalog entries (auto-generated randoms, derive-env URLs from `DOMAIN`, and the 7 minting tokens — including `OPENROUTER_API_KEY` for the LLM router) reach OpenBao without any post-bootstrap commands. If you set `GH_GRAFANA_CLOUD_ADMIN_TOKEN` at 6.2, the 8 observability creds at `cogni/<env>/_shared` are also auto-minted by Phase 5e (see [`docs/design/observability-creds-shared.md`](../design/observability-creds-shared.md)).

**Step 6.6 is empty for a vanilla fork — skip to 6.7.**

Run the writer-role recipe only when your fork enables opt-in features whose secrets are catalog `required: false` (Langfuse, OAuth providers Discord/Google/GitHub, Privy, Tavily, etc.). The shape of the recipe (port-forward + writer-role JWT exchange, never the root token per Invariant 13):

```
export KUBECONFIG=$PWD/.local/<env>-kubeconfig.yaml
kubectl port-forward -n openbao svc/openbao 8200:8200 &
export BAO_ADDR=http://127.0.0.1:8200
# OpenBao CLI 2.5.x doesn't implement `bao login -method=kubernetes`; use the raw API path.
export BAO_TOKEN=$(bao write -field=token auth/kubernetes/login \
  role=<env>-writer \
  jwt=$(kubectl create token openbao-operator -n default))

# Examples — only paste keys your fork actually uses.
# pnpm secrets:set <env> node-template LANGFUSE_PUBLIC_KEY
# pnpm secrets:set <env> node-template LANGFUSE_SECRET_KEY
# pnpm secrets:set <env> node-template GOOGLE_OAUTH_CLIENT_ID
```

`ls infra/catalog/*.yaml` is the canonical inventory; per-key dashboard URLs + minting steps live in each `nodes/<n>/.cogni/secrets-catalog.yaml`. See [`docs/guides/secrets-add-new.md`](../guides/secrets-add-new.md) for the full playbook.

##### 6.7 · Post-bootstrap Grafana / Loki access (for the next agent)

After Step 6.5 decrypted the init-artifact bundle, the auto-minted Grafana credentials live at:

```
.local/<env>-grafana-sa-token.json
```

This is the canonical creds-snapshot for laptop-side and CI ad-hoc queries. **Future agents do not need to mint, copy, or re-source anything** — the helper and skills below auto-source it. With the Cloud admin token set at 6.2, Alloy is shipping logs + metrics from cold-start (deploy-infra wires its push creds from the same `cogni/<env>/_shared` Phase 5e seeds), so reads return data the moment the cluster comes up.

| Surface                                      | What it is                      | How it gets the token                                                                                          |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scripts/loki-query.sh`                      | Shell helper, no MCP dependency | Auto-sources `.local/<env>-grafana-sa-token.json` if `GRAFANA_URL` / `GRAFANA_SERVICE_ACCOUNT_TOKEN` are unset |
| `.claude/commands/logs.md`                   | `/logs` slash command           | Calls `scripts/loki-query.sh` when the Grafana MCP is unavailable                                              |
| `.claude/skills/validate-candidate/SKILL.md` | `/validate-candidate` scorecard | Calls `scripts/loki-query.sh` for the observability column when MCP is down                                    |

Verify your fork's auto-source works (no env vars needed):

```
unset GRAFANA_URL GRAFANA_SERVICE_ACCOUNT_TOKEN
scripts/loki-query.sh '{namespace="cogni-<env>"}' 10 5 | jq '.data.result | length'
```

Should print an integer > 0 within ~30s of bootstrap completing. **If it prints 0**, one of two cases:

1. The VM came up seconds ago — Alloy hasn't shipped its first batch yet. Wait 30s + re-run; logs flow once Alloy's first scrape interval elapses.
2. You skipped `GH_GRAFANA_CLOUD_ADMIN_TOKEN` at 6.2 — Phase 5e was a no-op, so Alloy has no push creds. Re-run `provision-env.yml` after pasting the secret; Phase 5e is idempotent.

Post-rotation (tokens rotate on every re-run of `provision-env.yml`): the artifact stays the bootstrap snapshot; the canonical post-rotation source is `bao kv get -mount=cogni <env>/_shared`. For most uses, re-decrypting the latest run's artifact is simpler.

#### 7 · Drive to green

- On transient failure (network, rate-limit, eventual-consistency), diagnose then retry yourself. Don't escalate.
- On unrecoverable failure (auth rejected, quota exceeded, account suspended, Cherry billing block), STOP and report the specific failure + the one thing the human must do. Log it in `hardships.md` first.
- If `/readyz` stays red, suspect a missing app secret first:
  `kubectl describe externalsecret -n cogni-<env> node-template-env-secrets` surfaces missing keys; re-run the relevant `pnpm secrets:set` and `kubectl rollout restart deployment/node-app`.

#### 8 · Agent-API scorecard

Don't trust `/readyz=200` alone — it only proves the pod is alive. Exercise the canonical agent surfaces against the deployed `<DOMAIN>` (derive from `FORK_DOMAIN_ROOT` + the env subdomain) and emit a scorecard. Follow [`docs/guides/agent-api-validation.md`](../guides/agent-api-validation.md) for the exact `curl` shapes.

Verdict cells: 🟢 pass · 🟡 partial / unverified · 🔴 fail · n/a not applicable. Each row records the HTTP status (or "no-grafana-data-available" for the obs cell when Loki creds aren't wired) and a one-line evidence excerpt.

```
| # | Surface                                | Probe                                                       | Status | Obs (Loki)               | Verdict |
| - | -------------------------------------- | ----------------------------------------------------------- | ------ | ------------------------ | ------- |
| 1 | Public DNS /readyz                     | GET https://<DOMAIN>/readyz                                 | <code> | <log-line-or-no-data>    |   🟢    |
| 2 | Agent registration                     | POST /api/v1/agent/register {"name":"quickstart-bot"}       | <code> | <log-line-or-no-data>    |   🟢    |
| 3 | Free-graph hello world                 | POST /api/v1/chat/completions graph_name=poet               | <code> | graph-run started/done   |   🟢    |
| 4 | Work item create                       | POST /api/v1/work/items {type:"story", title:"...", ...}    | <code> | work-item-write line     |   🟢    |
| 5 | Grafana instance API + self-trace      | GET $GRAFANA_URL/api/datasources                            | <code> | self-trace at marker tag |   🟢    |
```

Row 4 covers what node-template actually serves today: the work-items API against the operator's Doltgres. Knowledge primitives (`entryType=html|text` writes, knowledge-data-plane reads) live in the `cogni` operator-app + adopting nodes' `doltgres-schema` packages — node-template has none today, so a knowledge probe would be probing a surface that doesn't exist. Valid work-item types: `task | bug | story | spike | subtask` (per `work/_templates/item.md`); `inbox` is not valid.

Row 5 gating contract (per `docs/design/observability-creds-shared.md`):

- Credentials live at `cogni/<env>/_shared` (8 keys auto-minted by Phase 5e from the Cloud admin token; or sourced from the encrypted artifact bundle `.local/<env>-grafana-sa-token.json` for laptop-side checks).
- Probe: `curl -sS -H "Authorization: Bearer $GRAFANA_SERVICE_ACCOUNT_TOKEN" $GRAFANA_URL/api/datasources`
- Per-datasource queries (Loki, Prometheus, Postgres) flow through the proxy: `$GRAFANA_URL/api/datasources/proxy/uid/<ds-uid>/loki/api/v1/labels` (and analogues for the other datasources).
- **🟢** HTTP 200 on `/api/datasources` AND the payload is non-empty AND the validator can find its own request in a Loki `/loki/api/v1/query_range` proxy call tied to the exercise window. Default on first cold-start with Cloud admin token set: Alloy is shipping + datasources are registered.
- **🟡** with `grafana-auth-ok-no-datasources` if HTTP 200 but the payload is `[]` — `scripts/ci/provision-grafana-postgres-datasources.sh` skipped at deploy-infra (likely missing PDC credentials or other optional inputs). Self-resolves on operator opt-in; auth is fully wired.
- **🟡** with `no-grafana-data-available` if `GH_GRAFANA_CLOUD_ADMIN_TOKEN`/`GH_GRAFANA_URL` were skipped at Step 6.2 (Phase 5e is a no-op).
- **🔴** on HTTP 401/403 — the child token was revoked or the SA was deleted in Grafana. Re-run provision; Phase 5e is idempotent (find-or-create by name) and will mint fresh tokens.

vNext (filed against `proj.agentic-fork-bootstrap`, not gating today's bootstrap):

```
| 6 | Grafana instance API query           | GET <GRAFANA_URL>/api/datasources                            | <code> | self-trace at marker   |  vNext  |
| 7 | Knowledge entry write (cogni-side)   | once node-template adopts a doltgres-schema package          | <code> | dolt_log entry          |  vNext  |
| 8 | Operator GH App integration          | POST /api/v1/vcs/flight {prNumber:<n>}                       | <code> | flight dispatched      |  vNext  |
```

A 🟢 row requires (a) the HTTP status matches the contract AND (b) a feature-specific Loki line tied to the same exercise window — generic `request received` traffic is 🟡 at best. No-Loki environments are 🟡 with `no-grafana-data-available`, not 🟢.

#### 9 · Report

When the scorecard is assembled, post one line plus the matrix:

```
✓ <domain> /readyz=200 VM=<ip> run=<url>  scorecard: 4/4 🟢 (0 🟡, 0 🔴)
<paste the matrix>
```

Then commit + push `hardships.md` if you haven't already.

### Anti-patterns

- Don't ask the human to install tools you can install (brew/apt).
- Don't ask the human to pick a fork name when a default works.
- Don't stop and ask if "something looks off" — investigate first.
- Don't escalate transient failures (rate-limit, network blip) without at least one retry.
- Don't delete account-scoped infra (Cherry SSH keys, Cloudflare zones, GitHub org secrets) without enumerating EVERY reference across EVERY project on the account. A v0 canary did exactly this and took down production CI/CD.
- Don't resolve "tofu apply: resource already exists" by deleting the conflicting resource. The script's idempotency is for resources it owns; cross-system collisions are out-of-contract. STOP and surface.
- Don't run `bootstrap.sh` while `origin` points at `Cogni-DAO/node-template` or `Cogni-DAO/cogni`. The script self-aborts (running it inside the upstream template would corrupt shared state), but trust the gate — don't test it.

### Legacy fallback (do not use for fork bootstrap)

`pnpm bootstrap` is a laptop-side equivalent of `provision-env.yml`. It reads `.env.bootstrap` instead of GH env secrets. **Forkers and validation agents must not use this path** — it puts secrets on the operator's laptop (against `secrets-management.md` Invariant 13), and the GH-env-secrets workflow path (Step 6 above) replaces it entirely. The only sanctioned reason to run `pnpm bootstrap` is debugging a runner-specific issue during GHA outages, on a maintainer's laptop, in a session that ends with `shred -u .env.bootstrap`. If you find yourself referencing any `.env.bootstrap` path on someone's laptop (e.g. `~/dev/.env.bootstrap`), you are off the contract — re-read Step 6.

## Reference

- [`scripts/setup/bootstrap.sh`](../../scripts/setup/bootstrap.sh) — implementation
- [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md) — design + invariants
- [`docs/spec/secrets-management.md`](../spec/secrets-management.md) — Invariants 1-13
