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

### Health Metrics (Primary)

- **cost** - LLM spend in last hour (USD)
- **tokens** - Total tokens consumed (last hour)
- **errors** - LLM error count (last hour)
- **memory** - Container memory pressure (%)
- **alerts** - Active alert rules status
- **incidents** - Open incidents count

### Debugging (Secondary)

- **deployments** - Recent annotations (last 24h)
- **all** - Run all health checks

## Usage Pattern

```bash
# Single check
./queries.sh cost

# Full health scan
./queries.sh all
```

## Output Format

Concise, parseable:

```
LLM Cost (1h): $0.05
Tokens (1h): 12450
Errors (1h): 0
Memory: 45%
Active Alerts: 0
Open Incidents: 0
```

## Design Constraints

- **Readonly only** - Viewer role, no mutations
- **Low context** - Results <500 chars per query
- **High signal** - Metrics over logs
- **Fast** - <2s per query, <10s for all
