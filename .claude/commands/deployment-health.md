# Deployment Health Check

Readonly health monitoring via Grafana metrics and alerts. Use this to check system health, LLM costs, and service status.

**⚠️ v0 MVP:** Data may not be complete or trustworthy. Use for directional signals, not absolute truth.

## Goal

Query production metrics and alerts to provide system health data:

- LLM cost and token consumption
- Error rates and alert status
- Container health and resource pressure
- Recent deployment annotations

## Prerequisites

This command requires Grafana MCP tools to be available. If you get errors about missing Grafana tools, ask the user to ensure:

- `GRAFANA_URL` - Grafana Cloud instance URL
- `GRAFANA_SERVICE_ACCOUNT_TOKEN` - Readonly service account token (Viewer role)

These must be configured in the Grafana MCP server settings.

## Your Task

When invoked, run a health check and provide a concise report covering:

### Service Overview

- List all running services from Loki logs
- Show per-service health: memory usage, CPU usage, OOM events

### Aggregate Metrics

- LLM spend in last hour (USD)
- Total tokens consumed (last hour)
- LLM error count (last hour)
- Cost/tokens breakdown by provider

### Alerts & Incidents

- Active alert rules status
- Open incidents count
- Recent deployment annotations (last 24h)

## Output Format

Provide a concise dashboard-style summary:

```
=== Services ===
  ✓ app
  ✓ scheduler-worker
  ✓ openclaw-gateway

=== Per-Service Health ===
app:
  Memory: 45%  CPU: 12%  OOMs: 0
scheduler-worker:
  Memory: 23%  CPU: 5%  OOMs: 0

=== Aggregate Metrics ===
LLM Cost (1h): $0.05
Tokens (1h): 12450
Errors (1h): 0

=== Cost Breakdown ===
  OpenRouter: $0.045

Tokens by Provider:
  OpenRouter: 11200 tokens

=== Alerts & Incidents ===
Active Alerts: 0
Open Incidents: 0
Recent Deployments (24h): 2
```

## Interpretation Guide

- Memory >80% = concerning, may cause OOMs
- OOM events >0 = critical, service was killed
- Cost spikes = investigate model usage
- Empty services list = metric collection failure

## Usage Context

**When to use:**

- System health checks before/after changes
- Budget/cost monitoring
- Incident investigations

**v0 Known Issues:**

- Provider label may show "litellm" instead of actual provider (OpenRouter, etc.)
- Alerts & incidents may not be configured yet
- Some services may not report metrics (transient containers)
- Postgres internals, Temporal workflows, and network stats not included (future)

## Design Constraints

- **Readonly only** - Viewer role, no mutations
- **Low context** - Keep results <500 chars per section
- **High signal** - Focus on metrics over logs
- **Fast** - Aim for <10s total query time
