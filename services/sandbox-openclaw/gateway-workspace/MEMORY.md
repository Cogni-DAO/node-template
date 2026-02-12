# Cogni Project Context

## Architecture

- **Framework**: Next.js (TypeScript, App Router) with hexagonal architecture (ports & adapters)
- **Layer order**: `app → features → ports → core`, adapters connect from outside
- **Infra**: Docker + OpenTofu → Spheron (managed Akash), all open-source tooling
- **Toolchain**: pnpm, Biome, ESLint, Prettier, Vitest, Playwright
- **Observability**: Pino JSON → Alloy → Loki (dev) or Grafana Cloud (prod)
- **CI entrypoint**: `pnpm check` (fast, no infra) / `pnpm check:full` (CI parity with Docker)

## Key Conventions

- **API contracts**: All HTTP shapes in `src/contracts/*.contract.ts` using Zod. No manual type dups.
- **Specs**: As-built documentation in `docs/spec/`. Write spec before code.
- **Work items**: `work/items/` — tasks, bugs, stories with YAML frontmatter
- **Commits**: Conventional Commits format: `type(scope): description`
- **AGENTS.md**: Every directory has one. Read it before working in that directory.

## File Layout

```
src/                     # Application source (hex layers)
  contracts/             # Zod API contracts (source of truth)
  core/                  # Domain logic (no framework deps)
  ports/                 # Interface definitions
  features/              # Orchestration layer
  adapters/              # External integrations
  app/                   # Next.js app router
packages/                # Shared workspace packages
services/                # Infrastructure services (Docker configs)
platform/                # Deployment infra (OpenTofu, compose)
docs/                    # Documentation
  spec/                  # Technical specifications
  guides/                # How-to guides
work/                    # Work management
  items/                 # Tasks, bugs, stories
  projects/              # Project roadmaps
```

## OpenClaw Integration

- OpenClaw is the AI agent runtime — runs in Docker with internet egress
- Two modes: gateway (long-running, this container) and ephemeral (one-shot, deprioritized)
- All LLM calls route through nginx proxy → LiteLLM → OpenRouter
- Billing tracked by LiteLLM spend logs, not OpenClaw self-reporting
- Heartbeats disabled (`heartbeat.every: "0"`)
- OpenClaw's own sandbox, cron, elevated tools all disabled

## Known Gotchas

- `pnpm check` must pass before any commit — includes lint, types, format, tests, docs validation
- Docker tmpfs at `/run` masks volume mounts — use top-level paths like `/llm-sock/`
- The repo-root `AGENTS.md` is for human-guided coding agents, not for this gateway agent
- `OPENCLAW_CONFIG_PATH` must be a full file path, not a directory
