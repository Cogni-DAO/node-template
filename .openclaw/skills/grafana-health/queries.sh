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

cmd_all() {
  echo "=== System Health ==="
  cmd_cost
  cmd_tokens
  cmd_errors
  cmd_memory
  echo ""
  echo "=== Alerts & Incidents ==="
  cmd_alerts
  cmd_incidents
  echo ""
  cmd_deployments
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
  all) cmd_all ;;
  *)
    echo "Unknown command: $CMD"
    echo "Available: cost, tokens, errors, memory, alerts, incidents, deployments, all"
    exit 1
    ;;
esac
