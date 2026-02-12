---
id: bug.0038.handoff
type: handoff
work_item_id: bug.0038
status: active
created: 2026-02-12
updated: 2026-02-12
branch: fix/deploy-targeted-pull-ssh-keepalive
last_commit: f775a84e
---

# Handoff: Deploy targeted pulls + SSH keepalive

## Context

- Production deploy timed out with `client_loop: send disconnect: Broken pipe` after 25+ minutes pulling images over SSH
- Root cause: `deploy.sh` ran a blanket `docker compose pull` of ALL 15+ services (including pinned-digest images that never change), AND the SSH connection had no keepalive settings
- The SSH test connection in the GH Actions workflow had `ServerAliveInterval` but the actual deploy SSH did not
- Follow-on from bug.0015 (disk cleanup ordering), which fixed WHEN cleanup runs but left the blanket pull in place
- Failed run: https://github.com/Cogni-DAO/node-template/actions/runs/21936705892/job/63354600251

## Current State

- **Committed** (on branch, 1 commit `f775a84e`):
  - SSH keepalive added to both `SSH_OPTS` paths (`deploy.sh:156,166`)
  - Blanket `compose pull` replaced with 4 targeted `docker pull` commands (app, migrator, scheduler-worker, openclaw-gateway)
  - Removed useless `--dry-run` validation step (checked compose syntax, not registry)
  - Removed SourceCred explicit pull (immutable pinned tag, `compose up -d` handles cache)
  - Pinned `busybox:1.37` in `docker-compose.yml`
- **Unstaged** (needs review before committing):
  - `deploy.sh`: Added `PNPM_STORE_IMAGE` variable + explicit pull alongside the other sandbox images
  - `seed-pnpm-store.sh`: Changed from self-contained pull to `${PNPM_STORE_IMAGE:?}` (requires caller to set variable)
  - `platform/ci/AGENTS.md`: Added targeted-pull and SSH keepalive notes
  - Work item, project, index: Status set to Done
- **NOT tested**: Post-prune deploy path where `compose up -d` must pull ~10 static images inline

## Decisions Made

- Targeted pulls over blanket compose pull — only images that change per deploy are explicitly pulled
- Static/pinned images rely on `compose up -d` default `--pull missing` behavior
- `:latest` tags (openclaw-gateway, pnpm-store) are explicitly pulled to pick up updates (manifest check ~2s if unchanged)
- Pinned tags/digests (postgres, litellm, alloy, temporal, autoheal, nginx, git-sync, busybox, sourcecred) use local cache

## Next Actions

- [ ] **Review unstaged changes** — the pnpm-store variable refactor across deploy.sh + seed-pnpm-store.sh needs scrutiny; decide if the coupling is acceptable
- [ ] **Test post-prune path** — SSH to VM, run `docker system prune -af`, then deploy. Verify `compose up -d` pulls all missing static images and deploy succeeds
- [ ] **Test normal path** — deploy with all images cached. Verify only the 5 targeted images do manifest checks
- [ ] **Decide on pnpm-store error handling** — the committed version has no pnpm-store pull at all; the unstaged version has `docker pull ... || log_warn` (non-fatal). Should pnpm-store pull failure be fatal or non-fatal?
- [ ] **Consider post-deploy cleanup** — `docker image prune -f` after health checks to remove dangling old app/migrator images (listed in bug.0038 plan but not implemented)
- [ ] Stage closeout changes, amend or new commit, push, open PR

## Risks / Gotchas

- **Post-prune `compose up -d` is the untested path**: If any static image pull fails during `compose up` (rate limit, transient error), the error surfaces at Step 10 instead of a dedicated pull step, making it harder to diagnose
- **`seed-pnpm-store.sh` coupling**: The unstaged change makes it depend on `$PNPM_STORE_IMAGE` being set by the caller. If this script is ever sourced from a different context, it will fail hard. Currently deploy-remote.sh is the only caller.
- **SourceCred first deploy after prune**: `$SOURCECRED_COMPOSE up -d` must pull the image if missing. This is standard compose behavior but was previously an explicit `compose pull`.

## Pointers

| File / Resource                                          | Why it matters                                                |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `platform/ci/scripts/deploy.sh:643-671`                  | Targeted pull block + pnpm seed (the core change)             |
| `platform/ci/scripts/deploy.sh:153-166`                  | SSH_OPTS with keepalive (both code paths)                     |
| `platform/ci/scripts/deploy.sh:5-18`                     | Header invariants (TARGETED_PULL, SSH_KEEPALIVE)              |
| `platform/ci/scripts/seed-pnpm-store.sh`                 | Unstaged: changed from self-contained to caller-dependent     |
| `platform/infra/services/runtime/docker-compose.yml:200` | busybox pinned to 1.37                                        |
| `work/items/bug.0038.deploy-blanket-pull-ssh-timeout.md` | Full investigation, image inventory table, reproduction steps |
| `.github/workflows/deploy-production.yml`                | GH Actions workflow that calls deploy.sh                      |
