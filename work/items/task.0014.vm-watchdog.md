---
id: task.0014
type: task
title: "VM watchdog: systemd timer auto-restarts app on health failure"
status: Todo
priority: 0
estimate: 2
summary: Add a systemd timer + script on the VM that curls /api/meta/readyz every 30s and restarts the app container after 4 consecutive failures (~2 min), with deploy lockfile and Loki event emission
outcome: App container auto-recovers from hangs within 2 minutes without human intervention; restart events visible in Loki
spec_refs: vm-watchdog, spec.observability-requirements
assignees: derekg1729
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [infra, reliability, P0]
external_refs:
---

# VM watchdog: systemd timer auto-restarts app on health failure

## Context

Feb 7-8, 2026: Two multi-hour outages with zero alerting or auto-recovery. The app was "healthy but hung" — Docker health checks passed, but the event loop was blocked. No watchdog, no external monitor. See [postmortem](../../docs/postmortems/2026-02-07-production-vm-loss.md) and [proj.reliability](../projects/proj.reliability.md) P0 roadmap.

The app can be in a state where `/readyz` (or page renders) hang indefinitely while Docker considers the container healthy. Docker `restart: always` only fires on process exit, not on event-loop hangs. A VM-level watchdog that probes the HTTP endpoint and force-restarts the container is the missing safety net.

See [vm-watchdog spec](../../docs/spec/vm-watchdog.md) for full design, invariants, and rationale.

## Requirements

- A bash script (`cogni-watchdog.sh`) that:
  - Checks for deploy lockfile (`/var/lib/cogni/watchdog-pause`) — if present and < 15 min old, skip probe and exit 0
  - Curls `http://127.0.0.1:3000/api/meta/readyz` with a 2s timeout
  - Tracks consecutive failure count via a statefile (`/var/lib/cogni/watchdog-failures`)
  - After 4 consecutive failures, emits `watchdog.app_restart` event to Loki, then runs `docker compose restart app`
  - Resets the failure counter on success, restart, or lockfile skip
  - Logs each probe result to journald (stdout, picked up by systemd)
  - Exits 0 always (WATCHDOG_EXIT_ZERO invariant)
- A systemd timer (`cogni-watchdog.timer`) that fires every 30s (OnBootSec=90s, OnUnitActiveSec=30s)
- A systemd service (`cogni-watchdog.service`) that runs the script (Type=oneshot)
- App port published on loopback: `127.0.0.1:3000:3000` in docker-compose.yml (WATCHDOG_LOOPBACK_ONLY)
- Deploy lockfile in `deploy.sh`: write before runtime deploy, remove after health check (WATCHDOG_DEPLOY_SAFE)
- Installation via `deploy.sh` only — no bootstrap.yaml duplication (WATCHDOG_SINGLE_INSTALL)
- Loki event on restart using `emit_deployment_event` pattern (WATCHDOG_LOKI_ON_RESTART)
- No extra containers — systemd + curl only (constraint: 2GB shared VM)
- Upholds **HEARTBEAT_LIVENESS** from `spec.observability-requirements` and **WATCHDOG_RECOVERY_BOUND** from `vm-watchdog` spec

## Allowed Changes

- `platform/infra/files/scripts/cogni-watchdog.sh` — **new** watchdog script
- `platform/infra/files/systemd/cogni-watchdog.service` — **new** systemd service unit
- `platform/infra/files/systemd/cogni-watchdog.timer` — **new** systemd timer unit
- `platform/infra/services/runtime/docker-compose.yml` — add `ports: ["127.0.0.1:3000:3000"]` to app service
- `platform/ci/scripts/deploy.sh` — add rsync of scripts/systemd, lockfile write/remove, systemctl enable
- `platform/infra/files/AGENTS.md` — update to mention watchdog script and systemd units

## Plan

- [ ] Add `ports: ["127.0.0.1:3000:3000"]` to `app` service in `docker-compose.yml`
  - Loopback only — no external exposure (WATCHDOG_LOOPBACK_ONLY)
- [ ] Create `platform/infra/files/scripts/cogni-watchdog.sh`
  - Check lockfile: if `/var/lib/cogni/watchdog-pause` exists and mtime < 15 min, log "deploy in progress, skipping", reset counter, exit 0
  - Probe `http://127.0.0.1:3000/api/meta/readyz` with `curl -sf -m 2`
  - Read failure count from `/var/lib/cogni/watchdog-failures` (default 0)
  - On success: reset counter to 0, log "watchdog: readyz OK"
  - On failure: increment counter, log "watchdog: readyz FAILED (N/4)"
  - If counter >= 4: log "watchdog: RESTARTING app container", emit Loki event, run docker compose restart, reset counter
  - Loki emit: reuse `curl + jq` pattern from deploy.sh's `emit_deployment_event`, reading Loki creds from `/opt/cogni-template-runtime/.env`
  - Always exit 0
- [ ] Create `platform/infra/files/systemd/cogni-watchdog.timer`
  - `OnBootSec=90s` (wait for full app startup after VM boot)
  - `OnUnitActiveSec=30s` (every 30s thereafter)
  - `AccuracySec=5s`
- [ ] Create `platform/infra/files/systemd/cogni-watchdog.service`
  - `Type=oneshot`
  - `ExecStart=/opt/cogni/scripts/cogni-watchdog.sh`
- [ ] Update `deploy.sh` remote script to install watchdog + manage lockfile
  - Early in remote script: rsync scripts to `/opt/cogni/scripts/`, systemd units to `/etc/systemd/system/`
  - Run `systemctl daemon-reload && systemctl enable --now cogni-watchdog.timer`
  - Before Step 7 (image pull): write `/var/lib/cogni/watchdog-pause`
  - After Step 12 (health check pass): remove `/var/lib/cogni/watchdog-pause`
  - In `on_fail` trap: also remove `/var/lib/cogni/watchdog-pause` (prevent permanent disable)
- [ ] Update `platform/infra/files/AGENTS.md` to document watchdog script and systemd units

## Validation

**Local (script logic):**

```bash
# Script is valid bash
bash -n platform/infra/files/scripts/cogni-watchdog.sh

# Port published loopback-only
grep '127.0.0.1:3000:3000' platform/infra/services/runtime/docker-compose.yml

# Lockfile referenced in deploy
grep 'watchdog-pause' platform/ci/scripts/deploy.sh
```

**CI gate:**

```bash
pnpm check
```

**Manual (on VM after deploy):**

```bash
# Timer is active
systemctl is-active cogni-watchdog.timer

# Timer fires correctly
systemctl list-timers cogni-watchdog.timer

# Script runs and logs to journald
journalctl -u cogni-watchdog.service --since "5 min ago"

# Simulate hang: docker pause cogni-runtime-app-1
# Wait ~2 min, check journald for restart
journalctl -u cogni-watchdog.service --since "3 min ago" | grep RESTARTING
# Verify Loki event: {service="watchdog"} |= "watchdog.app_restart"
docker unpause cogni-runtime-app-1  # cleanup if needed

# Deploy lockfile test
touch /var/lib/cogni/watchdog-pause
# Wait 30s, check journald shows "deploy in progress, skipping"
rm /var/lib/cogni/watchdog-pause
```

## Review Checklist

- [ ] **Work Item:** `task.0014` linked in PR body
- [ ] **Spec:** all vm-watchdog invariants upheld (WATCHDOG_RECOVERY_BOUND, WATCHDOG_DEPLOY_SAFE, WATCHDOG_EXIT_ZERO, WATCHDOG_LOOPBACK_ONLY, WATCHDOG_LOKI_ON_RESTART, WATCHDOG_SINGLE_INSTALL)
- [ ] **Spec:** HEARTBEAT_LIVENESS from observability-requirements upheld
- [ ] **Tests:** bash -n validates script syntax; manual VM test validates end-to-end
- [ ] **Reviewer:** assigned and approved

## PR / Links

- [vm-watchdog spec](../../docs/spec/vm-watchdog.md)
- [Postmortem: Feb 7-8 outages](../../docs/postmortems/2026-02-07-production-vm-loss.md)
- [proj.reliability](../projects/proj.reliability.md)
- [spec.observability-requirements](../../docs/spec/observability-requirements.md)

## Attribution

-
