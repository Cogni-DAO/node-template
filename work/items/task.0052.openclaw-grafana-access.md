---
id: task.0052
type: task
title: "Get OpenClaw Grafana access — spend visibility for sandbox agents"
status: Todo
priority: 0
estimate: 1
summary: "We have zero visibility into OpenClaw LLM spend. Need Grafana dashboard access to monitor OpenRouter/LiteLLM usage in real time — token counts, model selection, cost per call. Without this, we're flying blind on a platform that burned $20 in 30 minutes."
outcome: "Grafana dashboard showing real-time OpenClaw LLM spend — per-model cost, token counts, call frequency. Alert rule for spend rate anomalies."
spec_refs:
  - observability
  - openclaw-sandbox-spec
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [openclaw, grafana, observability, cost, p0]
external_refs:
assignees: derekg1729
credit:
---

# task.0052 — Get OpenClaw Grafana access

## Context

On 2026-02-14, the OpenClaw sandbox agent burned $20 in ~30 minutes by sending 85K input tokens per call to claude-opus-4.6. We had zero visibility into this until after hitting the OpenRouter weekly key limit. This is unacceptable.

## Requirements

1. **Grafana dashboard access** for OpenClaw/LiteLLM spend data
   - OpenRouter spend per model per hour
   - Token counts (input/output) per call
   - Cost per call breakdown
   - Call frequency / rate

2. **Alert rules** for spend anomalies
   - Spend rate > $X/hour → alert
   - Input tokens > threshold per call → alert
   - Weekly budget approaching limit → alert

3. **LiteLLM spend logs integration**
   - LiteLLM exposes `/spend/logs` API — query and push to Grafana
   - Or configure LiteLLM to push metrics to Prometheus/Loki

## Validation

- Grafana dashboard shows real-time OpenClaw LLM spend per model
- Alert fires when spend rate exceeds threshold
- Token counts visible per call in dashboard

## Investigation Steps

- [ ] Check current Grafana Cloud access — do we have a LiteLLM datasource?
- [ ] Check LiteLLM config for metrics/Prometheus endpoint
- [ ] Check if OpenRouter has a usage API we can poll
- [ ] Set up dashboard with available data sources
- [ ] Create P0 alert rules for spend rate

## PR / Links

- Related: bug.0037 (gateway proxy billing records $0 cost)
- Related: task.0027 (Alloy infra metrics)
- Related: task.0028 (Grafana P0 alert rules)
- Spec: docs/spec/observability.md

## Attribution

-
