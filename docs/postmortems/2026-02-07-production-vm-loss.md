---
id: pm-2026-02-07-production-vm-loss
type: postmortem
title: "Production VM Loss, OTel Hang, & Multi-Environment Outages"
status: draft
trust: draft
summary: CherryServers silently replaced production VM (data loss); OTel spawnSync blocks event loop (app hang); preview crashed silently; billing FK bug blocks all users
read_when: Investigating hosting reliability, backup strategy, disaster recovery, or OTel configuration
owner: derekg1729
created: 2026-02-07
updated: 2026-02-08
---

# Postmortem: Production VM Loss, OTel Hang, & Multi-Environment Outages

> **WE DO NOT TRUST CHERRYSERVERS. WE NEED TO BACK UP OUR DATA.**

**Date**: 2026-02-07 through 2026-02-08
**Severity**: Critical (full production outage, total data loss, then recurring hangs)
**Status**: Active — VM reprovisioned, app hangs on page requests, billing broken
**Duration**: Ongoing (first detected ~08:20 UTC Feb 7)

---

## Summary

Production went down. CherryServers silently replaced our VM without notification. All data on disk was lost (Postgres, Temporal, configs). No operator action triggered this.

### What happened

1. The app entered a crash loop (SIGTERM flood on stderr, cause TBD)
2. CherryServers replaced the VM behind the same server ID — new IP, SSH keys wiped, disk wiped
3. `tofu plan` showed **no drift** — the provider API lied about the server's state
4. During recovery, tofu recreated the server and recycled the **original IP** (`84.32.9.16`), after we had already changed DNS to the intermediate ghost IP (`84.32.83.38`)

### What we lost

- **All Postgres data** (app DB: accounts, billing, usage history)
- **All Temporal data** (workflow history, schedule state)
- **SSH access** (keys wiped, had to reprovision)
- **~2 hours** of incident response chasing a provider that hides failures

### What survived

- Grafana Cloud logs/metrics (external)
- Docker images in GHCR (external)
- GitHub secrets (external, but `VM_HOST` needed updating)
- Source code (GitHub)

### Confirmed

- The app **was working earlier today** — operator had cognidao.org/schedules open in a browser tab (Temporal UI, served through the app). The page was live.
- On revisit after DNS changes, the tab showed `ERR_SSL_PROTOCOL_ERROR` (expected — Caddy on the new VM hasn't obtained a TLS cert yet)
- **CherryServers swapped our VM without any logs, alerts, or API-visible state change.** The cause is unknown. No operator action triggered it.

### Root issue

Single VM with no external backups, on a provider that silently rebuilds servers. 2GB shared plan running 6+ containers.

---

## Timeline (UTC, 2026-02-07)

| Time (approx)      | Event                                                                                                            | Source                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Feb 6, 10:55       | Last successful `Deploy (Production)` CI run (run ID: 21748050550)                                               | GitHub Actions                    |
| Feb 6, 11:43       | Loki deployment event: `deployment.started`, image `ghcr.io/cogni-dao/node-template:prod-8473...`                | Grafana Loki                      |
| Feb 6, ~11:00      | VM allegedly started (CherryServers shows ~22h uptime as of ~09:00 Feb 7)                                        | CherryServers dashboard           |
| Feb 7, 07:43-07:44 | App healthy: `meta.readyz` + `meta.metrics` returning 200, structured JSON logs on stdout                        | Loki (service=app, stream=stdout) |
| Feb 7, 07:44-07:47 | stderr: BIP39 mnemonic fragments + Next.js `__NEXT_PRIVATE_STANDALONE_CONFIG` dumps + SIGTERM on pid 50820       | Loki (service=app, stream=stderr) |
| Feb 7, 08:04-08:10 | `scheduler-worker` activity `executeGraphActivity` hangs 5 min, fails with `UND_ERR_HEADERS_TIMEOUT` (300,764ms) | Loki (service=scheduler-worker)   |
| Feb 7, 08:16-08:17 | Massive SIGTERM flood — dozens of `signal: 'SIGTERM', status: null, pid: 50820` entries                          | Loki (service=app, stream=stderr) |
| Feb 7, ~08:20+     | `curl https://cognidao.org` returns **502** (TCP connects in 32ms, proxy up, backend dead)                       | Manual curl                       |
| Feb 7, ~08:30      | SSH to VM fails — **different IP**, prompting for password, key rejected                                         | Manual SSH                        |

---

## Symptoms

### 1. HTTP 502 (confirmed)

```
$ curl -s -o /dev/null -w "%{http_code}" https://cognidao.org
502

$ curl -s -m 10 -w "HTTP_CODE: %{http_code}\nTIME_TOTAL: %{time_total}s\nTIME_CONNECT: %{time_connect}s" https://cognidao.org
HTTP_CODE: 502
TIME_TOTAL: 3.669887s
TIME_CONNECT: 0.032409s
```

All endpoints 502: `/`, `/api/health`, `/api/meta/readyz`

Caddy (edge proxy) is reachable (fast TCP connect) but cannot reach the app backend.

### 2. SIGTERM Crash Loop (pre-outage)

App stderr showed repeated child process kills:

```
status: null,
signal: 'SIGTERM',
pid: 50820,
output: [ null, <Buffer>, <Buffer> ],
digest: '3159934052'
```

This is a Node.js `execSync`/`spawnSync` result object — a subprocess was being repeatedly SIGTERM'd.

### 3. BIP39 Mnemonic on stderr

Fragments like `BrokenBronzeBroomBrotherBrownBrushBubbleBuddy` appeared on stderr interleaved with Next.js config dumps. Appears to be from crypto/wallet initialization during app startup cycles.

### 4. Scheduler Worker Timeout

```
error: TypeError: fetch failed
  code: 'UND_ERR_HEADERS_TIMEOUT'
  durationMs: 300764
  at async executeGraphActivity (...)
```

The Temporal activity tried to reach `http://app:3000` for a graph execution and timed out after 5 minutes.

### 5. VM Identity Changed

- SSH key (`~/.ssh/cogni_template_production_deploy`) no longer accepted
- VM IP changed from what was last deployed to
- Server now prompts for password
- CherryServers dashboard shows a VM, but it appears to be a fresh instance

---

## Services Status (at time of investigation)

| Service              | Status             | Evidence                                             |
| -------------------- | ------------------ | ---------------------------------------------------- |
| **Caddy (edge)**     | Up (TCP reachable) | 502 = proxy up, backend unreachable                  |
| **App (Next.js)**    | Dead               | No structured logs after 07:44, 502 on all endpoints |
| **LiteLLM**          | Was healthy        | Last log: `GET /health/readiness 200 OK` at 08:17    |
| **Temporal**         | Was healthy        | Normal task queue lifecycle logs                     |
| **Scheduler Worker** | Degraded           | `UND_ERR_HEADERS_TIMEOUT` on graph activity          |
| **Postgres**         | Unknown            | No direct evidence of failure                        |
| **VM itself**        | Replaced?          | SSH key rejected, new IP, password prompt            |

---

## Grafana Loki Queries Used

```logql
# App errors (returned empty — no level=error in structured logs)
{app="cogni-template", env="production", service="app"} | json | level="error"

# App stderr (SIGTERM flood, mnemonic leak, Next.js config dumps)
{app="cogni-template", env="production", service="app", stream="stderr"}

# App structured logs (last healthy: 07:44 UTC)
{app="cogni-template", env="production", service="app", stream="stdout"}

# Crash keywords
{app="cogni-template", env="production"} |~ "(?i)(crash|killed|oom|exit|restart|unhealthy|fatal)"

# Deployment events (only 1 in last 24h)
{app="cogni-template", env="production", service="deployment"}

# Scheduler worker errors
{app="cogni-template", env="production", service="scheduler-worker"}
```

---

## CI Deploy History

| Date             | Run ID      | Status      | Notes                   |
| ---------------- | ----------- | ----------- | ----------------------- |
| 2026-02-06 10:55 | 21748050550 | Success     | Last production deploy  |
| 2026-02-04 12:16 | 21671107032 | **Failure** | Previous failed attempt |
| 2026-02-03 16:24 | 21638274956 | Success     |                         |
| 2026-02-02 14:56 | 21594989431 | Success     |                         |

Deploy workflow: `deploy-production.yml` → triggers on `Build & Test Production` success on `main`.

Deploy target: `secrets.VM_HOST` (masked in CI logs as `***`). VM hostname logged as `production-cogni-template`.

---

## Hypotheses (ranked)

### H1: CherryServers VM was rebuilt/replaced (HIGH)

- VM uptime (~22h) aligns with deploy time (~21h ago) but SSH keys are gone
- CherryServers may have auto-rebuilt the VM (maintenance, billing, disk failure)
- This would explain: new IP, password auth, all Docker state lost
- **Action**: Check CherryServers dashboard for rebuild/maintenance events

### H2: App crash loop exhausted resources → VM became unresponsive (MEDIUM)

- The SIGTERM flood and repeated subprocess kills suggest a crash loop
- Could have filled disk with stderr output or exhausted memory
- CherryServers may have force-rebooted or replaced the VM
- **Action**: If SSH access recovered, check `/var/log/` and `dmesg` for OOM killer

### H3: Cloud-init re-ran and wiped SSH authorized_keys (LOW)

- If the VM rebooted (not rebuilt), cloud-init might have reset SSH config
- Would explain password prompt but not the IP change
- **Action**: Check cloud-init logs if SSH access is recovered

---

## Infrastructure Facts (from tfstate + tfvars)

| Field                            | Value                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| Server ID (old)                  | `811287`                                                                 |
| Old IP (tfstate)                 | `84.32.9.16`                                                             |
| New IP (CherryServers dashboard) | `84.32.83.38`                                                            |
| SSH key ID                       | `13247` (fingerprint: `4b:10:bc:3d:68:13:9b:b2:be:c2:85:c4:f1:69:c7:2b`) |
| SSH key created                  | `2026-02-06T13:34:24+02:00`                                              |
| Plan                             | `B1-2-2gb-40s-shared` (**2GB RAM, 40GB SSD, shared CPU**)                |
| Region                           | `LT-Siauliai`                                                            |
| Project ID                       | `254821`                                                                 |
| Image                            | `ubuntu_22_04`                                                           |
| Hostname                         | `production-cogni-template`                                              |

**The IP changed from `84.32.9.16` → `84.32.83.38`** — this is a different physical server. CherryServers replaced the VM without operator action.

---

## Root Cause Investigation

### What we know for certain

1. **No CI deploy was triggered** — the last `Deploy (Production)` run was 21h before the outage (`2026-02-06T10:55 UTC`), and it succeeded.
2. **No manual action** — the sole operator (Derek) did not trigger a rebuild, redeploy, or any CherryServers API call.
3. **The VM was replaced, not rebooted** — different IP, SSH keys wiped, password auth enabled. This is a full server rebuild, not a restart.
4. **The app was in a crash loop before the outage** — SIGTERM flood on stderr, subprocess pid 50820 being repeatedly killed, BIP39 mnemonic fragments dumped to stderr.
5. **2GB RAM shared plan** — extremely tight. The crash loop (repeated Next.js startup + subprocess spawning) could easily OOM a 2GB box.

### Confirmed: CherryServers silently replaced VM in-place

**Proof**: `tofu plan` against the production workspace returned **"No changes. Your infrastructure matches the configuration."** — meaning the CherryServers API still reports server ID `811287` as active and matching spec. However:

- The IP changed from `84.32.9.16` → `84.32.83.38`
- SSH key auth is rejected (password prompt instead)
- The VM uptime (~22h) does not match the server's original creation date

**Conclusion**: CherryServers replaced the underlying host behind the same server ID without notifying the operator. The Terraform/OpenTofu state was not invalidated because the API-level resource still "exists." This is a **silent infrastructure replacement** — the provider swapped the physical machine while keeping the logical resource intact.

This means:

- `tofu plan` cannot detect this failure mode (no drift visible)
- The operator has no API-level signal that the VM was rebuilt
- All local disk state (Docker volumes, configs, .env files) was wiped
- SSH authorized_keys were reset to provider defaults (password auth)

### Recovery: IP recycling during reprovisioning

When we ran `tofu taint` + `tofu apply` to destroy server `811287` and create a fresh one, the new VM was assigned `84.32.9.16` — **the exact same IP as the original pre-incident VM**.

Meanwhile, during the outage, the CherryServers dashboard had shown the server at `84.32.83.38` (different IP, password auth, SSH key rejected). DNS was manually updated to `84.32.83.38` in an attempt to restore service. After tofu reprovisioned back to `84.32.9.16`, DNS had to be reverted.

| Phase                        | IP            | What happened                                                      |
| ---------------------------- | ------------- | ------------------------------------------------------------------ |
| Pre-incident (working)       | `84.32.9.16`  | Original VM, app healthy                                           |
| During outage                | `84.32.83.38` | Cherry dashboard showed this IP; SSH key rejected, password prompt |
| DNS changed                  | `84.32.83.38` | Operator updated DNS hoping to restore                             |
| After `tofu taint` + `apply` | `84.32.9.16`  | New VM got the **original IP back**; DNS had to be reverted        |

CherryServers had two different IPs associated with the same server ID (`811287`) at different points. The intermediate IP (`84.32.83.38`) had Caddy running (from cloud-init bootstrap artifacts) but no app stack — confirming Cherry had silently rebuilt the VM at that IP before we intervened. After tofu destroyed and recreated, Cherry recycled the original IP.

### Leading hypothesis: OOM → CherryServers auto-rebuild

Sequence:

1. App subprocess enters crash loop (cause TBD — possibly crypto/wallet init failure)
2. Each crash cycle spawns a new Next.js process + child processes, dumping `__NEXT_PRIVATE_STANDALONE_CONFIG` and mnemonic wordlists to stderr
3. Memory exhaustion on 2GB shared VM → Linux OOM killer fires
4. Docker `restart: always` keeps restarting the app, compounding the OOM pressure
5. CherryServers detects the shared VM is unresponsive/thrashing and **auto-rebuilds it** on a new physical host (new IP)
6. Rebuild wipes disk → all Docker volumes (`postgres_data`, `temporal_postgres_data`, `alloy_data`, `repo_data`) are **lost**
7. The rebuilt VM has a fresh OS with default password auth, no SSH keys, no Docker, no app

### What needs investigation

| Question                                  | How to investigate                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Did CherryServers auto-rebuild?           | Check CherryServers **Activity logs** in dashboard, or contact support                                                                                                 |
| What triggered the crash loop?            | Inspect the Docker image for the deployed commit (`prod-84737771c460a1f72006342297d28f3d3b7bd381`). Look at startup code, crypto/wallet init, what spawns subprocesses |
| What is `BrokenBronzeBroom...`?           | Search codebase for BIP39 wordlist usage — is this a test seed, a real mnemonic, or a library default?                                                                 |
| What was pid 50820?                       | Likely a Node.js child_process from `execSync`/`spawnSync` — check for any startup scripts that shell out                                                              |
| What does `digest: '3159934052'` mean?    | This is in the spawnSync result object — may be a CRC or content hash of the subprocess output                                                                         |
| Is CherryServers API key rotation broken? | All 3 API keys share the same JWT prefix (`eyJhbGciOiJSUzI1NilsInR5cCI6IkpXUyJ9`) — report to Cherry support                                                           |

---

## Data Loss Assessment

| Volume                     | Status   | Impact                                                                |
| -------------------------- | -------- | --------------------------------------------------------------------- |
| `postgres_data` (app DB)   | **LOST** | User accounts, billing, AI usage history, all app state               |
| `temporal_postgres_data`   | **LOST** | Workflow history, schedule state                                      |
| `alloy_data`               | **LOST** | Metrics WAL (metrics already forwarded to Grafana Cloud — low impact) |
| `repo_data`                | **LOST** | Git clone of cogni repo (easily re-cloned — no impact)                |
| Grafana Cloud logs/metrics | **SAFE** | External service, not on VM                                           |
| GHCR Docker images         | **SAFE** | External registry, not on VM                                          |
| GitHub secrets             | **SAFE** | But `VM_HOST` needs updating to new IP                                |

---

## Recovery Steps (in progress)

1. [x] Document incident (this postmortem)
2. [ ] Wipe old server via `tofu taint` + `tofu apply` (operator decision: old VM is unrecoverable)
3. [ ] Update GitHub secret `VM_HOST` with new IP from `tofu output`
4. [ ] Run `Deploy (Production)` to rebuild full stack on fresh VM
5. [ ] Verify app comes up healthy at new IP
6. [ ] Update DNS if IP changed (check if cognidao.org points to old `84.32.9.16`)
7. [ ] Run DB migrations (empty DB — fresh start)
8. [ ] Assess what user-facing data can be reconstructed

---

## Required Follow-ups

### P0: Prevent VM loss from causing data loss

- [ ] **External database**: Move Postgres to managed service (CherryServers doesn't offer this — consider Supabase, Neon, or RDS)
- [ ] **Automated backups**: If staying on self-hosted Postgres, implement `pg_dump` to object storage (S3/R2) on a cron
- [ ] **Persistent block storage**: CherryServers offers detachable block storage — attach `postgres_data` to a volume that survives VM rebuilds

### P1: Prevent undetected crash loops

- [ ] **Alert on container restart count**: Alloy/Prometheus alert when a container restarts >3 times in 10 minutes
- [ ] **Alert on stderr flood**: Loki alert rule when `{stream="stderr"}` volume exceeds threshold
- [ ] **Alert on health check failures**: External uptime monitor (UptimeRobot, Checkly) pinging `/readyz` every 60s

### P1: Prevent silent VM replacement

- [ ] **CherryServers monitoring**: API polling for server state changes, or webhook if available
- [ ] **Tofu drift detection**: Scheduled CI job running `tofu plan` to detect infrastructure drift
- [ ] **SSH canary**: CI job that SSHes to production and checks hostname/IP matches expected values

### P2: Harden the VM plan

- [ ] **Upgrade from 2GB shared** — 2GB is insufficient for Next.js + LiteLLM + Postgres + Temporal + Alloy + SourceCred. Consider 4GB+ dedicated
- [ ] **Swap is not enough** — bootstrap.yaml creates 2GB swap, but OOM killer may fire before swap is fully utilized on shared instances

### P2: Investigate the mnemonic leak

- [ ] Determine if `BrokenBronzeBroomBrotherBrownBrushBubbleBuddy` is a real secret or test data
- [ ] If real: rotate immediately, audit what it protects
- [ ] Either way: fix the code path that dumps it to stderr

---

## Feb 8 Continuation: Three More Issues Found

After the VM was reprovisioned and redeployed, three additional issues were discovered on Feb 8. The `spawnSync` SIGTERM flood from Feb 7 and the `spawnSync` ETIMEDOUT from Feb 8 are the **same root cause** — OTel resource detectors shelling out during startup/render.

### Issue A: OTel `spawnSync` Blocks Event Loop (PRODUCTION DOWN)

**Status**: Active — cognidao.org hangs on all page requests as of Feb 8 ~10:50 UTC
**Severity**: P0 — site completely unresponsive to browsers

#### What's happening

1. `curl https://cognidao.org/` — TLS succeeds, HTTP/2 request sent, **0 bytes received**, hangs until timeout
2. Health checks (`meta.readyz`, `meta.metrics`) still return 200 — backend is alive
3. LiteLLM readiness checks pass every 10s
4. App stderr shows repeated `spawnSync /bin/sh ETIMEDOUT` errors

#### Root cause

`@opentelemetry/sdk-node` (v0.208.0) default resource detectors — when `resourceDetectors` is not explicitly set and `OTEL_NODE_RESOURCE_DETECTORS` env var is absent, the SDK defaults to `'all'`, which includes `hostDetector`, `osDetector`, `processDetector`, and `envDetector`. In the production Docker image's bundled code, these detectors shell out synchronously:

```
spawnSync /bin/sh -c "curl -s -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token"
```

This probes the **AWS EC2 Instance Metadata Service (IMDSv2)** to detect if the process is running on EC2. On non-AWS hosts (CherryServers), the request times out after several seconds. Because it uses `spawnSync` (synchronous), it **blocks the entire Node.js event loop** during the timeout.

The detectors run not just at startup but appear to fire during SSR page renders, causing every page request to hang for the full timeout duration and return 0 bytes.

**Connection to Feb 7**: The `spawnSync /bin/sh` SIGTERM errors on Feb 7 stderr were the same detectors timing out and being killed. The subprocess `pid: 50820` was this curl call. The crash loop was: startup → OTel detectors block event loop → Docker health check fails → container restart → repeat. On a 2GB VM, this cycle exhausted memory and likely triggered the CherryServers VM replacement.

#### Evidence

```
# First occurrence (Feb 7)
{service="app", env="production", stream="stderr"} |~ "spawnSync"
→ 2026-02-07T07:47:59Z: "spawnSync /bin/sh ETIMEDOUT"

# Feb 8 (ongoing)
→ 2026-02-08T10:52:43Z: 5+ spawnSync ETIMEDOUT errors in same millisecond
→ Each includes: curl to 169.254.169.254, errno: -110 (ETIMEDOUT)

# App responding to health checks but not page requests
→ meta.readyz: 200 OK (116-278ms)
→ GET /: 0 bytes, hangs until 15s timeout
```

#### Fix

Two changes needed:

**1. Set env var `OTEL_NODE_RESOURCE_DETECTORS=none`** in the production Docker Compose / deployment config. This is the fastest fix — no code change, no rebuild needed. The env var tells the SDK to skip all resource detectors. We don't use OTel resource attributes for anything (P0 config is trace-ID-only, no exporter).

**2. Add `resourceDetectors: []` to `src/instrumentation.ts`** as a code-level defense so we don't depend on the env var:

```typescript
sdk = new NodeSDK({
  instrumentations: [],
  resourceDetectors: [], // Prevent spawnSync to EC2 metadata
});
```

Both changes are needed: env var for immediate production fix without redeploy, code change to prevent regression.

---

### Issue B: Preview Silently Down for 5 Hours (Feb 8)

**Status**: Resolved (app recovered after deploy at ~06:04 UTC)
**Severity**: P1 — 5 hours of unnoticed downtime, no alerts

#### Timeline (UTC, Feb 8)

| Time          | Event                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| ~01:00        | App goes down silently — no crash logs, no OOM messages, no app logs at all                                 |
| 01:00 – 05:59 | scheduler-worker fires every 15 min, every run fails: `ConnectTimeoutError` to app:3000 (2,774 log entries) |
| ~06:01        | App comes back, processes backlogged graph execution (idempotency key from Feb 7 17:30)                     |
| ~06:04        | Deployment completes                                                                                        |
| 06:15         | Scheduler run: "Graph execution completed with error"                                                       |
| ~06:33        | Deployment FAILED — exit code 255                                                                           |
| 06:45         | Scheduler run: error again                                                                                  |
| 07:00         | Scheduler run: success                                                                                      |

#### Key errors

1. **`ConnectTimeoutError: Connect Timeout Error (attempted address: app:3000, timeout: 10000ms)`** — scheduler-worker couldn't TCP-connect to the app for 5 hours straight
2. **`spawnSync /bin/sh ENOBUFS`** — when the app came back at ~06:00, it hit buffer overflow errors, suggesting severe resource pressure (same `spawnSync` pattern as production)
3. **Deployment failed (exit code 255)** — the 06:33 deploy failed, though the 06:04 deploy recovered the app

#### What's unclear

Why the app went down at ~01:00 UTC. No crash logs, no OOM messages. The `ENOBUFS` errors on restart suggest resource exhaustion from the same OTel `spawnSync` pattern. Possible OOM kill by container runtime (invisible to app logs).

#### Sandbox error (unrelated)

```
SandboxGraphProvider: ENOENT: connect /var/run/docker.sock
```

Preview doesn't have Docker — sandbox features can't run there. Needs a graceful fallback.

---

### Issue C: Billing FK Violation Blocks All Chat (Both Environments)

**Status**: Active — every authenticated request returns 500
**Severity**: P0 — no user can chat

#### What's happening

On both production and preview, every `POST /ai.chat` and `GET /payments.credits_summary` request fails:

```
insert into "billing_accounts" ("id", "owner_user_id", "balance_credits", "created_at")
values ($1, $2, $3, default)
→ violates foreign key constraint "billing_accounts_owner_user_id_users_id_fk"
```

The `getOrCreateBillingAccountForUser()` method (`src/adapters/server/accounts/drizzle.adapter.ts:226`) tries to INSERT a billing account, but the FK constraint requires `owner_user_id` to exist in the `users` table. After the DB was wiped and recreated (Feb 7 VM loss), users authenticate via SIWE and get a session, but if their session was issued before the DB wipe, the userId in their session doesn't exist in the new `users` table.

#### Affected users

| Environment | User ID                                | Errors | Time range         |
| ----------- | -------------------------------------- | ------ | ------------------ |
| Production  | `49acbd1b-0f2e-4ee3-a45f-0b79e32ca45d` | 16     | Feb 8, 09:41-09:42 |
| Preview     | `5c8f75f0-0e59-4858-b125-52d6b9b9cde3` | 6      | Feb 7, 07:09-07:10 |

#### Fix

**Immediate**: Clear cookies / invalidate sessions so users re-authenticate. The SIWE `authorize()` callback in `src/auth.ts:127` will create the user row, then billing account creation succeeds.

**Proper**: The `getOrCreateBillingAccountForUser()` should verify the user exists before INSERT, or catch the FK violation and return a user-friendly error ("please re-authenticate") instead of a raw 500.

---

### Issue D: Recurring Poet Graph Stream Aborts (Preview)

**Status**: Active — recurring every 15-60 min
**Severity**: P1 — scheduled graph execution failing silently

```
LlmError: LiteLLM stream aborted
  kind: "aborted"
  component: InProcCompletionUnitAdapter
  graph: "poet"
```

Seven occurrences between Feb 7 14:30 and Feb 8 06:45 UTC. The `poet` graph's completion stream is being cut off. Likely a timeout or upstream provider issue.

---

## Updated Hypothesis: The Full Chain

The Feb 7 and Feb 8 incidents are **the same root cause** at different severities:

1. **OTel `spawnSync` detectors** run on startup AND during SSR renders
2. On Feb 7 (production, 2GB VM): repeated timeouts → event loop blocked → Docker health check fails → `restart: always` → crash loop → OOM → CherryServers replaces VM → data loss
3. On Feb 8 (preview): same pattern → app goes down at 01:00 → no crash logs (OOM kill) → 5 hours downtime → recovers after deploy
4. On Feb 8 (production, after recovery): app deploys to fresh VM → OTel detectors block page renders → site "doesn't exist" from browser perspective → health checks still pass (lightweight, no SSR)
5. The billing FK bug is a **consequence** of the data loss — users have sessions but no DB rows

**Fix priority**:

1. **VM watchdog** — the app can be "healthy but hung" (readyz passes, pages don't render). We have ZERO external observability on the VM. No alerting, no auto-restart, no way to know the site is down until a human tries it. A systemd watchdog timer curling `/api/meta/readyz` with a 2s timeout, restarting the app container after 4 consecutive failures (~2 min), would have auto-recovered both the Feb 7 crash loop and the Feb 8 hang without human intervention.
2. `OTEL_NODE_RESOURCE_DETECTORS=none` in production env (immediate, no rebuild)
3. `resourceDetectors: []` in `src/instrumentation.ts` (code fix, requires deploy)
4. Session invalidation or graceful billing FK handling

---

## Critical Gap: No External Observability on VM

**We are blind.** The VM has no mechanism to detect or recover from application failures:

- **No watchdog**: App can hang indefinitely while Docker thinks it's healthy
- **No external uptime monitor**: Nobody knows the site is down until a human visits it
- **No alerting**: Grafana Cloud has the logs but no alert rules configured
- **No auto-restart for hangs**: Docker `restart: always` only helps if the process exits — it does nothing when the process is alive but the event loop is blocked
- **Preview crashed for 5 hours** on Feb 8 with zero notification

### What's needed (in priority order)

1. **Systemd watchdog timer on the VM** — curl `localhost:3000/api/meta/readyz` every 30s with a 2s timeout. After 4 consecutive failures (~2 min), `docker compose restart app`. This converts "hung but still running" into an automatic restart within ~2 minutes. This is the single change that would have prevented both the Feb 7 crash loop (by restarting before OOM) and the Feb 8 hang (by restarting when pages stop rendering).

2. **External uptime monitor** (UptimeRobot, Checkly, or similar) pinging `https://cognidao.org/api/meta/readyz` every 60s from outside. Alerts to Slack/email when it fails. The VM watchdog handles auto-recovery; this handles notification.

3. **Grafana Cloud alert rules** on Loki — trigger when `{stream="stderr"}` volume spikes or when `{service="app"}` logs stop arriving (dead-man's switch).
