---
id: grafana-postgres-readonly
type: runbook
title: Grafana Postgres Read-Only Access
status: active
summary: Provision and use a read-only Postgres role through Grafana Cloud for agent debugging and support.
---

# Grafana Postgres Read-Only Access

## Purpose

Give on-call humans and agents a fast read path for per-node Postgres state without SSH or `kubectl exec`.

Do not expose Postgres to the public internet for this. Grafana Cloud should reach Postgres through a private network path such as Grafana Cloud Private Data Source Connect (PDC), or the datasource should run inside the same private runtime network.

The control boundary is Postgres, not Grafana: `db-provision` creates `app_readonly` with `SELECT` on per-node DB tables and no write grants. The role has `BYPASSRLS` for v0 support/debugging across tenants; vNext should replace this with actor-scoped access.

## Operating Model

This mirrors the log-access model in `.claude/commands/logs.md`:

- agents use the Grafana stack service-account token for reads
- Grafana brokers access to the data source
- the backing system enforces least privilege (`app_readonly` for Postgres)
- no agent needs SSH, `kubectl exec`, or public inbound Postgres

The PDC signing token is not an agent read credential. It is a deploy-time tunnel credential used by the PDC agent to get an SSH certificate from Grafana Cloud. Agents should normally only need `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` to query an already-provisioned datasource.

## Human Unblock: Candidate-A PDC

Current state: the Grafana service-account token can create datasources. Candidate-a is only missing the PDC values that let Grafana Cloud reach private `postgres:5432` without opening Postgres to the internet.

This is a **Docker Compose runtime** setup, not a k8s setup. Candidate-a Postgres runs in the VM Compose stack, and the PDC agent runs in that same Compose project/network next to Postgres. Grafana Cloud reaches the Docker-internal host `postgres:5432` through PDC. K8s only consumes Postgres through existing EndpointSlice bridges; do not deploy the PDC agent in k8s for this path.

Human does this once through `setup-secrets`. Grafana generates one secret here, the PDC signing token, and also prints two non-secret command fields that must be stored with it:

- `GCLOUD_PDC_SIGNING_TOKEN` → `GRAFANA_PDC_SIGNING_TOKEN`
- `-cluster ...` → `GRAFANA_PDC_CLUSTER`
- `-gcloud-hosted-grafana-id ...` → `GRAFANA_PDC_HOSTED_GRAFANA_ID`

Do not derive `GRAFANA_PDC_HOSTED_GRAFANA_ID` from the token payload. In the candidate-a failure, the token payload field was `1604239`, while Grafana's generated Docker command used hosted Grafana ID `1454488`; the signer accepts the latter.

### UI Landmarks

There are two similar-looking Grafana surfaces. They are not interchangeable:

1. **Datasource edit page** — verifies which PDC network a datasource uses.

   Candidate-a operator datasource:

   <https://derekg1729.grafana.net/connections/datasources/edit/cogni-candidate-a-operator-postgres>

   Use this page to confirm:

   - datasource UID: `cogni-candidate-a-operator-postgres`
   - datasource URL: `postgres:5432`
   - private data source connect network: `pdc-derekg1729-default-candidate-a-postgres`

   Do not create PDC signing tokens from the datasource page; it is only the datasource attachment point.

2. **PDC network page** — creates/manages the PDC signing token used by the agent.

   Breadcrumb shown by Grafana:

   ```text
   Connections > Private data source connect > pdc-derekg1729-default
   ```

   This page has:

   - `Overview` tab — shows network name, connection status, token table, and data sources using the network
   - `Configuration Details` tab — shows Docker/Kubernetes/Binary install instructions and the token-generation form

   The existing candidate-a datasource is attached to this PDC network. On the Overview tab, the Tokens table should show a token row named like `candidate-a-postgres ...`; that existing row proves a token was created before, but Grafana does not show the secret value again. Use **Add token** or the **Configuration Details** tab to generate a fresh secret value.

Run:

```bash
pnpm setup:secrets --env candidate-a --only GRAFANA_PDC --all
```

When the prompts ask for PDC values:

1. Open the candidate-a datasource edit page:
   <https://derekg1729.grafana.net/connections/datasources/edit/cogni-candidate-a-operator-postgres>
2. Confirm its private data source connect network is `pdc-derekg1729-default-candidate-a-postgres`.
3. Navigate one level up to the PDC network page:
   `Connections > Private data source connect > pdc-derekg1729-default`.
4. On the PDC network page, use either:
   - `Overview` tab → `Tokens` section → **Add token**, or
   - `Configuration Details` tab → `Use a PDC signing token` → **Create a new token**
5. Token name: `candidate-a-postgres-YYYYMMDD` (or similarly descriptive).
6. Expiration: for the candidate-a prototype, `No expiry` is acceptable; once stable, rotate on a calendar or choose an expiry that matches the rotation process.
7. Click **Create token**.
8. Copy the generated token value. Grafana only shows the secret once.
9. From the Docker command snippet, also copy:
   - the value after `-cluster`
   - the value after `-gcloud-hosted-grafana-id`
10. Paste those values into the matching `setup-secrets` prompts.

```bash
GRAFANA_PDC_SIGNING_TOKEN=<GCLOUD_PDC_SIGNING_TOKEN from Grafana>
GRAFANA_PDC_CLUSTER=prod-ap-southeast-1
GRAFANA_PDC_HOSTED_GRAFANA_ID=1454488
```

Do not store this token in `.env.cogni`. It is a deploy secret and belongs in the GitHub `candidate-a` environment. `setup-secrets` writes it there.

If the candidate-a run shows this PDC agent error:

```text
key signing request failed: invalid credentials
```

the token is not usable by PDC. Per Grafana troubleshooting, generate a fresh token from the same **Configuration Details** screen and replace `GRAFANA_PDC_SIGNING_TOKEN`; do not debug Postgres or Grafana datasource JSON first.

Before storing or deploying a replacement token, preflight it directly against Grafana's signer:

```bash
GRAFANA_PDC_SIGNING_TOKEN='<GCLOUD_PDC_SIGNING_TOKEN from Grafana>' \
  scripts/grafana-pdc-token-preflight.sh
```

Expected success:

```text
[grafana-pdc-preflight] signer preflight passed: HTTP 200
```

If this returns HTTP 401, the token's embedded signing key is not accepted by Grafana Cloud. Do not rerun `candidate-flight-infra`; it will fail later with the same PDC agent error.

When the human gives the agent a replacement token directly, the agent must write it to both places:

```bash
gh secret set GRAFANA_PDC_SIGNING_TOKEN \
  --repo Cogni-DAO/node-template \
  --env candidate-a \
  --body "$GRAFANA_PDC_SIGNING_TOKEN"

{
  rg -v '^GRAFANA_PDC_SIGNING_TOKEN=' .env.candidate-a 2>/dev/null || true
  printf "GRAFANA_PDC_SIGNING_TOKEN='%s'\n" "$GRAFANA_PDC_SIGNING_TOKEN"
} > .env.candidate-a.tmp
mv .env.candidate-a.tmp .env.candidate-a
```

Then tell the agent:

```text
GRAFANA_PDC_SIGNING_TOKEN is set in the candidate-a GitHub environment. Finish candidate-a Grafana Postgres.
```

Agent verifies the secret exists, then runs this from the PR branch:

```bash
gh secret list --repo Cogni-DAO/node-template --env candidate-a | rg '^GRAFANA_PDC_SIGNING_TOKEN[[:space:]]'
gh workflow run candidate-flight-infra.yml \
  --repo Cogni-DAO/node-template \
  --ref codex/grafana-postgres-readonly
```

After that run finishes, the agent validates:

```bash
env_file=/Users/derek/dev/cogni-template/.env.cogni
export GRAFANA_URL="$(rg -m1 '^GRAFANA_URL=' "$env_file" | sed 's/^GRAFANA_URL=//' | awk '{print $1}')"
export GRAFANA_SERVICE_ACCOUNT_TOKEN="$(rg -m1 '^GRAFANA_SERVICE_ACCOUNT_TOKEN=' "$env_file" | sed 's/^GRAFANA_SERVICE_ACCOUNT_TOKEN=//' | awk '{print $1}')"

scripts/grafana-postgres-query.sh \
  'select current_user, count(*)::int as fills from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

Expected:

```text
current_user = app_readonly
fills > 0
```

## Provision

Deploy or re-run infra bootstrap so `infra/compose/runtime/postgres-init/provision.sh` runs:

```bash
docker compose --project-name cogni-runtime --profile bootstrap up db-provision
```

The role defaults are:

```bash
APP_DB_READONLY_USER=app_readonly
APP_DB_READONLY_PASSWORD=<derived from POSTGRES_ROOT_PASSWORD>
```

`scripts/ci/deploy-infra.sh` writes those into the runtime `.env`. To override rotation, set both values in the deployment environment.

`deploy-infra.sh` also starts the Grafana PDC agent when these environment secrets are present:

```bash
GRAFANA_PDC_SIGNING_TOKEN=<token from PDC Configuration Details>
```

`GRAFANA_PDC_CLUSTER` and `GRAFANA_PDC_NETWORK_ID` can be derived from `GRAFANA_PDC_SIGNING_TOKEN`. `GRAFANA_PDC_HOSTED_GRAFANA_ID` must come from Grafana's generated PDC agent command.

## Grafana Datasource

The candidate-a / preview / production workflows run `scripts/ci/provision-grafana-postgres-datasources.sh` after infra deploy. The script derives the readonly password from `POSTGRES_ROOT_PASSWORD`, creates one datasource per `COGNI_NODE_DBS` entry, and validates each datasource with `select current_user`.

For Grafana Cloud, the datasource host must be `postgres:5432` through PDC. The CI provisioning script refuses to create public Postgres datasources unless `GRAFANA_POSTGRES_ALLOW_NON_INTERNAL_HOST=1` is deliberately set.

Use a Grafana stack service-account token for `GRAFANA_SERVICE_ACCOUNT_TOKEN`, usually prefixed `glsa_`. Grafana Cloud access-policy tokens prefixed `glc_` are for the Cloud API and telemetry services, not the Grafana instance HTTP API that creates datasources.

```bash
export GRAFANA_URL=https://<org>.grafana.net
export GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_...
export GRAFANA_PDC_NETWORK_ID=<pdc-network-id>
DEPLOY_ENVIRONMENT=candidate-a \
POSTGRES_ROOT_PASSWORD=<root-secret> \
COGNI_NODE_DBS=cogni_operator,cogni_poly,cogni_resy \
scripts/ci/provision-grafana-postgres-datasources.sh
```

For local experiments only, `scripts/grafana-postgres-datasource.sh` can still create a single datasource when explicitly supplied `GRAFANA_POSTGRES_PASSWORD`.

Datasource UID convention:

```text
cogni-<env>-<node>-postgres
```

Examples: `cogni-candidate-a-poly-postgres`, `cogni-preview-operator-postgres`.

## Query

Use a Grafana service account token with datasource query permission:

```bash
scripts/grafana-postgres-query.sh \
  'select count(*) from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

The helper refuses obvious non-read SQL locally. Postgres permissions are still the authoritative write-denial control.

This is the intended agent-facing prototype command, analogous to `scripts/loki-query.sh`:

```bash
scripts/grafana-postgres-query.sh \
  'select id, status, created_at from work_items order by created_at desc limit 20' \
  cogni-candidate-a-operator-postgres | jq .
```

## Validation

Both humans and AI agents validate this end-to-end through Grafana Cloud only — no SSH, no `kubectl exec`, no public Postgres. Two independent signals must be green:

### 1. PDC tunnel is connected (Loki signal)

Alloy on the runtime VM ships the `pdc-agent` container's stdout/stderr to Grafana Cloud Loki under `service="pdc-agent"`. Read it like any other service:

```bash
COGNI_ENV_FILE=/path/to/.env.cogni \
  scripts/loki-query.sh \
    '{env="candidate-a",service="pdc-agent"}' \
    30 100 \
  | jq -r '.data.result[].values[][1]'
```

Healthy looks like:

```text
level=info msg="connecting to Grafana"
level=info msg="connected" ...
```

Failure looks like:

```text
key signing request failed: invalid credentials
ssh: handshake failed
```

If Loki returns no streams for `service="pdc-agent"`, Alloy is dropping the container. Confirm `infra/compose/runtime/configs/alloy-config.metrics.alloy` keeps `pdc-agent` in its `discovery.relabel "docker_logs"` keep regex.

### 2. Datasource end-to-end query (Postgres signal)

```bash
scripts/grafana-postgres-query.sh \
  'select current_user, count(*)::int as fills from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

Expected:

- `current_user = app_readonly`
- `fills` is an integer

Then verify write denial:

```sql
create table grafana_write_probe(id int);
```

Expected: the write probe fails with permission/read-only errors.

### Required local credentials for agent validation

Both helpers source from the first present file in `$COGNI_ENV_FILE`, then `./.env.canary`, then `./.env.local`:

- `GRAFANA_URL` (e.g. `https://<org>.grafana.net`)
- `GRAFANA_SERVICE_ACCOUNT_TOKEN` (`glsa_…`, with `datasources:read` + `datasources:query`)

If `GRAFANA_SERVICE_ACCOUNT_TOKEN` returns HTTP 401 against `${GRAFANA_URL}/api/datasources`, the local copy is stale relative to the GitHub `candidate-a` env secret — rotate the local file (don't rotate the GitHub secret) by re-pasting from Grafana → Administration → Service accounts.

The PDC signing token (`glc_…`) is not used at agent-read time. It only authenticates the runtime `pdc-agent` container at deploy time.

## SOC 2 Notes

This is a v0 operational support role. Keep the compensating controls explicit:

- dedicated role, separate from app and service roles
- no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, or `DROP` grants
- no public inbound Postgres; use PDC/private network connectivity for Grafana Cloud
- Grafana service-account tokens scoped to datasource read/query for normal use
- datasource-write token used only for setup/rotation
- quarterly access review of Grafana service accounts and datasource permissions

## Pivot Criteria

Stay on Grafana PDC while the blocker is a correctable token or tunnel setup issue. Pivot only if Grafana Cloud cannot reliably issue or authenticate PDC signing tokens for this stack/network after direct signer preflight.

The preferred pivot is not SSH and not public Postgres. The fallback prototype should be an authenticated internal DB-read API or small query gateway deployed beside the app/Postgres, using the same `app_readonly` role, statement timeouts, and read-only SQL guard. That would trade Grafana's unified read key for a separate agent DB-read token, so PDC remains the better v0 if we can make it stable.
