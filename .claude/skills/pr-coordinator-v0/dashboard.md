# Candidate-a Flight Dashboard (hot state)

> ⚠️ **Do not commit updates to this file.** It is runtime state for the `pr-coordinator-v0` loop — refreshed each iteration, never part of a PR. `SKILL.md` is stable instructions; this file is the ephemeral scorecard.
>
> The committed copy is a template. The coordinator overwrites it in-session from authoritative sources (`origin/deploy/*` branches + GHCR) at loop start and after each flight.

## Live Build Matrix

| Env            | Operator (node-tpl)   | Poly                  | Resy                  | Flighted At        | Notes       |
| -------------- | --------------------- | --------------------- | --------------------- | ------------------ | ----------- |
| **test**       | _(idle)_              | _(idle)_              | _(idle)_              | —                  | slot=free   |
| **preview**    | —                     | —                     | —                     | —                  | not tracked |
| **production** | —                     | —                     | —                     | —                  | not tracked |

**Fill format per cell:** `pr-<N>/<sha7>` (e.g. `pr-848/78dd38a`). Use `_(idle)_` when the deploy-branch points at the previous flight but no QA is active.

## Current Flight

- **PR:**         —
- **SHA:**        —
- **Started at:** —
- **State:**      —  _(acquired | dispatched | waiting-ready | in-qa | scoring)_
- **Derek QA:**   —
- **grafana-watcher:** —

## Recent Flights (last 5)

| When (UTC)       | PR   | SHA     | Verdict     | Notes                             |
| ---------------- | ---- | ------- | ----------- | --------------------------------- |
| —                | —    | —       | —           | —                                 |

## Refresh Sources

- **test row** ← `git show origin/deploy/candidate-a:infra/control/candidate-lease.json` + last commit message of `origin/deploy/candidate-a`
- **preview row** ← digests in `origin/deploy/preview:infra/k8s/overlays/preview/*/kustomization.yaml`, mapped to PR SHA via `gh api orgs/Cogni-DAO/packages/container/cogni-template/versions`
- **production row** ← same pattern against `origin/deploy/production`
