# Required Observability Design

> [!CRITICAL]
> Application logs cannot attribute SIGKILL/OOM. Container-layer signals and process runtime metrics are required to detect and diagnose silent container death.

## Core Invariants

1. **Below-app attribution:** SIGKILL detection must come from infrastructure (cgroup metrics, container exit events), never from application logs.

2. **Pre-crash curve:** Node.js heap/RSS/event-loop metrics must be continuously exported so memory pressure is visible before OOM.

3. **Heartbeat liveness:** Absence of an explicit heartbeat metric timestamp OR failing synthetic probe to `/readyz` for >90s in preview|production must trigger an alert. Log-silence is a separate, lower-severity signal for "logging pipeline degraded" — not app death.

4. **Container restart detection:** Any app container restart or exit (including exit code 137/SIGKILL) in preview|production must alert and correlate to the current deploy SHA.

5. **Deploy-to-healthy gate:** Every deployment must have a verified `deployment.complete` OR `deployment.failed` event. A `deployment.started` without either within 5 minutes is an alert.

---

## Implementation Checklist

### P0: Silent Death Detection

- [ ] Add `collectDefaultMetrics()` to Prometheus registry (`src/shared/observability/server/metrics.ts`) — exposes `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_eventloop_lag_seconds`, `nodejs_gc_duration_seconds`
- [ ] Add explicit heartbeat gauge: `app_heartbeat_timestamp_seconds` updated every 30s via `setInterval` in metrics.ts — this is the primary liveness signal (survives request-quiet periods)
- [ ] Add `mem_limit` and `cpus` to app service in both compose files (not `deploy.resources.limits` which is Swarm-only). Production: `mem_limit: 512m, cpus: "1.0"`. Dev: `mem_limit: 768m`
- [ ] Add container restart/exit-code detection: configure Alloy to scrape Docker container state (restart count, exit code) via `discovery.docker` relabeling, or add `docker events --filter event=die` sidecar that emits structured log with exit code + container name to stdout (Alloy collects it)
- [ ] Fix Dockerfile HEALTHCHECK timeout: 2s → 5s (readyz budgets 3s EVM + 5s Temporal internally)
- [ ] Add Alloy health check in both compose files: `wget -qO- http://localhost:12345/-/ready || exit 1`
- [ ] Add DB connectivity check to `/readyz` — `SELECT 1` with 2s timeout (keep `/livez` dependency-free for container liveness)
- [ ] Create Grafana alert: heartbeat metric absent for >90s (env=~"preview|production") → P1 critical
- [ ] Create Grafana alert: log-silence `count_over_time({service="app"}[5m]) == 0` → P2 warning ("logging degraded")
- [ ] Create Grafana alert: `deployment.started` without `deployment.complete` or `deployment.failed` within 5 minutes → P1 alert

#### Chores

- [ ] Update OBSERVABILITY.md with new metrics, resource limits, and alert rules
- [ ] Update AGENTS.md pointers if new docs created

### P1: Container-Layer Metrics + Dashboard

- [ ] Validate cAdvisor feasibility: does the Akash/Spheron runtime expose cgroups to sidecar containers? If not, fall back to Docker API polling sidecar
- [ ] Add cAdvisor or cgroup-exporter sidecar to compose stacks — exports `container_memory_usage_bytes`, `container_memory_max_usage_bytes`, `container_oom_kills_total`, `container_cpu_usage_seconds_total`
- [ ] Add Alloy `prometheus.scrape` target for cAdvisor/exporter (scrape interval 10s)
- [ ] Create Grafana dashboard: app memory (RSS + heap + cgroup limit), request rate, error rate, latency p95, deploy markers
- [ ] Add post-rollout canary probe to `deploy.sh`: poll `/readyz` every 10s for 3 minutes after `deployment.stack_up_complete`, emit `deployment.canary_passed` or `deployment.canary_failed`
- [ ] Create Grafana alert: `container_memory_usage_bytes / container_spec_memory_limit_bytes > 0.85` → P2 warning

### P2: Full Trace Pipeline (Future)

- [ ] Wire OTel OTLP exporter to Grafana Tempo (SDK already initialized, exporter stub exists)
- [ ] Add distributed tracing: app → scheduler-worker → DB spans
- [ ] Client-side log shipping (browser errors to Loki)
- [ ] **Do NOT build this preemptively** — evaluate after P0/P1 stabilize

---

## File Pointers (P0 Scope)

| File                                                     | Change                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/shared/observability/server/metrics.ts`             | Add `collectDefaultMetrics({ register })` + `app_heartbeat_timestamp_seconds` gauge with 30s interval |
| `platform/infra/services/runtime/docker-compose.yml`     | Add `mem_limit`/`cpus` to app; add Alloy health check; add restart/exit-code detection                |
| `platform/infra/services/runtime/docker-compose.dev.yml` | Add `mem_limit`/`cpus` to app; add Alloy health check                                                 |
| `Dockerfile`                                             | Change HEALTHCHECK timeout from 2s to 5s                                                              |
| `src/app/(infra)/readyz/route.ts`                        | Add DB `SELECT 1` connectivity check with 2s timeout                                                  |
| Grafana (via MCP or UI)                                  | Three alert rules: heartbeat-absent (P1), log-silence (P2), deploy-incomplete (P1)                    |

---

## Design Decisions

### 1. Why `collectDefaultMetrics()` + Heartbeat First (Not cAdvisor)

| Option                                          | Detects OOM?           | Pre-crash curve?        | Detects app death?    | Effort                 |
| ----------------------------------------------- | ---------------------- | ----------------------- | --------------------- | ---------------------- |
| **`collectDefaultMetrics()` + heartbeat gauge** | No                     | Yes (heap/RSS/GC trend) | Yes (heartbeat stops) | ~10 lines              |
| **cAdvisor sidecar**                            | Yes (oom_kill counter) | Yes (cgroup memory)     | Yes (container gone)  | New container + config |
| **Platform-native (Akash/Spheron)**             | Yes (authoritative)    | Depends on API          | Yes                   | Unknown availability   |

**Rule:** P0 ships the heartbeat + process metrics for death detection and pre-crash visibility. P1 adds cAdvisor for OOM attribution and cgroup-level memory tracking. Platform-native is ideal but blocked on Spheron API investigation.

### 2. Alert Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEARTBEAT ABSENT (Prometheus, P0)                                   │
│ ─────────────────────────────────                                   │
│ 1. Alert on: app_heartbeat_timestamp_seconds absent for >90s        │
│ 2. Fires for env=~"preview|production" only                         │
│ 3. Result: P1 critical (app is dead or metrics pipeline broken)     │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ LOG SILENCE (Loki, P0 — separate concern)                           │
│ ────────────────────────────────────────                             │
│ 1. Alert on: count_over_time({service="app"}[5m]) == 0              │
│ 2. Result: P2 warning (logging pipeline degraded, NOT app death)    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (P1: container metrics available)
┌─────────────────────────────────────────────────────────────────────┐
│ MEMORY PRESSURE (Prometheus, P1)                                    │
│ ───────────────────────────                                         │
│ - cgroup_usage / cgroup_limit > 0.85 → warning                     │
│ - container_oom_kills_total increase → critical                     │
│ - Correlate with deploy SHA from deployment events                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DEPLOY CANARY (deploy.sh, P1, never blocking rollout)               │
│ ─────────────────────────                                           │
│ - Poll /readyz for 3 min post-deploy                                │
│ - Emit deployment.canary_passed or deployment.canary_failed         │
│ - Alert on canary_failed                                            │
│ - Canary failure does NOT auto-rollback (manual decision)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Why layered?** Each layer catches what the one above cannot. Heartbeat detects death but not cause. Container metrics attribute OOM but need a sidecar. Deploy canary catches post-deploy failures but not gradual leaks.

### 3. Resource Limits

512Mi for app is based on: Next.js 16 base (~150MB) + OTel SDK (~30MB) + DI container + request overhead. The app died ~2min after boot — consistent with memory climbing past an implicit provider limit.

Compose `deploy.resources.limits` requires Swarm mode and is silently ignored by `docker compose up`. Use `mem_limit` and `cpus` (compose v2 syntax) for actual enforcement, or pass `--compatibility` flag in `deploy.sh`.

P0 sets limits AND adds restart/exit-code detection in the same phase — so when the limit triggers an OOM kill, we see the exit code 137 immediately rather than discovering it 30 minutes later via scheduler-worker timeout.

### 4. Health Check Layering

| Endpoint  | Purpose                                 | Dependencies                        | Used by                                |
| --------- | --------------------------------------- | ----------------------------------- | -------------------------------------- |
| `/livez`  | Container liveness (process alive?)     | None                                | Docker HEALTHCHECK, K8s liveness probe |
| `/readyz` | Traffic readiness (can serve requests?) | Env, secrets, EVM RPC, Temporal, DB | K8s readiness probe, deploy canary     |

**Rule:** `/livez` must never import `serverEnv()` or check external services. `/readyz` validates the full dependency chain. DB check added to `/readyz` only.

---

### 5. What We Learned From the Incident

**2026-02-04 09:22–09:28 UTC — preview app silent death:**

- Deploy started at 09:22:50, app booted at 09:23:23, served traffic 09:25–09:28, then zero logs
- `deploy.sh` emits `deployment.complete` but we only saw `deployment.started` — either the script failed mid-run or Loki push was silently dropped
- scheduler-worker detected the outage 30 min later via `HeadersTimeoutError` (not a designed detection path)
- Caddy returned 502 to all users with no alert

**Non-goal:** Relying on app logs for SIGKILL detection (impossible by design — kernel terminates process instantly).

---

**Last Updated**: 2026-02-04
**Status**: Draft
