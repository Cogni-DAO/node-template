---
id: handoff-grafana-auto-mint
type: handoff
work_item_id: ""
status: active
created: 2026-05-28
updated: 2026-05-28
branch: "feat/grafana-auto-mint (suggested; create from `feat/provision-env-workflow` head once PR #46 merges)"
last_commit: "eed44622a (PR #46 head as of handoff write)"
---

# Handoff: Grafana child-SA auto-mint at bootstrap

## Context

- Filed against `proj.agentic-fork-bootstrap` Walk-tier (table row: "Grafana child-SA auto-mint at bootstrap").
- Without this, every forker manually pastes a Grafana SA token via `pnpm secrets:set <env> node-template GRAFANA_SERVICE_ACCOUNT_TOKEN` (Step 6.6) — and most forkers won't do it. Validators report 🟡 `no-grafana-data-available` on scorecard row 5 every iteration. The fork has no log/metric visibility by default.
- The principle-aligned move: operator pastes ONE Grafana parent SA token + URL into the env-secrets credential floor (one human action, ever); bootstrap auto-mints a scoped read-only child SA per env. Killer rule preserved: no human types a child-token VALUE into a UI per env.
- Why this is critical infra: without observability auto-wired, "forkers run node-template and look at their dashboards" is a manual setup-day for every fork. That kills the easy-start manual-command-count goal — same anti-pattern shape as the laptop-shell SSH paths PR #42-46 eliminated.
- Companion knowledge artifact (architectural reasoning): `docs/research/api-key-secrets-management.html`.

## Current State

- ✅ Manual path works: forker pastes `GRAFANA_SERVICE_ACCOUNT_TOKEN` via Step 6.6 → `scripts/loki-query.sh` reads `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` from env or sourced `.env.cogni`.
- ✅ `scripts/setup-secrets.ts` declares `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_CLOUD_LOKI_*`, `PROMETHEUS_*` (lines 543-721) — but hardcoded to `REPO = "Cogni-DAO/cogni"`, not the local fork. Separate cleanup (see runbook drift note).
- ✅ Existing pattern for "use SA token to do Grafana API work" lives in `scripts/grafana-postgres-datasource.sh` + `scripts/ci/provision-grafana-postgres-datasources.sh` — reference shape for the API calls.
- ❌ No auto-mint. Today's bootstrap (`provision-env-vm.sh`) does not contact Grafana at all.
- ❌ No artifact bundling. The encrypted artifact archive (`.local/encrypted/*.enc`) currently holds: `<env>-openbao-init.json`, `<env>-vm-key`, `<env>-kubeconfig.yaml`. No Grafana token.
- ❌ Step 6.2 credential floor is 6 secrets; this work expands it to 8 (add `GRAFANA_PARENT_SA_TOKEN`, `GRAFANA_URL`).
- ❌ Scorecard row 5 (`docs/runbooks/fork-quickstart.md` Step 8) is filed as vNext — graduates to gating once this lands.

## Decisions Made

- **Token type:** Grafana Cloud **service-account token** (`glsa_*` prefix), NOT access-policy token (`glc_*`). The access-policy variant does not authorize the Grafana instance HTTP API. See `scripts/setup-secrets.ts:564-565`.
- **Per-env child scoping:** child SA name = `<fork-slug>-<env>-validator` (e.g. `cogni-node-20260526-candidate-a-validator`). Permissions: `dashboards:read`, `datasources:read`, `datasources:query`. NO write perms.
- **Where the child token lives:**
  1. **Encrypted artifact bundle** (operator-facing) — `.local/<env>-grafana-sa-token.json` alongside the existing 3 artifacts. Operator decrypts on download + moves to password manager (same lifecycle).
  2. **OpenBao** (in-cluster + validator-agent path) — `secret/services/grafana/<env>/sa-token-read` (KV-v2). Pods + validators read via writer-role JWT (same path as other env secrets).
- **Engineer-as-actor flow is out of scope here.** That belongs in the cogni operator-app (see PR #46 handoff Q3 discussion). This handoff is purely "bootstrap mints ONE child token per env, for the env's own observability."
- **Failure mode is graceful:** if `GRAFANA_PARENT_SA_TOKEN` or `GRAFANA_URL` is empty/missing, the new phase logs `[INFO] Grafana credentials not provided — skipping observability auto-wire` and exits 0. Scorecard row 5 stays 🟡 (existing convention). NOT a hard requirement.

## Next Actions

- [ ] **Step 1: extend the env-secrets floor.** Update `.github/workflows/provision-env.yml` env block to surface `GRAFANA_PARENT_SA_TOKEN` + `GRAFANA_URL` from `secrets.GH_GRAFANA_*` (apply the `GH_*` rename convention; see runbook Step 6.2 commentary).
- [ ] **Step 2: extend the runbook.** `docs/runbooks/fork-quickstart.md` Step 6.2: secret list goes from 6 → 8 (add `GH_GRAFANA_PARENT_SA_TOKEN`, `GH_GRAFANA_URL`). Mark both as `# observability — optional but recommended; skip = no log visibility`.
- [ ] **Step 3: write the mint phase.** New phase in `scripts/setup/provision-env-vm.sh` (suggest **Phase 5e**, after Phase 5d OpenBao writes; before Phase 6 ExternalSecrets apply). Pseudocode:
  ```
  if [[ -z "${GRAFANA_PARENT_SA_TOKEN:-}" || -z "${GRAFANA_URL:-}" ]]; then
    log_info "Grafana credentials not provided — skipping observability auto-wire"
  else
    # 1. Mint service account
    SA_RESP=$(curl -sS -X POST "$GRAFANA_URL/api/serviceaccounts" \
      -H "Authorization: Bearer $GRAFANA_PARENT_SA_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"${FORK_SLUG}-${DEPLOY_ENV}-validator\",\"role\":\"Viewer\",\"isDisabled\":false}")
    SA_ID=$(echo "$SA_RESP" | jq -r .id)
    # 2. Mint token on that SA
    TOK_RESP=$(curl -sS -X POST "$GRAFANA_URL/api/serviceaccounts/$SA_ID/tokens" \
      -H "Authorization: Bearer $GRAFANA_PARENT_SA_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"${DEPLOY_ENV}-bootstrap-$(date +%s)\"}")
    CHILD_TOK=$(echo "$TOK_RESP" | jq -r .key)
    # 3. Write to artifact + OpenBao
    echo "{\"url\":\"$GRAFANA_URL\",\"token\":\"$CHILD_TOK\",\"sa_id\":$SA_ID}" \
      > ".local/${DEPLOY_ENV}-grafana-sa-token.json"
    bao kv put secret/services/grafana/${DEPLOY_ENV}/sa-token-read \
      url="$GRAFANA_URL" token="$CHILD_TOK"
  fi
  ```
- [ ] **Step 4: extend the encrypt-artifacts step.** `.github/workflows/provision-env.yml` "Encrypt init artifacts" step already loops over `.local/${DEPLOY_ENV}-*` plaintext files; verify `<env>-grafana-sa-token.json` is in the glob. If not, add it.
- [ ] **Step 5: graduate scorecard row 5 to gating.** `docs/runbooks/fork-quickstart.md` Step 8: move row 5 from "vNext" section into the main gating matrix. Probe: `curl -sS -H "Authorization: Bearer $TOK" $GRAFANA_URL/api/datasources` returns 200 with non-empty `[]`-or-list payload.
- [ ] **Step 6: tests.** Unit test for the mint script with a fake Grafana API server (use `nc -l` or a tiny node http stub). Integration test piggy-backs on the validator cold-start.
- [ ] **Step 7: cleanup-on-destroy.** When a fork is decommissioned, the child SA + token should be revoked from the parent Grafana org. Add a `revoke-grafana-sa.sh` script + document in the cleanup runbook (when one exists; today it's `ad-hoc-cherry-cleanup.md`).

## Risks / Gotchas

- **Grafana Cloud SA permissions are global to the stack, not per-namespace.** A Viewer-role SA can see every datasource the stack has, not just one env. For strict per-env scoping you'd need separate Grafana Cloud orgs per env — overkill for v1. Document the trust boundary: child token = read-only to ALL of the operator's Grafana observability.
- **Parent SA token rotation cascades.** If `GRAFANA_PARENT_SA_TOKEN` rotates, every existing child SA + token stays valid (independent). But re-running bootstrap with the new parent will create a NEW child each time → token sprawl in the Grafana org. Mitigation: name children with the env (not a timestamp), and the mint script does idempotent "find-or-create" by name.
- **Don't use Grafana Cloud access-policy tokens (`glc_*`).** They don't authorize the Grafana HTTP API. Use service-account tokens (`glsa_*`) only. The mint script should reject `glc_*` parent tokens at preflight.
- **Rate limits.** Grafana Cloud's API rate limit is generous (well above ACME's), but each child-mint is 2 API calls. ~100 forks/day is fine; ~10k/day would need batching.
- **Audit log.** The parent SA's actions appear in the Grafana audit log as the parent's identity, not the operator's. For SOC2 evidence trail, this is acceptable but worth noting.

## Pointers

| File / Resource                                                                                   | Why it matters                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/setup/provision-env-vm.sh`                                                               | Add Phase 5e (mint) here. Look at Phase 5c (OpenBao seed) for the bao-write pattern.                                             |
| `.github/workflows/provision-env.yml`                                                             | Extend env block + ensure new artifact file is in encrypt glob.                                                                  |
| `docs/runbooks/fork-quickstart.md`                                                                | Step 6.2 (6 → 8 secrets) + Step 8 scorecard (row 5 graduates).                                                                   |
| `scripts/setup-secrets.ts`                                                                        | Declares `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_URL`, `GRAFANA_CLOUD_LOKI_*` — read for parent-token shape + acceptable form. |
| `scripts/grafana-postgres-datasource.sh` + `scripts/ci/provision-grafana-postgres-datasources.sh` | Existing pattern for "use SA token to do Grafana API setup work" — reference shape.                                              |
| `scripts/loki-query.sh`                                                                           | Downstream consumer; verify it picks up the new auto-minted token cleanly.                                                       |
| `docs/guides/agent-api-validation.md`                                                             | Scorecard row 5 lands here.                                                                                                      |
| `docs/spec/secrets-management.md` Invariant 13                                                    | Bootstrap-window write rules — applies to the OpenBao push step.                                                                 |
| `docs/research/api-key-secrets-management.html`                                                   | Companion architectural reasoning artifact. Vault Transit pattern is the v2 evolution.                                           |
| Grafana API docs: `POST /api/serviceaccounts` + `POST /api/serviceaccounts/{id}/tokens`           | Authoritative API contract: <https://grafana.com/docs/grafana/latest/developers/http_api/serviceaccount/>                        |
| `work/projects/proj.agentic-fork-bootstrap.md`                                                    | Walk-tier table row tracks this work.                                                                                            |
