# AGENTS.md — Your Cogni Node

> This repo is a **Cogni node** minted from `node-template`. It is a sovereign
> repo: your code lives and is built here, in its own git boundary. A shared
> **operator** monorepo pins this repo as a submodule and runs the deploy/infra
> plane for you — you never edit the operator's `infra/catalog`, run
> `provision-env`, or touch Argo. See `docs/spec/node-ci-cd-contract.md` in the
> operator monorepo for the full two-views model.

## Your cognition is delivered at session start

SessionStart hooks run the shared loader
[`scripts/agent/session-cognition.sh`](scripts/agent/session-cognition.sh), which pulls a
**cognition bundle** — tooling invariants + a live skills index + knowledge-domain pointers —
and injects it into context. Claude Code uses the repo hook in
[`.claude/settings.json`](.claude/settings.json). Codex should use the user-level
machine hook installed by `pnpm codex:cognition:install`, then trust it once with
`/hooks`; this avoids per-worktree trust prompts in Conductor.

- The loader derives `https://<node-slug>.cognidao.org/api/v1/cognition` from
  `.cogni/repo-spec.yaml` `intent.name` and recalls **this node's own hub** with
  the NODE account key (`COGNI_NODE_API_KEY`); there is no `COGNI_COGNITION_URL` override.
- Self-serve if cognition does not load: register a NODE agent, save
  `COGNI_NODE_API_KEY` in `.env.cogni`, then retry. `.env.cogni` holds two accounts
  (NODE + OPERATOR for CI/CD) — see [`.env.cogni.example`](.env.cogni.example) and
  the `node-launch-handoff` knowledge entry. Conductor symlinks `.env.cogni` into future worktrees.
- This node serves its own bundle at `GET /api/v1/cognition` (authed, index-only — needs a principal; `/api/v1/agent/register` stays the one public bootstrap seam).

## What you own (node-dev half)

- **App + graphs + packages** at the repo root.
- **Your CI** (`.github/workflows/`), policy (`biome`, `tsconfig`, `.dependency-cruiser.cjs`), and `Dockerfile` — `POLICY_STAYS_LOCAL`. Your CI builds + pushes your own image (`FORK_FREEDOM`).
- **Review policy**: `.cogni/repo-spec.yaml` `gates:` + `.cogni/rules/`. A PR here routes + reviews against these (born-reviewable). Tune the gate set to your node's mission.

## Add a secret (node-dev half)

Declare the key's **shape** in `.cogni/secrets-catalog.yaml` and consume it via typed env in app code (fail-fast if missing). You do **not** set the value or wire the ExternalSecret — whoever owns the deploy env does that (`pnpm secrets:set <env> <slug> <KEY>`).

Use [`docs/guides/add-secret.md`](docs/guides/add-secret.md) or `/add-secret` for the node-local checklist.

## Customize node identity

Use [`docs/guides/new-node-styling.md`](docs/guides/new-node-styling.md) when changing the node logo, colors, metadata, public page, or chat defaults.

## Contribution + knowledge

Use [`docs/guides/contributing-to-cogni.md`](docs/guides/contributing-to-cogni.md) or `/contribute-to-cogni` for the node contribution loop. Use [`docs/guides/contribute-knowledge.md`](docs/guides/contribute-knowledge.md) or `/contribute-knowledge` before preserving reusable findings.

## Add a service (node-dev half)

App code + `Dockerfile` + a k8s **base** manifest + the **build→GHCR** workflow leg, all here. Your CI builds + pushes the image. The operator's plane generates the per-env overlay/AppSet/catalog row that references your pushed digest.

> The full operator-side guides (`create-service`, `secrets-add-new`) live in the
> operator monorepo and are the reference for the deploy-env half.
