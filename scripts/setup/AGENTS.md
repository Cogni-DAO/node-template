# setup · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Repository + environment setup scripts. Bash-first for substrate provisioning (called from `.github/workflows/provision-env.yml`); TypeScript planned for laptop-side setup.

## Pointers

- [SETUP_DESIGN.md](./SETUP_DESIGN.md): Future architecture and implementation plan
- [README.md](../../README.md): Current manual setup instructions
- `bootstrap.sh` — laptop-side bootstrap orchestrator (auto-generates `.env.<env>` from `.env.bootstrap`)
- `provision-env-vm.sh` — full substrate bring-up (VM, DNS, k3s, OpenBao, ESO, Argo). Called from `provision-env.yml`. Phase 5c seeds per-service + `_shared` OpenBao paths from `.env.<env>` (including observability creds — see `docs/design/observability-creds-shared.md`).

## Boundaries

```json
{
  "layer": "scripts",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none (no implementation yet)
- **CLI (if any):** Planned: `pnpm setup local|infra|github|dao`
- **Env/Config keys:** none currently
- **Files considered API:** none (planning phase)

## Responsibilities

- This directory **does**: Substrate provisioning scripts (VM/DNS/k3s/OpenBao/ESO/Argo), Grafana child-SA mint, bootstrap orchestrator.
- This directory **does not**: Contain runtime app code or business logic. No imports from `nodes/*/app/src/**`.

## Usage

**Current:**

```bash
# See README.md for current manual setup steps
```

**Planned:**

```bash
pnpm setup local     # Local development setup
pnpm setup infra     # Infrastructure provisioning
pnpm setup github    # GitHub environments + secrets
pnpm setup dao       # DAO contract deployment
```

## Standards

- Follow existing script conventions in `scripts/bootstrap/install/*`
- Use TypeScript for complex logic, bash for simple wrappers
- All operations must be idempotent (safe to re-run)
- Clear error messages with actionable next steps

## Dependencies

- **Current:** None
- **Future:** Will use existing `infra/provision/cherry/base/` Terraform configs

## Change Protocol

- Update this file when actual implementation begins
- Move status from "planning" to "draft" when first scripts are created
- Bump **Last reviewed** date when implementation starts

## Notes

- Currently contains only design documentation
- Implementation help wanted - see README.md for contribution info
- Priority: `pnpm setup local` command for contributors first
