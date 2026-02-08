---
work_item_id: ini.reliability
work_item_type: initiative
title: Reliability & Uptime
state: Active
priority: 0
estimate: 3
summary: Maximum cogni uptime — watchdog, external monitoring, OTel fix, backup strategy
outcome: Auto-recovery from hangs within 2 min, external alerting on downtime, no silent outages
assignees: derekg1729
created: 2026-02-08
updated: 2026-02-08
labels: [infra, reliability]
related: [ini.observability-hardening]
---

# Reliability & Uptime

## Goal

Cogni never goes down silently again. If the app hangs, it auto-recovers. If it's down, we know within 60 seconds.

## Context

Feb 7–8, 2026: Two multi-hour outages across production and preview with zero alerting. The app was "healthy but hung" — Docker health checks passed, but the event loop was blocked by OTel `spawnSync` calls to AWS EC2 metadata (169.254.169.254). No watchdog, no external monitor, no alerts. See [postmortem](../../docs/postmortems/2026-02-07-production-vm-loss.md).

## Roadmap

### P0 — Stop the Bleeding

| Deliverable                                                                                                                 | Status      | Est |
| --------------------------------------------------------------------------------------------------------------------------- | ----------- | --- |
| VM watchdog: systemd timer curls `/api/meta/readyz` every 30s, restarts app container after 4 consecutive failures (~2 min) | Not Started | 1   |
| OTel fix: set `OTEL_NODE_RESOURCE_DETECTORS=none` in production env                                                         | Not Started | 1   |
| OTel fix: add `resourceDetectors: []` to `NodeSDK` constructor in `src/instrumentation.ts`                                  | Not Started | 1   |
| External uptime monitor (UptimeRobot/Checkly) on `https://cognidao.org/api/meta/readyz`, alerts to Slack/email              | Not Started | 1   |

### P1 — Don't Lose Data Again

| Deliverable                                                             | Status      | Est |
| ----------------------------------------------------------------------- | ----------- | --- |
| Automated Postgres backups: `pg_dump` to object storage (S3/R2) on cron | Not Started | 2   |
| Grafana alert: app log silence >5 min (dead-man's switch)               | Not Started | 1   |
| Grafana alert: stderr volume spike                                      | Not Started | 1   |
| Session invalidation on DB reset (prevent stale-session FK errors)      | Not Started | 1   |

### P2 — Harden the Platform

| Deliverable                                                               | Status      | Est |
| ------------------------------------------------------------------------- | ----------- | --- |
| Upgrade VM from 2GB shared to 4GB+ dedicated                              | Not Started | 1   |
| Container memory limits (`mem_limit`) on all services                     | Not Started | 1   |
| Deploy-to-healthy gate: poll `/readyz` after deploy, fail CI if unhealthy | Not Started | 1   |

## Related

- [ini.observability-hardening](ini.observability-hardening.md) — metrics, dashboards, structured errors (complements this initiative: observability = seeing problems, reliability = surviving them)
- [Postmortem: Feb 7–8 outages](../../docs/postmortems/2026-02-07-production-vm-loss.md)
