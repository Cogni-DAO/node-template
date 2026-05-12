# Cogni node-template

Single-node quickstart for forking your own [Cogni DAO](https://cognidao.org) node. Production-ready Next.js + LangGraph + Doltgres stack.

## Fork it

```bash
# 1. Fork on GitHub: Cogni-DAO/node-template → <your-org>/<your-repo>
git clone https://github.com/<your-org>/<your-repo>
cd <your-repo>

# 2. Pick your node name (kebab-case) and run the rename helper.
#    This does all the git mv + sed in one shot.
scripts/rename-node.sh my-node

# 3. Install + verify.
pnpm install --no-frozen-lockfile
pnpm packages:build
pnpm test:ci
```

Commit the rename and you have a clean single-node repo named `my-node`. Push to your fork.

## What you got

- `nodes/my-node/` — Next.js app + LangGraph graphs + per-node packages
- `packages/` — shared libraries (ai-core, db-client, graph-execution-core, etc.)
- `infra/` — Docker compose, Argo CD ApplicationSets, k8s overlays, image catalog
- `.cogni/repo-spec.yaml` — single source of truth for node identity, governance, payments

The template node is `nodes/node-template/` and the rename script retargets every active config and workflow at your chosen name. After it runs, the only places still mentioning "node-template" are `docs/`, `work/`, and `.claude/skills/` (prose only — safe to leave or sed yourself).

## Upstream

This repo is a fork of [Cogni-DAO/cogni](https://github.com/Cogni-DAO/cogni). Pull shared-package improvements with:

```bash
git remote add upstream https://github.com/Cogni-DAO/cogni
git fetch upstream
git merge upstream/main   # conflicts only on stripped paths (nodes/operator/, etc.)
```

## Next steps after rename

1. **Identity:** rotate the placeholder UUIDs in `.cogni/repo-spec.yaml` and `nodes/my-node/.cogni/repo-spec.yaml` (see [docs/spec/identity-model.md](docs/spec/identity-model.md)).
2. **Payments:** wire your DAO wallet + chain ID in `.cogni/repo-spec.yaml` `payments_in.credits_topup` (see [docs/spec/payments.md](docs/spec/payments.md) if present, or grep `payments_in` for context).
3. **Env:** `cp .env.local.example .env.local`, fill values (start with [OpenRouter API key](https://openrouter.ai/keys)).
4. **Dev stack:** `pnpm dev:infra && pnpm dev` — Next.js on `http://localhost:3200`.
5. **Deploy:** see [docs/spec/ci-cd.md](docs/spec/ci-cd.md) and [docs/runbooks/DEPLOY.md](docs/runbooks/DEPLOY.md) for the Argo CD flow.

## Conventions

The repo follows a "fork-friendly by convention" rule: anywhere a single node name needs to appear, it lives in **`.cogni/repo-spec.yaml` `intent.name`** + the matching `infra/catalog/<name>.yaml` filename, and downstream config is glob-driven (`nodes/*`, `nodes/[^/]+/app/src` regex, etc.). See [docs/spec/private-node-repo-contract.md](docs/spec/private-node-repo-contract.md) for the contract.

## Contributing back

PRs improving the template itself are welcome — point them at this repo. PRs that belong in the multi-node monorepo (operator features, scheduler-worker, cross-node integrations) go to [Cogni-DAO/cogni](https://github.com/Cogni-DAO/cogni).
