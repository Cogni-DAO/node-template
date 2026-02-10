---
id: vm-watchdog
type: spec
title: VM Watchdog
status: draft
spec_state: draft
trust: draft
summary: Systemd-based health probe that auto-restarts the app container when readyz fails, with deploy-safe lockfile and Loki event emission
read_when: Implementing the watchdog, modifying deploy.sh, changing health probe endpoints, debugging auto-restarts
implements: proj.reliability
owner: derekg1729
created: 2026-02-10
verified: null
tags:
  - infra
  - reliability
  - observability
---

# VM Watchdog

> Systemd timer probes the app container's health endpoint every 30s from the VM host. After consecutive failures, it restarts the container and emits a structured event to Loki. A deploy lockfile prevents interference during deployments.

### Key References

|                |                                                                                  |                                        |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| **Project**    | [proj.reliability](../../work/projects/proj.reliability.md)                      | Reliability roadmap (P0 watchdog item) |
| **Spec**       | [observability-requirements](./observability-requirements.md)                    | HEARTBEAT_LIVENESS invariant           |
| **Spec**       | [observability](./observability.md)                                              | Logging and metrics architecture       |
| **Postmortem** | [2026-02-07 Production VM Loss](../postmortems/2026-02-07-production-vm-loss.md) | Incident that motivated this design    |

## Design

### Probe Flow

```
systemd timer (every 30s)
  │
  ▼
cogni-watchdog.sh
  │
  ├── check /var/lib/cogni/watchdog-pause → EXISTS? → skip, exit 0
  │
  ├── curl -sf -m 2 http://127.0.0.1:3000/api/meta/readyz
  │     │
  │     ├── 200 OK → reset /var/lib/cogni/watchdog-failures to 0, exit 0
  │     │
  │     └── FAIL (timeout, non-200, connection refused)
  │           │
  │           ├── increment failure counter in /var/lib/cogni/watchdog-failures
  │           │
  │           ├── counter < THRESHOLD (4) → log "FAILED (N/4)", exit 0
  │           │
  │           └── counter >= THRESHOLD
  │                 │
  │                 ├── log "RESTARTING app container"
  │                 ├── emit Loki event: watchdog.app_restart
  │                 ├── docker compose restart app
  │                 ├── reset counter to 0
  │                 └── exit 0
  │
  └── (always exits 0 — timer must never stop)
```

### Port Reachability

The `app` container does **not** publish port 3000 to the VM host. Caddy reaches it via Docker DNS on the `cogni-edge` network. For the watchdog to probe from the host, port 3000 must be published on loopback:

```yaml
# docker-compose.yml — app service
ports:
  - "127.0.0.1:3000:3000"
```

This binds to `127.0.0.1` only (no external exposure). It also enables direct `curl` debugging from the VM host, which is independently valuable.

**Why not probe via Caddy?** If Caddy is down, the watchdog would detect failure and restart the app — wrong target. Probing port 3000 directly isolates the app health signal from the edge proxy.

**Why not `docker exec`?** If the Docker daemon is degraded (which happened during the Feb 7 incident), `docker exec` itself hangs. A direct HTTP probe from the host is the most robust option.

### Deploy Lockfile

During deployment, the app container is intentionally stopped (image pull, migration, restart). The deploy takes several minutes. Without protection, the watchdog would accumulate 4+ failures during a normal deploy and restart the app mid-migration.

**Mechanism:**

1. `deploy.sh` (remote script) writes `/var/lib/cogni/watchdog-pause` before starting the runtime deploy
2. `cogni-watchdog.sh` checks for this file at the start of each run — if present, resets the failure counter and exits 0
3. `deploy.sh` removes `/var/lib/cogni/watchdog-pause` after the post-deploy health check passes
4. If `deploy.sh` fails (trap on ERR), the lockfile is still removed in the error handler to prevent the watchdog from being permanently disabled

**Stale lockfile protection:** The watchdog checks the lockfile's `mtime`. If it's older than 15 minutes, the watchdog ignores it (treats as stale) and resumes normal probing. This prevents a failed deploy from permanently disabling the watchdog.

### Loki Event Emission

Restart events are pushed to Loki so the Cogni platform can observe its own recovery actions. The emission reuses the same `curl` + `jq` pattern as `deploy.sh`'s `emit_deployment_event()`.

**Event structure:**

Labels:

| Label     | Value             |
| --------- | ----------------- |
| `app`     | `cogni-template`  |
| `env`     | from runtime .env |
| `service` | `watchdog`        |
| `stream`  | `stdout`          |

JSON payload fields: `level: "warn"`, `event: "watchdog.app_restart"`, `msg: "Restarting app after N consecutive readyz failures"`, `failures: N`, `time: "<iso>"`

The Loki push is best-effort (suppress errors) and only fires on restart — not on every probe. If Loki credentials are not configured (missing `.env`), the push is silently skipped.

### Installation Path

**Single path: `deploy.sh`** (no bootstrap.yaml duplication).

The watchdog only matters after the app stack is deployed. `bootstrap.yaml` runs during VM provisioning when no app exists. Installing via `deploy.sh` means:

- One canonical source for the script and unit files (in the repo)
- No content duplication in cloud-init `write_files`
- Updates propagate automatically on every deploy

**What deploy.sh does:**

1. rsync `platform/infra/files/scripts/` → `/opt/cogni/scripts/` on VM
2. rsync `platform/infra/files/systemd/` → `/etc/systemd/system/` on VM
3. `systemctl daemon-reload && systemctl enable --now cogni-watchdog.timer`
4. Write lockfile before runtime deploy starts
5. Remove lockfile after post-deploy health check passes

### Systemd Units

**Timer** (`cogni-watchdog.timer`):

- `OnBootSec=90s` — wait for app startup after VM boot (app depends on postgres, litellm, temporal)
- `OnUnitActiveSec=30s` — probe every 30s thereafter
- `AccuracySec=5s` — keep timing reasonably tight

**Service** (`cogni-watchdog.service`):

- `Type=oneshot` — runs script, exits
- `ExecStart=/opt/cogni/scripts/cogni-watchdog.sh`
- No `Restart=` — the timer handles scheduling

## Goal

Define the contract for a VM-level watchdog that auto-recovers the app container from hangs, crash loops, and startup failures within ~2 minutes, while being safe during deployments and emitting events visible to the Cogni observability stack.

## Non-Goals

- Detecting OOM root cause (that's `spec.observability-requirements` BELOW_APP_ATTRIBUTION + cAdvisor)
- External uptime monitoring / alerting (separate proj.reliability deliverable)
- Replacing Docker HEALTHCHECK (the watchdog complements it, doesn't replace it)
- Covering preview environment (preview runs on a different VM; watchdog is per-VM)

## Invariants

| Rule                     | Constraint                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| WATCHDOG_RECOVERY_BOUND  | App container must be restarted within 150s of readyz becoming unreachable (4 probes \* 30s + restart latency)    |
| WATCHDOG_DEPLOY_SAFE     | Watchdog must not restart the app while `/var/lib/cogni/watchdog-pause` exists and is < 15 min old                |
| WATCHDOG_STALE_LOCKFILE  | A lockfile older than 15 minutes is treated as stale and ignored                                                  |
| WATCHDOG_EXIT_ZERO       | The watchdog script always exits 0 regardless of probe result, restart outcome, or Loki push failure              |
| WATCHDOG_LOKI_ON_RESTART | Every app restart emits a `watchdog.app_restart` event to Loki (best-effort; failure does not block restart)      |
| WATCHDOG_LOOPBACK_ONLY   | The published app port binds to `127.0.0.1` only — never `0.0.0.0`                                                |
| WATCHDOG_COUNTER_RESET   | The failure counter resets to 0 on any successful probe OR on restart OR when the lockfile is present             |
| WATCHDOG_SINGLE_INSTALL  | The watchdog is installed only via `deploy.sh`; `bootstrap.yaml` does not contain watchdog files (no duplication) |

### File Pointers

| File                                                  | Purpose                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| `platform/infra/files/scripts/cogni-watchdog.sh`      | Watchdog probe + restart script                     |
| `platform/infra/files/systemd/cogni-watchdog.timer`   | Systemd timer unit (30s interval)                   |
| `platform/infra/files/systemd/cogni-watchdog.service` | Systemd service unit (oneshot)                      |
| `platform/ci/scripts/deploy.sh`                       | Installation, lockfile write/remove                 |
| `platform/infra/services/runtime/docker-compose.yml`  | Port 3000 loopback publish                          |
| `/var/lib/cogni/watchdog-failures`                    | Failure counter statefile (VM runtime, not in repo) |
| `/var/lib/cogni/watchdog-pause`                       | Deploy lockfile (VM runtime, not in repo)           |

## Acceptance Checks

**Automated (CI):**

```bash
# Script is valid bash
bash -n platform/infra/files/scripts/cogni-watchdog.sh

# Port 3000 is published loopback-only in compose
grep -q '127.0.0.1:3000:3000' platform/infra/services/runtime/docker-compose.yml

# Lockfile write exists in deploy script
grep -q 'watchdog-pause' platform/ci/scripts/deploy.sh
```

**Manual (on VM after deploy):**

```bash
# Timer is active and firing
systemctl is-active cogni-watchdog.timer
systemctl list-timers cogni-watchdog.timer

# Probe logs appear in journald
journalctl -u cogni-watchdog.service --since "5 min ago"

# Simulate hang: pause the app container
docker pause cogni-runtime-app-1
# Wait ~2 min, verify restart in journald:
journalctl -u cogni-watchdog.service --since "3 min ago" | grep RESTARTING
# Verify Loki event received (Grafana query):
# {service="watchdog"} |= "watchdog.app_restart"
docker unpause cogni-runtime-app-1  # cleanup if needed

# Deploy lockfile test: write lockfile, verify watchdog skips
touch /var/lib/cogni/watchdog-pause
# Wait 30s, check journald shows "deploy in progress, skipping"
rm /var/lib/cogni/watchdog-pause
```

## Open Questions

- [ ] Should the watchdog also probe `/livez` as a faster liveness check (no dependency chain), falling back to `/readyz` for full readiness?
- [ ] Should the failure threshold be configurable via an env file, or is 4 (hardcoded) sufficient?
- [ ] Should watchdog restart events also push to a Slack/email webhook directly, or is Loki + Grafana alerting sufficient?

## Related

- [observability-requirements](./observability-requirements.md) — HEARTBEAT_LIVENESS invariant this spec implements
- [observability](./observability.md) — structured logging and Loki architecture
- [proj.reliability](../../work/projects/proj.reliability.md) — parent project
- [Postmortem: Feb 7-8 outages](../postmortems/2026-02-07-production-vm-loss.md) — incident that motivated this
