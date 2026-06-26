# node-template

Node-at-root template for a **Cogni full-app submodule node** — the canonical single node, minted via GitHub generate-from-template and added as a git submodule at `nodes/<slug>/` in the operator monorepo (`Cogni-DAO/cogni`).

Seeded from `Cogni-DAO/cogni:nodes/node-template/` and projected to a
node-at-repo-root build surface.

- **Node-at-root** layout (`app/`, `graphs/`, `packages/`, `.cogni/`) so it mounts cleanly at `nodes/<slug>/` when added as a submodule.
- `.cogni/secrets-catalog.yaml` + `k8s/external-secrets/` are intentionally absent (bug.5086 Part D: a node inherits baseline secrets via the substrate; declares its own only when it has unique ones).
- The root workspace includes the required private `@cogni/*` package closure so a generated child repo can install, typecheck, build, and push its own image without the operator monorepo.
- `.github/workflows/ci.yaml` builds the app image, pushes to the repo-owned GHCR package (`ghcr.io/<owner>/<repo>-node`), pushes PR images as `pr-<number>-<headSha>`, and pushes `main` images as `sha-<childSha>`.
- The deploy/infra plane is intentionally absent: no candidate-flight, preview/prod promote, provision-env, Argo/AppSet, or parent infra workflows live here.

## Local checks

```bash
pnpm install --frozen-lockfile
pnpm check
docker build --target runner -t cogni-node-template:local .
```

## Node developer guides

- `docs/guides/contributing-to-cogni.md` — node contribution loop and ownership boundaries.
- `docs/guides/new-node-styling.md` — first-pass rebrand for a minted node.
- `docs/guides/add-secret.md` — node-owned secret declarations and typed consumption.
- `docs/guides/contribute-knowledge.md` — when reusable findings should become durable node knowledge.

## Conductor workspaces

This template ships a shared Conductor setup entrypoint:

- `conductor.json`
- `scripts/conductor-worktree-setup.sh`

When a node repo minted from this template is added as a Conductor project,
Conductor runs the setup script from the new workspace. The script refreshes
`origin/main`, symlinks `.env.cogni` and `.local-auth` from
`COGNI_NODE_AUTH_ROOT` or `COGNI_TEMPLATE_ROOT` when available, installs
dependencies, builds package declarations, and writes
`.context/conductor-setup.json` as proof that setup ran.

For a laptop that stores Cogni auth in the main monorepo checkout:

```bash
export COGNI_TEMPLATE_ROOT="$HOME/dev/cogni-template"
```

The operator consumes the pushed digest and owns URL/DNS/deployment state.

### Codex session cognition

Codex project-local hooks are trusted per absolute worktree path, so Conductor
workspaces can miss the cognition bootstrap unless every new worktree is
approved. Install the Cogni user-level hook once per machine instead:

```bash
pnpm codex:cognition:install
```

Then open `/hooks` in Codex once and trust the user-level `SessionStart` hook.
The installed hook is generic across Cogni node clones/forks: it reads the
current repo's `.cogni/repo-spec.yaml`, uses `.env.cogni`, and fetches
`https://<node-slug>.cognidao.org/api/v1/cognition`.

If the hook runs but cannot fetch cognition, it injects a loud bootstrap-blocked
message into the agent context. If the agent receives no cognition message at all,
Codex did not run the hook; check the one-time `/hooks` trust first.

## Inheriting from node-template (3-tier sync)

The operator keeps every node aligned with `node-template` automatically (a GitHub App webhook fires on each node-template release). Changes propagate in **three tiers, by path** — know which tier your edit lands in:

| Tier | Paths | What happens to your edit |
| --- | --- | --- |
| **1 — CI contract** | `.github/workflows/{ci,pr-build,pr-lint}.yaml`, `scripts/check-node-ci-workflow.mjs` | **Force-synced** from node-template. Do not diverge here; CI fixes land upstream first. |
| **2 — Substrate** | `app/src/app/api/**`, `app/src/shared/**`, `app/src/bootstrap/**`, `graphs/**`, `packages/**` | **Auto-merged** from node-template each release (conflict-free); you inherit framework + cognition improvements. |
| **3 — Your node** | `app/src/app/(public)/**`, `app/src/features/home/**`, branding/theme, `.cogni/repo-spec.yaml`, `.cogni/persona/**` | **Never synced** — build your node's identity, homepage, and features here in stability. |

The Tier-3 carve-out is declared in `.cogni/sync-manifest.yaml#node_local` (data, not hardcoded), so the boundary moves with the template. Full contract: the operator knowledge entry `node-template-sync-contract`.
