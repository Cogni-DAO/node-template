---
id: task.0153
type: task
title: "Mission Control: operator loop — deterministic tools + thin prompt"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "Replace HEARTBEAT → git-sync with an operator loop backed by deterministic CLI tools (mc-pick, mc-gate, mc-status) that output JSON. The prompt is thin — it runs tools, reads JSON, dispatches one lifecycle skill via brain subagent, writes EDO, posts Discord. LLM tokens spent on judgment (which item, what went wrong), not on parsing markdown."
outcome: "Each hourly run: git-sync, run mc-status (JSON health/cost/runway), run mc-gate (GREEN/YELLOW/RED tier), run mc-pick (JSON next item + skill), dispatch brain subagent with lifecycle skill, write EDO, post Discord summary. All observation and selection is deterministic bash. Only dispatch and recording require LLM reasoning."
spec_refs:
  - development-lifecycle
  - governance-visibility-dashboard
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control
pr:
reviewer:
revision: 5
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-11
labels: [governance, heartbeat, operator, mission-control]
external_refs:
  - docs/research/autonomous-agent-operator-loops.md
---

# Mission Control: Operator Loop

## Context

HEARTBEAT fires hourly via Temporal → OpenClaw gateway → `/git-sync`. The agent has zero situational awareness and does no actual work.

**Existing infra we use (not rebuild):**

| Capability | Where |
|---|---|
| Health metrics (cost, tokens, errors, services) | `queries.sh` (14 commands, Prometheus + Loki) |
| Credit balance | `/api/v1/governance/status` → `systemCredits` |
| Work item index (priority-sorted, with statuses) | `work/items/_index.md` (generated from frontmatter) |
| Work item claim fields | `claimed_by_run`, `claimed_at`, `last_command` in frontmatter |
| Status → /command dispatch | development-lifecycle spec |
| EDO decision tracking | `memory/EDO/` + `memory-templates/EDO.template.md` |
| Git sync | `/git-sync` skill |
| Brain delegation | SOUL.md researcher→brain model |
| Lifecycle skills | `/triage`, `/design`, `/implement`, `/closeout`, `/review-implementation`, `/research` |
| Runtime caps | OpenClaw config: `timeoutSeconds: 540`, `subagents.maxConcurrent: 3` |

**What we build (all deterministic CLI tools + 1 thin prompt):**

1. `mc-status.sh` — JSON blob: health, cost, credits, treasury, runway, tier
2. `mc-pick.sh` — JSON blob: next item ID, status, skill, or `null` if nothing to do
3. `SKILL.md` — thin prompt: run tools, read JSON, dispatch brain, write EDO, post Discord

## Design

### Approach

**Move intelligence from the prompt into deterministic tools.** The LLM should not parse markdown tables, calculate runway, or apply priority logic. Bash scripts do that and return structured JSON. The LLM's job is:
1. Run the tools (mechanical)
2. Decide whether to act on the result (judgment — but usually yes)
3. Dispatch the brain subagent with the right skill (mechanical mapping)
4. Write an EDO if action was taken (judgment — what to verify)
5. Post a Discord summary (mechanical)

**Rejected:** "scan EDO files for similar reflections" — noisy and expensive. Instead, the brain subagent already has access to the work item (which contains design context, prior revisions, spec refs). That IS the relevant context. EDOs are for decision audit, not context injection.

### Degradation Ladder

Budget tier controls what the agent is allowed to do:

| Tier | Condition | Allowed actions |
|---|---|---|
| `GREEN` | runway > 30d | Full lifecycle: any skill including /implement |
| `YELLOW` | 7d ≤ runway ≤ 30d | Continue in-flight items only. No new /implement or /design. Triage + closeout OK. |
| `RED` | runway < 7d OR credits ≤ 0 | Report only. No dispatch. Post Discord warning. |

This is enforced in `mc-gate.sh` (deterministic) and respected by the prompt (one `if` check).

### mc-status.sh (~80 lines, extends queries.sh pattern)

Outputs a single JSON object. Calls existing queries.sh helpers + 2 new data sources.

```bash
#!/usr/bin/env bash
# mc-status.sh — Machine-readable operator status. Outputs JSON.
set -euo pipefail

# Source queries.sh helpers (prom_query, extract_value, loki_query)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../deployment-health/queries.sh.lib" 2>/dev/null || {
  # Inline the helpers if lib not available
  : "${GRAFANA_URL:?GRAFANA_URL not set}"
  : "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set}"
  TOKEN="${GRAFANA_SERVICE_ACCOUNT_TOKEN}"
  GRAFANA_URL="${GRAFANA_URL%/}"
  ENV="${DEPLOY_ENV:-production}"
  PROM_UID="grafanacloud-prom"
  prom_query() {
    curl -s -G "${GRAFANA_URL}/api/datasources/uid/${PROM_UID}/resources/api/v1/query" \
      -H "Authorization: Bearer ${TOKEN}" --data-urlencode "query=$1"
  }
  extract_value() { jq -r '.data.result[0].value[1] // "0"'; }
}

# --- Data collection ---

# Cost (from Prometheus, same as queries.sh cmd_cost)
cost_24h=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[24h]))" | extract_value)
cost_7d=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[7d]))" | extract_value)
burn=$(echo "scale=4; ${cost_7d:-0} / 7" | bc 2>/dev/null || echo "0")

# Credits (from governance status API — gateway is on internal network)
credits="0"
credits_usd="0"
cred_response=$(curl -s --max-time 5 "http://app:3000/api/v1/governance/status" 2>/dev/null || echo "")
if [ -n "$cred_response" ] && echo "$cred_response" | jq -e '.systemCredits' >/dev/null 2>&1; then
  credits=$(echo "$cred_response" | jq -r '.systemCredits // "0"')
  credits_usd=$(echo "scale=2; ${credits} / 10000000" | bc 2>/dev/null || echo "0")
fi

# Treasury (DAO wallet USDC on Base mainnet — public RPC)
treasury_usd="0"
wallet="0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6"
usdc_contract="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
rpc="${BASE_RPC:-https://mainnet.base.org}"
addr=$(echo "$wallet" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
padded=$(printf '%064s' "$addr" | tr ' ' '0')
call_data="0x70a08231${padded}"
treasury_response=$(curl -s --max-time 10 "$rpc" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"${usdc_contract}\",\"data\":\"${call_data}\"},\"latest\"],\"id\":1}" \
  2>/dev/null || echo "")
if [ -n "$treasury_response" ] && echo "$treasury_response" | jq -e '.result' >/dev/null 2>&1; then
  raw=$(echo "$treasury_response" | jq -r '.result // "0x0"')
  treasury_usd=$(printf "%d" "$raw" 2>/dev/null || echo "0")
  treasury_usd=$(echo "scale=2; ${treasury_usd} / 1000000" | bc 2>/dev/null || echo "0")
fi

# Runway
total_funds=$(echo "scale=2; ${credits_usd} + ${treasury_usd}" | bc 2>/dev/null || echo "0")
if [ "$(echo "$burn > 0" | bc -l 2>/dev/null)" = "1" ]; then
  runway=$(echo "scale=1; ${total_funds} / ${burn}" | bc 2>/dev/null || echo "0")
else
  runway="-1"  # -1 = infinite (no burn)
fi

# Tier: GREEN / YELLOW / RED
if [ "$runway" = "-1" ]; then tier="GREEN"
elif [ "$(echo "$runway > 30" | bc -l 2>/dev/null)" = "1" ]; then tier="GREEN"
elif [ "$(echo "$runway >= 7" | bc -l 2>/dev/null)" = "1" ]; then tier="YELLOW"
else tier="RED"; fi

# Errors
errors_24h=$(prom_query "sum(increase(ai_llm_errors_total{env=\"${ENV}\"}[24h]))" | extract_value)
alert_count=$(curl -s "${GRAFANA_URL}/api/ruler/grafana/api/v1/rules" \
  -H "Authorization: Bearer ${TOKEN}" | jq 'if type == "object" then [.[][]] | map(.rules) | flatten | map(select(.state == "firing")) | length else 0 end' 2>/dev/null || echo "0")

# Output JSON
cat <<ENDJSON
{
  "cost_24h_usd": ${cost_24h:-0},
  "cost_7d_usd": ${cost_7d:-0},
  "burn_rate_usd_per_day": ${burn},
  "credits": "${credits}",
  "credits_usd": ${credits_usd},
  "treasury_usd": ${treasury_usd},
  "total_funds_usd": ${total_funds},
  "runway_days": ${runway},
  "tier": "${tier}",
  "errors_24h": ${errors_24h:-0},
  "firing_alerts": ${alert_count},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
ENDJSON
```

### mc-pick.sh (~60 lines)

Deterministic work item selection. Parses `_index.md` markdown table, applies finish-before-starting priority, returns JSON.

```bash
#!/usr/bin/env bash
# mc-pick.sh — Pick next work item. Outputs JSON.
# Args: [--tier GREEN|YELLOW|RED] [--current-item ITEM_ID]
set -euo pipefail

TIER="${1:-GREEN}"
INDEX="${REPO_PATH:-/repo/current}/work/items/_index.md"

# Status → weight (finish before starting)
status_weight() {
  case "$1" in
    needs_merge)     echo 6 ;;
    needs_closeout)  echo 5 ;;
    needs_implement) echo 4 ;;
    needs_design)    echo 3 ;;
    needs_research)  echo 2 ;;
    needs_triage)    echo 1 ;;
    *)               echo 0 ;;  # done/blocked/cancelled = skip
  esac
}

# Statuses allowed per tier
tier_allows() {
  local tier="$1" status="$2"
  case "$tier" in
    RED) return 1 ;;  # RED = no dispatch
    YELLOW)
      case "$status" in
        needs_merge|needs_closeout|needs_triage) return 0 ;;
        *) return 1 ;;  # YELLOW = finish + triage only
      esac ;;
    GREEN) return 0 ;;  # GREEN = all
  esac
}

# Parse _index.md: extract rows from Active table
# Format: | Pri | Rank | Est | Status | ID | Title | Project | Project ID |
best_id="" best_status="" best_skill="" best_weight=0 best_pri=999 best_rank=999

while IFS='|' read -r _ pri rank _ status id title _; do
  # Trim whitespace
  pri=$(echo "$pri" | xargs)
  rank=$(echo "$rank" | xargs)
  status=$(echo "$status" | xargs)
  id=$(echo "$id" | xargs)

  # Skip non-data rows
  echo "$pri" | grep -qE '^[0-9]+$' || continue
  [ -z "$status" ] && continue

  w=$(status_weight "$status")
  [ "$w" -eq 0 ] && continue  # skip terminal statuses
  tier_allows "$TIER" "$status" || continue

  # Compare: higher weight wins, then lower pri, then lower rank
  if [ "$w" -gt "$best_weight" ] || \
     { [ "$w" -eq "$best_weight" ] && [ "$pri" -lt "$best_pri" ]; } || \
     { [ "$w" -eq "$best_weight" ] && [ "$pri" -eq "$best_pri" ] && [ "$rank" -lt "$best_rank" ]; }; then
    best_id="$id"
    best_status="$status"
    best_weight="$w"
    best_pri="$pri"
    best_rank="$rank"
  fi
done < "$INDEX"

# Map status → skill
if [ -n "$best_id" ]; then
  case "$best_status" in
    needs_merge)     best_skill="/review-implementation" ;;
    needs_closeout)  best_skill="/closeout" ;;
    needs_implement) best_skill="/implement" ;;
    needs_design)    best_skill="/design" ;;
    needs_research)  best_skill="/research" ;;
    needs_triage)    best_skill="/triage" ;;
  esac
  cat <<ENDJSON
{"id": "$best_id", "status": "$best_status", "skill": "$best_skill", "priority": $best_pri, "rank": $best_rank}
ENDJSON
else
  echo "null"
fi
```

### SKILL.md (thin prompt — ~40 lines)

```markdown
# /mission-control

> Operator loop. Runs hourly on HEARTBEAT.

## 1. SYNC

Run /git-sync. Continue regardless.

## 2. STATUS

Run: `bash /repo/current/.openclaw/skills/mission-control/mc-status.sh`

This returns JSON with cost, credits, treasury, runway, tier, errors.
Read the JSON. Note the `tier` field (GREEN/YELLOW/RED).

## 3. PICK

Run: `bash /repo/current/.openclaw/skills/mission-control/mc-pick.sh <tier>`

Where `<tier>` is from the status JSON. This returns JSON with the next
work item `id`, `status`, and `skill` to run — or `null` if nothing to do.

If null or tier is RED → skip to step 5 (report only).

Claim the item: update its frontmatter with `claimed_by_run: HEARTBEAT`,
`claimed_at: <now>`, `last_command: <skill>`. Commit.

## 4. DISPATCH

Spawn brain subagent with:
- The work item file path
- The lifecycle skill from step 3
- The runway/cost summary from step 2

If the brain fails, check the work item. If `last_command` produced the
same failure 3 times → set `status: blocked`, `blocked_by: "<reason>"`.
Post escalation to Discord.

## 5. RECORD + REPORT

If action taken → write EDO using template at
`/workspace/memory-templates/EDO.template.md`. Include `verification_method`
and `by_date` (next run). Update `/workspace/memory/edo_index.md`.

For any EDO with `by_date` ≤ now → run its `verification_method`,
write verdict.

Post one message to Discord:

    <tier_emoji> Cost: $X.XX/24h | Runway: Xd | Errors: N
    Action: /<skill> on <item> — OR — no-op: <reason>

EXIT.
```

### Files

**Create:**

- `.openclaw/skills/mission-control/SKILL.md` — thin prompt (~40 lines)
- `.openclaw/skills/mission-control/mc-status.sh` — JSON health/cost/runway/tier (~80 lines)
- `.openclaw/skills/mission-control/mc-pick.sh` — JSON next-item selection (~60 lines)

**Modify:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — change `HEARTBEAT` → `/mission-control`

**Unchanged:**

- `.openclaw/skills/deployment-health/queries.sh` — mc-status.sh sources its helpers, doesn't modify it
- `work/items/_index.md` — mc-pick.sh reads it, doesn't modify it
- `memory/EDO/` — used as-is for decision tracking

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] DETERMINISTIC_TOOLS: mc-status.sh and mc-pick.sh are pure bash, output JSON, require no LLM
- [ ] THIN_PROMPT: SKILL.md is <50 lines. LLM runs tools + reads JSON. No markdown table parsing.
- [ ] DEGRADATION_LADDER: mc-pick.sh respects tier (GREEN=all, YELLOW=finish+triage, RED=nothing)
- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes HEARTBEAT → /mission-control
- [ ] USES_EXISTING_GOVERNANCE_API: Credits from `/api/v1/governance/status` → `systemCredits`
- [ ] USES_EXISTING_FRONTMATTER: Claim tracking via `claimed_by_run` + `claimed_at` + `last_command`
- [ ] USES_EXISTING_EDO_TEMPLATE: Decision tracking via `memory-templates/EDO.template.md`
- [ ] NO_SHADOW_STATE: No WIP.md, no _budget_header.md writes, no parallel state
- [ ] FINISH_BEFORE_STARTING: mc-pick.sh weights needs_merge(6) > needs_closeout(5) > ... > needs_triage(1)
- [ ] EXTERNAL_VERIFICATION: EDO checks use external signals (git, gh, metrics)
- [ ] ONE_FOCUS: Exactly 1 work item per run
- [ ] COST_DISCIPLINE: Only dispatch (step 4) is expensive. Steps 1-3 and 5 are bash/curl.
- [ ] RUNTIME_CAPS: OpenClaw enforces timeoutSeconds:540, subagents.maxConcurrent:3

## Validation

- [ ] mc-status.sh returns valid JSON from gateway container (test with `jq .`)
- [ ] mc-pick.sh returns correct item for each tier (GREEN picks any, YELLOW skips implement/design, RED returns null)
- [ ] mc-pick.sh finish-before-starting: needs_merge item picked over needs_implement when both exist
- [ ] SOUL.md routes HEARTBEAT to /mission-control
- [ ] Brain subagent receives work item path + lifecycle skill
- [ ] Work item frontmatter updated with claimed_by_run after pick
- [ ] EDO written with verification_method
- [ ] Discord message posted with tier emoji + cost + action
- [ ] Degradation: RED tier → report only, no dispatch
- [ ] 3 same-failure → status=blocked + Discord escalation
