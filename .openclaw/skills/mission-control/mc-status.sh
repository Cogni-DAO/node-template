#!/bin/bash
# mc-status.sh — Gather financials + health → JSON
# Usage: bash mc-status.sh
# Requires: GRAFANA_URL, GRAFANA_SERVICE_ACCOUNT_TOKEN env vars
# Sources queries.sh helpers for Prometheus/Loki queries

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUERIES_SH="${SCRIPT_DIR}/../deployment-health/queries.sh"

# Source helpers (prom_query, loki_query, extract_value)
# shellcheck source=../deployment-health/queries.sh
source "$QUERIES_SH"

# --- Data Collection ---

# Cost: 24h and 7d
cost_24h=$(TIME_WINDOW=24h prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[24h]))" \
  | extract_value | awk '{printf "%.4f", $1}')

cost_7d=$(TIME_WINDOW=7d prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[7d]))" \
  | extract_value | awk '{printf "%.4f", $1}')

# Burn rate: 7d average per day
burn_rate=$(echo "$cost_7d" | awk '{printf "%.4f", $1 / 7}')

# Errors: 24h LLM errors
errors_24h=$(TIME_WINDOW=24h prom_query "sum(increase(ai_llm_errors_total{env=\"${ENV}\"}[24h]))" \
  | extract_value | awk '{printf "%.0f", $1}')

# Firing alerts count
firing_alerts=$(curl -s "${GRAFANA_URL}/api/ruler/grafana/api/v1/rules" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '[.. | objects | select(.state? == "firing")] | length' 2>/dev/null || echo "0")

# Credits: from governance API (BigInt / 10M = USD)
credits_raw=$(curl -s "http://app:3000/api/v1/governance/status" 2>/dev/null \
  | jq -r '.systemCredits // "0"' 2>/dev/null || echo "0")
credits_usd=$(echo "$credits_raw" | awk '{printf "%.2f", $1 / 10000000}')

# Treasury: DAO wallet USDC balance on Base mainnet
# USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
# DAO wallet: 0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6
USDC_CONTRACT="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
DAO_WALLET="0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6"
# balanceOf(address) selector: 0x70a08231 + zero-padded address
CALL_DATA="0x70a08231000000000000000000000000${DAO_WALLET#0x}"
BASE_RPC="${BASE_RPC_URL:-https://mainnet.base.org}"

treasury_hex=$(curl -s -X POST "$BASE_RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"${USDC_CONTRACT}\",\"data\":\"${CALL_DATA}\"},\"latest\"],\"id\":1}" \
  | jq -r '.result // "0x0"' 2>/dev/null || echo "0x0")

# Convert hex to decimal, divide by 1M (USDC has 6 decimals)
treasury_usd=$(printf "%d" "$treasury_hex" 2>/dev/null | awk '{printf "%.2f", $1 / 1000000}' || echo "0.00")

# --- Calculations ---

# Runway: (credits + treasury) / burn_rate
if [ "$(echo "$burn_rate" | awk '{print ($1 > 0)}')" = "1" ]; then
  runway_days=$(echo "$credits_usd $treasury_usd $burn_rate" | awk '{printf "%.1f", ($1 + $2) / $3}')
else
  runway_days="999.0"
fi

# Tier: GREEN/YELLOW/RED
runway_int=$(echo "$runway_days" | awk '{printf "%d", $1}')
if [ "$runway_int" -le 0 ] || [ "$(echo "$credits_usd" | awk '{print ($1 <= 0)}')" = "1" ]; then
  tier="RED"
elif [ "$runway_int" -lt 7 ]; then
  tier="RED"
elif [ "$runway_int" -le 30 ]; then
  tier="YELLOW"
else
  tier="GREEN"
fi

# --- Output JSON ---

jq -n \
  --argjson cost_24h "$cost_24h" \
  --argjson cost_7d "$cost_7d" \
  --argjson burn_rate "$burn_rate" \
  --argjson credits_usd "$credits_usd" \
  --argjson treasury_usd "$treasury_usd" \
  --argjson runway_days "$runway_days" \
  --arg tier "$tier" \
  --argjson errors_24h "$errors_24h" \
  --argjson firing_alerts "$firing_alerts" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    cost_24h_usd: $cost_24h,
    cost_7d_usd: $cost_7d,
    burn_rate_usd_per_day: $burn_rate,
    credits_usd: $credits_usd,
    treasury_usd: $treasury_usd,
    runway_days: $runway_days,
    tier: $tier,
    errors_24h: $errors_24h,
    firing_alerts: $firing_alerts,
    timestamp: $timestamp
  }'
