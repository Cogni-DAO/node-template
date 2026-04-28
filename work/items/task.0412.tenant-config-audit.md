---
id: task.0412
type: task
title: "Tenant config audit — boot-time installation check + Loki signal + cross-leak alert (precursor to operator-owned node DB)"
status: needs_design
priority: 1
rank: 5
estimate: 2
branch:
summary: "task.0409's MVP relies on five operational invariants (App-installation scope, env-var separation, GH_REPOS non-overlap, distinct TEMPORAL_NAMESPACE, distinct webhook URLs). None are enforced in code. Add a boot-time preflight that hits each App's `/installations` endpoint, asserts the App is installed only on its expected repo set, logs `tenant.config_audit` to Loki, and fails the boot if a cross-leak is detected. ~30 lines + 1 alert rule. **Direct precursor to the vNext design where the operator owns a node-id database, registers internal/external nodes, and pings their installation endpoints on a cadence.**"
outcome: '(1) On every operator pod boot, a preflight runs: for each configured GitHub App, query its `/installations` endpoint, collect the list of repo full_names, assert the set equals the pod''s `GH_REPOS` allowlist (no missing, no extra). (2) Result is logged as a structured `tenant.config_audit` event to Pino → Loki. Fields: `appId`, `expectedRepos`, `actualRepos`, `extraneousRepos`, `missingRepos`, `verdict`. (3) Mismatch → log error + boot fails with non-zero exit (pod CrashLoopBackOff is the alert). (4) A Grafana alert rule fires on any `verdict != "ok"` line in Loki. (5) Lays the foundation for task.0413+ (operator-owned node database — see vNext below).'
spec_refs:
  - vcs-integration
  - github-app-webhook-setup
assignees: derekg1729
credit:
project: proj.vcs-integration
pr:
reviewer:
revision: 1
blocked_by:
  - task.0409
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, audit, observability, multi-tenant, ops]
external_refs:
  - work/items/task.0409.multi-tenant-git-review-routing.md
  - work/items/task.0411.in-binary-multi-tenant-operator.md
---

## Problem

task.0409's MVP design hangs on five operational invariants, none enforced in code:

1. `cogni-review-production` App not installed on `Cogni-DAO/test-repo`.
2. `cogni-review-test` App not installed on `Cogni-DAO/node-template`.
3. `GH_REPOS` allowlists per deploy are non-overlapping.
4. Distinct `TEMPORAL_NAMESPACE` per deploy (so workers don't cross-pickup).
5. Distinct webhook URLs in App config (each App points only to its own deploy).

Five operational invariants = five single points of failure. A repo-admin clicking "Install" on the wrong App, an env-var typo on a deploy, a forgotten cleanup after a debugging session — any of these silently violates an invariant and there's no detection. The MVP's allowlist guard at the webhook route limits damage if invariant 3 holds, but doesn't catch invariants 1, 2, 4, or 5.

## Approach

Boot-time preflight that turns invariants into an alertable signal:

```ts
async function auditTenantConfig(env, githubAdapter) {
  const expectedRepos = new Set(env.GH_REPOS.split(","));
  const installations = await githubAdapter.listAppInstallations();
  const actualRepos = new Set(installations.flatMap((i) => i.repos));

  const extraneous = [...actualRepos].filter((r) => !expectedRepos.has(r));
  const missing = [...expectedRepos].filter((r) => !actualRepos.has(r));
  const verdict =
    extraneous.length === 0 && missing.length === 0 ? "ok" : "drift";

  log.info(
    {
      event: "tenant.config_audit",
      appId: env.GH_REVIEW_APP_ID,
      expectedRepos: [...expectedRepos],
      actualRepos: [...actualRepos],
      extraneousRepos: extraneous,
      missingRepos: missing,
      verdict,
    },
    "tenant config audit"
  );

  if (verdict !== "ok") {
    throw new Error(
      `tenant.config_audit FAIL — App ${env.GH_REVIEW_APP_ID} drift: extraneous=${extraneous}, missing=${missing}`
    );
  }
}
```

Wired into the existing operator boot path (`bootstrap/container.ts`), gated on `GH_REVIEW_APP_ID` being configured (otherwise no-op). Throws on drift → pod fails to start → Kubernetes CrashLoopBackOff → existing alert wakes someone up.

Grafana alert rule (paired): `count_over_time({namespace=~"cogni-(test|production)"} | json | event="tenant.config_audit" | verdict!="ok"[5m]) > 0`.

## vNext direction (not part of this task — captured for ordering)

Per Derek (2026-04-28): the long-term direction is that **the operator owns a node-id database, tracking internal/external nodes and pinging their installation endpoints on a cadence**. This task is the **boot-time precursor** — it implements the _check_ in its simplest form (one-shot at boot, against env config) before generalizing to:

- A `nodes` table in operator's DB carrying `{ node_id, kind: internal|external, github_app_id, expected_repos, last_audited_at, last_verdict }`.
- A scheduled `node.audit` workflow (Temporal cron, every 6h) that runs the same check for every registered node, persists the result, and triggers alerts on drift.
- An admin UI / API for registering external nodes (when Cogni reviews customer forks, customer registers their App ID + expected repos).
- Eventually, this is also the substrate for **task.0411** (in-binary multi-tenant) — the node-id DB IS the tenant config, replacing static env vars.

That's a separate task to file (~ task.0413 or roll into a new project) once this MVP audit lands and proves the signal is useful.

## Files (this MVP)

- New: `nodes/operator/app/src/bootstrap/audit/tenant-config-audit.ts` — pure async function, takes `env` + `githubAdapter`, returns void or throws.
- Modify: `nodes/operator/app/src/bootstrap/container.ts` — call the audit at boot, before the container is returned.
- Modify: `nodes/operator/app/src/adapters/server/vcs/github-vcs.adapter.ts` — add `listAppInstallations()` if not already present (it isn't — we only use `resolveInstallationId(owner, repo)` today).
- New: `tests/unit/nodes/operator/bootstrap/tenant-config-audit.test.ts` — happy path + drift case + missing-creds skip case.
- New: `infra/grafana/alerts/tenant-config-audit-drift.yaml` (or wherever alert rules live) — Loki query on `verdict != "ok"`.
- Modify: `docs/guides/github-app-webhook-setup.md` — mention the audit in the deploy-verification section.

## Validation

- **exercise:** (1) Boot operator locally with `GH_REVIEW_APP_ID` + `GH_REPOS=Cogni-DAO/test-repo`. Verify pod starts cleanly + Loki shows `tenant.config_audit verdict="ok"`. (2) Manually install the `cogni-review-test` App on a second repo (e.g. a personal scratch repo). Restart pod. Verify pod fails to start with the expected error message + Loki shows `verdict="drift" extraneousRepos=[...]`. (3) Confirm the Grafana alert fires within 5 minutes.
- **observability:** `scripts/loki-query.sh '{namespace=~"cogni-(test|production)"} | json | event="tenant.config_audit"' 10 50` — every operator boot produces exactly one such entry per configured App. The alert query above is the cross-leak detector.

## Why this is priority 1, not priority 0

task.0409 (the MVP) gets `pnpm test:external` running via dual-deploy + allowlist guard. It can ship without this audit. But this task **must be filed before task.0409 ships** — the operational fragility is real, and without an enforcement layer the next agent will rediscover the cross-leak hole the hard way. Filing now + scheduling for the deploy hardening pass.

## Pointers

- task.0409 — the dual-deploy MVP this audits
- task.0411 — vFuture in-binary multi-tenant; consumes the same node-config substrate this seeds
