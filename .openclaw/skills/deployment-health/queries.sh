#!/bin/bash
# Grafana Health Queries - Readonly metrics for governance
# Usage: ./queries.sh <command>
# Commands: cost, tokens, errors, memory, alerts, incidents, deployments, all

set -euo pipefail

# Load from workspace env (required, no defaults)
: "${GRAFANA_URL:?GRAFANA_URL not set - run /env-update}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set - run /env-update}"
TOKEN="${GRAFANA_SERVICE_ACCOUNT_TOKEN}"

# Datasource UIDs (stable)
PROM_UID="grafanacloud-prom"
LOKI_UID="grafanacloud-logs"

# Helper: Query Prometheus instant
prom_query() {
  local query="$1"
  curl -s -G "${GRAFANA_URL}/api/datasources/uid/${PROM_UID}/resources/api/v1/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "query=${query}"
}

# Helper: Extract single value
extract_value() {
  jq -r '.data.result[0].value[1] // "0"'
}

# --- Commands ---

cmd_cost() {
  echo -n "LLM Cost (1h): $"
  prom_query 'sum(increase(ai_llm_cost_usd_total[1h]))' \
    | extract_value | awk '{printf "%.4f", $1}'
  echo ""
}

cmd_tokens() {
  echo -n "Tokens (1h): "
  prom_query 'sum(increase(ai_llm_tokens_total[1h]))' \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""
}

cmd_errors() {
  echo -n "Errors (1h): "
  prom_query 'sum(increase(ai_llm_errors_total[1h]))' \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""
}

cmd_memory() {
  echo -n "Memory Pressure: "
  prom_query 'max(container_memory_working_set_bytes{job="cadvisor"} / container_spec_memory_limit_bytes{job="cadvisor"} * 100)' \
    | extract_value | awk '{printf "%.0f%%", $1}'
  echo ""
}

cmd_alerts() {
  echo -n "Alert Rules: "
  curl -s "${GRAFANA_URL}/api/ruler/grafana/api/v1/rules" \
    -H "Authorization: Bearer ${TOKEN}" \
    | jq -r 'if type == "object" then keys | length else 0 end'
}

cmd_incidents() {
  echo -n "Open Incidents: "
  curl -s -X POST "${GRAFANA_URL}/api/plugins/grafana-irm-app/resources/api/v1/IncidentsService.QueryIncidents" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{"limit":100}' \
    | jq -r '(.incidents // []) | map(select(.status == "active")) | length'
}

cmd_deployments() {
  echo "Recent Deployments (24h):"
  FROM=$(($(date -u +%s) - 86400))000
  TO=$(date -u +%s)000
  curl -s "${GRAFANA_URL}/api/annotations?limit=5&from=${FROM}&to=${TO}" \
    -H "Authorization: Bearer ${TOKEN}" \
    | jq -r '.[] | "  [\(.time/1000|strftime("%m-%d %H:%M"))] \(.text // "N/A")"'
}

cmd_services() {
  echo "Services:"
  # Get unique container names from cAdvisor metrics
  prom_query 'count by (container) (container_memory_working_set_bytes{container!=""})' \
    | jq -r '.data.result[] | "  ✓ \(.metric.container)"' | sort
}

cmd_service_health() {
  echo "Per-Service Health:"
  # Top services to monitor
  for service in app scheduler-worker openclaw-gateway litellm temporal postgres; do
    echo ""
    echo "${service}:"

    # Memory usage
    local mem_query="container_memory_working_set_bytes{container=\"${service}\"} / container_spec_memory_limit_bytes{container=\"${service}\"} * 100"
    local mem=$(prom_query "$mem_query" | jq -r '.data.result[0].value[1] // "0"' | awk '{printf "%.0f%%", $1}')

    # CPU (rate over 1m)
    local cpu_query="rate(container_cpu_usage_seconds_total{container=\"${service}\"}[1m]) * 100"
    local cpu=$(prom_query "$cpu_query" | jq -r '.data.result[0].value[1] // "0"' | awk '{printf "%.1f%%", $1}')

    # OOM events
    local oom=$(prom_query "container_oom_events_total{container=\"${service}\"}" | jq -r '.data.result[0].value[1] // "0"')

    echo "  Memory: ${mem}  CPU: ${cpu}  OOMs: ${oom}"
  done
}

cmd_cost_breakdown() {
  echo "Cost Breakdown (1h):"
  # Cost by provider
  prom_query 'sum by (provider) (increase(ai_llm_cost_usd_total[1h]))' \
    | jq -r '.data.result[] | "  \(.metric.provider): $\(.value[1] | tonumber * 100 | round / 100)"'

  echo ""
  echo "Tokens by Provider:"
  prom_query 'sum by (provider) (increase(ai_llm_tokens_total[1h]))' \
    | jq -r '.data.result[] | "  \(.metric.provider): \(.value[1] | tonumber | floor) tokens"'
}

cmd_all() {
  echo "=== Services ==="
  cmd_services
  echo ""
  echo "=== Per-Service Health ==="
  cmd_service_health
  echo ""
  echo "=== Aggregate Metrics ==="
  cmd_cost
  cmd_tokens
  cmd_errors
  echo ""
  echo "=== Cost Breakdown ==="
  cmd_cost_breakdown
  echo ""
  echo "=== Alerts & Incidents ==="
  cmd_alerts
  cmd_incidents
  echo ""
  cmd_deployments
  echo ""
  echo "Note: Postgres internals, Temporal workflows, and network stats not included (future)"
  echo "Note: Alerts & incidents not configured yet"
}

# Main
CMD="${1:-all}"
case "$CMD" in
  cost) cmd_cost ;;
  tokens) cmd_tokens ;;
  errors) cmd_errors ;;
  memory) cmd_memory ;;
  alerts) cmd_alerts ;;
  incidents) cmd_incidents ;;
  deployments) cmd_deployments ;;
  services) cmd_services ;;
  health) cmd_service_health ;;
  breakdown) cmd_cost_breakdown ;;
  all) cmd_all ;;
  *)
    echo "Unknown command: $CMD"
    echo "Available: cost, tokens, errors, memory, alerts, incidents, deployments, services, health, breakdown, all"
    exit 1
    ;;
esac
