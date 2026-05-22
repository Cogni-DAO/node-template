---
name: cicd-secrets-expert
description: "Secrets architecture reference for node-template — when to use OpenBao+ESO vs GitHub env secrets, which operation pattern fits which write/rotate/add flow, the load-bearing invariants from the spec, and where to find the canonical implementation. Use when adding/rotating a secret, designing a service that consumes secrets, debugging an ExternalSecret or writer-role login, deciding between substrate and Compose-infra routing, touching `pnpm secrets:set` / `scripts/secrets/` / `infra/k8s/argocd/{openbao,external-secrets}/` / `infra/k8s/secrets/external-secrets/`, or evaluating any new workflow that touches secret values. Triggers: 'add a secret', 'rotate a key', 'OpenBao', 'ESO', 'ExternalSecret', 'writer role', 'bao login', 'vault-action', 'vault-config-operator', 'secrets-manage', 'secret in GH env vs OpenBao', 'where do I put this credential'."
---

# CI/CD Secrets Expert

One-page reference for anyone touching secrets in node-template. Read this BEFORE the spec; this points at what to actually read.

## North star

[`proj.agentic-fork-bootstrap`](../../../work/projects/proj.agentic-fork-bootstrap.md) — easy-start guide for a forking dev that uses OpenBao. Every PR is measured against the **forker's manual-command count**. If your change adds a manual step to `fork-quickstart.md`, that's debt — try a workflow first.

## Load-bearing invariants — gate every secrets decision

From [`docs/spec/secrets-management.md`](../../../docs/spec/secrets-management.md):

| #   | Rule                                                                                           | Where it bites                                                |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | PATH = `cogni/<env>/<service>/<KEY>`; `<service>` = catalog name                               | New service → new ExternalSecret dir                          |
| 2   | ONE ExternalSecret per (service, env) with `dataFrom: extract`; target `<service>-env-secrets` | Adding keys = NO YAML edit                                    |
| 3   | Pod `envFrom: secretRef: name: <service>-env-secrets` once per container                       | Pod spec set ONCE at service creation                         |
| 4   | NO secret value in git — ever                                                                  | Base64-in-YAML = immediate rotate + audit                     |
| 5   | OpenBao is SSOT; no parallel store (except Compose-infra `.env`, see routing)                  | Don't seed values in two places                               |
| 6   | RBAC via path policy (`eso-reader`, `<env>-writer`) bound to k8s SAs                           | Phase 5b.3 + 5b.4 of `provision-env-vm.sh`                    |
| 8   | Every access audited via OpenBao audit device → Loki                                           | Pipeline not built yet — bug.0445 follow-up                   |
| 9   | Three entry points only: CLI / workflow_dispatch / operator-MCP. Never raw `bao kv put`        | See decision tree below                                       |
| 13  | NO_OPERATOR_ROOT_TOKEN_ON_LAPTOP — bootstrap window only; day-2 uses writer-role JWT           | `.local/<env>-openbao-root-token` is never read post-Phase-5b |

## Decision tree — where does the value live?

| Consumed by                                                              | Path                                                           | Source of truth        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------- |
| k8s pod (anything under `nodes/<n>/app/`)                                | OpenBao `cogni/<env>/<service>/*` → ESO → k8s Secret → envFrom | OpenBao                |
| Compose-infra service (postgres, litellm, temporal, redis, alloy, caddy) | GH Env Secret → `deploy-infra.sh` → `.env` on VM               | GH Environment Secrets |
| Local dev only                                                           | `.env.local` (gitignored)                                      | Operator's laptop      |
| CI test runtime only                                                     | `.github/workflows/ci.yaml` env block                          | GH repo/env secrets    |

Routing checklist: [`.claude/commands/env-update.md`](../../commands/env-update.md) §0.5.

## Decision tree — how do I write / rotate the value?

| Operation                                             | Right pattern                                                                                                      | Today's reality                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Add new secret SHAPE (service X consumes key A)       | PR → `vault-config-operator` CRD → Argo reconciles                                                                 | Not built; tracked in `proj.agentic-fork-bootstrap` Walk                                                                   |
| Rotate AUTO-GENERATED value (e.g., `AUTH_SECRET`)     | `rotate-secret.yml` workflow with env-protection; auto-generates value; **human approves event, never sees value** | Not built; do manual `openssl rand` + `pnpm secrets:set` per [`secrets-rotate.md`](../../../docs/guides/secrets-rotate.md) |
| Rotate VENDOR-MINTED value (OpenAI key, Cherry token) | Operator-app UI (in `cogni` repo, not node-template)                                                               | Today: CLI on candidate-a; preview/prod TBD                                                                                |
| Candidate-a experimentation                           | `pnpm secrets:set <env> <service> <KEY>` via port-forward + writer-role JWT                                        | Shipped — see [`secrets-add-new.md`](../../../docs/guides/secrets-add-new.md)                                              |
| Dynamic DB credentials                                | OpenBao DB engine, no human in loop                                                                                | Future (Crawl row 3 of `proj.security-hardening`)                                                                          |

The killer rule: **no human types a secret VALUE into a UI in production.** Auto-generated, vendor-minted via operator-app, or dynamic. Form-input is the anti-pattern.

## Anti-patterns — instant reject

- Human typing a secret VALUE into a UI (GitHub form, web form, shell prompt). See killer rule.
- Generic catch-all workflow (`secrets-manage.yml`-shaped). Per-operation only.
- `ssh root@vm kubectl ...` or `ssh root@vm bao ...`. Use local kubectl + port-forward + writer-role JWT.
- Re-exporting `.local/<env>-openbao-root-token` after Phase 5b — violates Invariant 13.
- `bao kv put` instead of `bao kv patch` (replaces sibling keys).
- `bao login -method=kubernetes` in OpenBao CLI 2.5.x — that subcommand doesn't exist; use raw API: `bao write auth/kubernetes/login role=X jwt=Y`.
- Per-secret ExternalSecret YAML — violates Invariant 2.
- `valueFrom: secretKeyRef` per env var in pod spec — violates Invariant 3.
- Base64-in-git "encryption" — violates Invariant 4.
- Sealed Secrets / SOPS+ksops — explicitly rejected per `proj.security-hardening` Design Notes.

## Files to read by topic

| If you're doing…                              | Read                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding a new secret to an existing service    | [`docs/guides/secrets-add-new.md`](../../../docs/guides/secrets-add-new.md)                                                                                            |
| Rotating an existing secret                   | [`docs/guides/secrets-rotate.md`](../../../docs/guides/secrets-rotate.md)                                                                                              |
| Following the bootstrap flow                  | [`docs/runbooks/fork-quickstart.md`](../../../docs/runbooks/fork-quickstart.md)                                                                                        |
| Adding a new service (new k8s Deployment)     | [`docs/guides/node-formation-guide.md`](../../../docs/guides/node-formation-guide.md) + ESO ExternalSecret dir                                                         |
| Touching substrate provisioning               | [`scripts/setup/provision-env-vm.sh`](../../../scripts/setup/provision-env-vm.sh) Phases 5b.1–5b.5                                                                     |
| Touching the CLI                              | [`scripts/secrets/set-secret.sh`](../../../scripts/secrets/set-secret.sh) + test [`scripts/ci/tests/set-secret.test.sh`](../../../scripts/ci/tests/set-secret.test.sh) |
| Touching ExternalSecret manifests             | `infra/k8s/secrets/external-secrets/<env>/<service>/` (+ ClusterSecretStore at parent)                                                                                 |
| Touching substrate Argo Applications          | `infra/k8s/argocd/{openbao,external-secrets}-application.yaml` (PR #43)                                                                                                |
| Touching the env-var classification routing   | [`.claude/commands/env-update.md`](../../commands/env-update.md) — k8s app vs Compose-infra split                                                                      |
| Designing a new workflow that handles secrets | This file + `proj.agentic-fork-bootstrap` anti-patterns. Run it past the killer rule.                                                                                  |

## When to escalate

Surface to operator before writing code if:

- Adding a NEW entry point that isn't already CLI / workflow_dispatch / operator-MCP — Invariant 9 lists the only three sanctioned shapes.
- Changing `eso-reader` policy or `<env>-writer` role binding — affects every consumer.
- Bumping OpenBao or ESO chart version — rotation drill required (see `secrets-rotate.md` §Upgrade discipline).
- Anything that smells like Invariant 4 (NO_VALUE_IN_GIT) — finding a value in YAML / commit message / PR diff / chat is always a rotate-now event.
- Designing a workflow where humans type values into a form — recheck against the killer rule before building.
