---
description: "Query Grafana for system health metrics and alerts"
user-invocable: false
---

# Grafana Health Check

Readonly health monitoring for governance agents. Queries production metrics and alerts.

## Goal

Provide governance agents with high-signal system health data:

- LLM cost and token consumption
- Error rates and alert status
- Container health and resource pressure
- Recent deployment annotations

## Prerequisites

**Required environment variables** (must be set in OpenClaw container):

- `GRAFANA_URL` - Grafana Cloud instance URL
- `GRAFANA_SERVICE_ACCOUNT_TOKEN` - Readonly service account token (Viewer role)

If not set, run `/env-update` to propagate from .env.local to OpenClaw gateway.

## Available Commands

Run `./queries.sh <command>` from this directory:

### Service Overview

- **services** - List all running services
- **health** - Per-service health dashboard (memory, CPU, OOMs)
- **all** - Full health report (services + metrics + alerts)

### Aggregate Metrics

- **cost** - LLM spend in last hour (USD)
- **tokens** - Total tokens consumed (last hour)
- **errors** - LLM error count (last hour)
- **breakdown** - Cost/tokens by provider

### Alerts & Incidents

- **alerts** - Active alert rules status
- **incidents** - Open incidents count
- **deployments** - Recent annotations (last 24h)

### Legacy (Single Metrics)

- **memory** - Aggregate container memory pressure (%)

## Usage Pattern

```bash
# Single check
./queries.sh cost

# Full health scan
./queries.sh all
```

## Output Format

Concise per-service dashboard:

```
=== Services ===
  ✓ app
  ✓ scheduler-worker
  ✓ openclaw-gateway
  ...

=== Per-Service Health ===
app:
  Memory: 45%  CPU: 12%  OOMs: 0
scheduler-worker:
  Memory: 23%  CPU: 5%  OOMs: 0
...

=== Aggregate Metrics ===
LLM Cost (1h): $0.05
Tokens (1h): 12450
Errors (1h): 0

=== Cost Breakdown ===
  OpenRouter: $0.045

Tokens by Provider:
  OpenRouter: 11200 tokens

Note: Postgres internals, Temporal workflows, and network stats not included (future)
Note: Alerts & incidents not configured yet
```

## Design Constraints

- **Readonly only** - Viewer role, no mutations
- **Low context** - Results <500 chars per query
- **High signal** - Metrics over logs
- **Fast** - <2s per query, <10s for all
