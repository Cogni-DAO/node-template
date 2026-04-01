<!-- doc-id: guide.multi-node-dev -->
<!-- status: draft -->
<!-- trust: measured -->

# Multi-Node Development Guide

## Layout

```
apps/operator/          → Operator dashboard (port 3000)
nodes/node-template/    → Base template for new nodes
nodes/poly/             → Poly prediction node (port 3100)
nodes/resy/             → Resy reservations node (port 3300)
```

Each node has two workspace packages: `app/` (Next.js) and `graphs/` (AI graphs).
All nodes share infra services (Postgres, Temporal, LiteLLM, Redis) run by the operator stack.

## Running Locally

```bash
# Operator only (infra + operator on port 3000)
pnpm dev:stack

# Single node (infra + one node)
pnpm dev:stack:poly              # port 3100
pnpm dev:stack:resy              # port 3300

# Everything (infra + operator + all nodes)
pnpm dev:stack:full              # ports 3000, 3100, 3300

# Docker (containerized) — TODO: task.0247 adds per-node containers
pnpm docker:stack:full           # currently launches operator only
```

For manual control, start infra separately and run apps individually:

```bash
pnpm dev:infra                              # shared services
pnpm dev                                    # operator (port 3000)
pnpm --filter @cogni/poly-app dev           # poly (port 3100)
pnpm --filter @cogni/resy-app dev           # resy (port 3300)
```

## Typechecking

```bash
# Operator (default, runs in pnpm check)
pnpm typecheck

# Individual nodes (from repo root, same pattern)
pnpm typecheck:node-template
pnpm typecheck:poly
pnpm typecheck:resy
```

All typecheck commands run from the repo root using `tsc -p <path>/tsconfig.app.json`.
Each node's tsconfig overrides `@/*` paths to resolve to its own `src/`.

## Testing

```bash
# Operator tests (unit + contract, no server needed)
pnpm test

# Operator stack tests (requires dev:stack:test running)
pnpm test:stack:dev

# Node-specific tests (from repo root, via pnpm filter)
pnpm --filter @cogni/poly-app test
pnpm --filter @cogni/resy-app test
pnpm --filter @cogni/poly-graphs test
pnpm --filter @cogni/resy-graphs test
```

## Pre-commit Gate

```bash
pnpm check          # Operator: typecheck + lint + format + tests + docs + arch
```

Node typechecks are not yet in the `pnpm check` pipeline — run them manually
when you change node-specific code. This will be unified in task.0248.

## Creating a New Node

1. Copy `nodes/node-template/` → `nodes/{name}/`
2. Update `app/package.json`: name → `@cogni/{name}-app`, port
3. Update `graphs/package.json`: name → `@cogni/{name}-graphs`
4. Add root scripts to `package.json`:
   - `"typecheck:{name}": "tsc -p nodes/{name}/app/tsconfig.app.json --noEmit"`
5. Add node-specific features under `app/src/features/`
6. Add node-specific graphs under `graphs/src/graphs/`
7. Run `pnpm install` to link the new workspace packages

## Architecture Notes

- Each node app is a **full platform copy** of the operator (auth, chat, streaming,
  billing, treasury) minus the DAO formation wizard
- Node-specific features (e.g. resy's reservations) live in `app/src/features/`
- Shared packages (`@cogni/ai-tools`, `@cogni/market-provider`, etc.) are in `packages/`
- Future: task.0248 will extract the shared platform into `packages/node-platform`
  so nodes become thin shells instead of full copies
