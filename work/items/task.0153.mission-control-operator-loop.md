---
id: task.0153
type: task
title: "Mission Control: operator loop — situational awareness + work item execution"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "Replace HEARTBEAT → git-sync with a 6-step operator loop: sync, observe (queries.sh + governance API + treasury RPC), pick work item from _index.md, dispatch lifecycle skill via brain subagent, record EDO, report to Discord. No new state files — uses existing work item frontmatter, queries.sh, and EDO templates."
outcome: "Each hourly run: git-sync, read health + cost + credits + treasury via existing tools, pick highest-priority unclaimed work item (finish-before-starting), dispatch matching lifecycle skill, write EDO, post Discord summary with runway indicator. Agent sees its burn rate, credit balance, treasury balance, and knows what it's working on — all from existing infrastructure."
spec_refs:
  - ai-governance-data-spec
  - cogni-brain-spec
  - governance-visibility-dashboard
  - development-lifecycle
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control
pr:
reviewer:
revision: 4
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

HEARTBEAT fires hourly via Temporal → OpenClaw gateway → `/git-sync`. The agent has zero situational awareness, zero prioritization, and does no actual work.

**What already exists (and we should USE, not rebuild):**

| Capability | Where | Status |
|---|---|---|
| Health metrics (cost, tokens, errors, memory, services) | `queries.sh` — 14 commands, Prometheus + Loki | Working |
| Credit balance | `/api/v1/governance/status` → `systemCredits` | Working (requires internal network) |
| Work item statuses + priority ordering | `work/items/_index.md` (generated from frontmatter) | Working |
| Work item claim fields | `claimed_by_run`, `claimed_at`, `last_command` in frontmatter | Specced, unused |
| Development lifecycle dispatch | `status → /command` mapping in development-lifecycle spec | Working |
| EDO decision tracking | `memory/EDO/` + `memory-templates/EDO.template.md` | Scaffolded, empty |
| Budget gate | `memory/_budget_header.md` | Working |
| Git sync | `/git-sync` skill | Working |
| Brain delegation (researcher → strong model) | SOUL.md | Working |
| Lifecycle skills | `/triage`, `/design`, `/implement`, `/closeout`, `/review-implementation`, `/research` | Working |

**What is genuinely missing:**

1. SOUL.md routing: `HEARTBEAT` → `/mission-control` (instead of `/git-sync`)
2. `/mission-control` SKILL.md — the operator loop prompt
3. Treasury query — DAO wallet USDC balance via Base RPC (~15 lines, add to queries.sh)
4. Runway calculation — arithmetic on existing data (~10 lines, add to queries.sh)

That's it. Everything else already exists.

## Design

### What We Killed (and Why)

| Rev 3 proposed | Verdict | Why |
|---|---|---|
| **mc-billing.sh** (170 lines) | **Killed** — add 3 commands to queries.sh | queries.sh already has cost/tokens. Governance API already has credits. Only treasury (Base RPC) is new. |
| **WIP.md** (shadow state file) | **Killed** — use work item frontmatter | `claimed_by_run`, `claimed_at`, `last_command` already exist in the work item spec. Don't maintain a shadow copy. |
| **_budget_header.md updates** | **Killed** — hold data in context | Agent reads cost + credits in Step 2. It has the numbers in context for Step 3. Writing them to a file and reading them back is pointless. |
| **Circuit breaker in markdown** | **Killed** — use `blocked_by` field | Work items already have `blocked_by` + `status: blocked`. If the agent can't make progress, set `status: blocked` + `blocked_by: "3 failed attempts: <reason>"`. |
| **9-step procedure** | **Simplified to 6** | Steps 3 (CHECK WIP) and 5 (UPDATE BUDGET) were maintaining shadow state. Removed. |
| **Reflection storage in WIP.md** | **Moved** — store in EDO files | EDOs already capture decisions + outcomes. The "Completed" section of WIP.md was duplicating EDO. |

### Research-Backed Principles

> Full research: [docs/research/autonomous-agent-operator-loops.md](../../docs/research/autonomous-agent-operator-loops.md)

1. **Budget signal must be visible at decision time** ([Google BATS](https://arxiv.org/abs/2511.17006)) — inject cost + runway data into context BEFORE pick/dispatch. Budget-unaware agents waste 40% more.
2. **Plan-and-Execute over ReAct** ([Plan-and-Act](https://arxiv.org/html/2503.09572v3)) — the 6-step procedure IS the plan. Brain subagent IS the executor. 92% vs 85% completion rate.
3. **External verification over self-evaluation** ([Reflexion](https://arxiv.org/abs/2303.11366)) — check git status, PR state, `pnpm check` results. Never ask "did you succeed?"
4. **Fresh context per run** ([Devin](https://devin.ai/agents101)) — each hourly run starts with zero conversation history. Only persistent state: work item frontmatter, EDO files, git.
5. **Single sub-agent at a time** ([Claude Code](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)) — one brain, one item, one skill. No parallel execution.

### The Operator Loop

```
HEARTBEAT trigger
  │
  ▼
/mission-control
  │
  ├─ 1. SYNC
  │     Run /git-sync. Continue regardless.
  │
  ├─ 2. OBSERVE (cheap curl calls only, ~15s)
  │     a. queries.sh health    → service health snapshot
  │     b. queries.sh cost      → LLM cost (TIME_WINDOW=24h)
  │     c. queries.sh treasury  → DAO wallet USDC balance (NEW)
  │     d. queries.sh runway    → credits + treasury + burn rate → runway_days + 🟢/🟡/🔴 (NEW)
  │     e. cat _index.md | head -60  → work item statuses + priorities
  │
  ├─ 3. PICK (agent judgment — exactly 1 item)
  │     Budget gate: if runway_indicator=🔴 AND credits ≤ 0 → no-op, report only
  │     Continue existing: if an item has claimed_by_run=HEARTBEAT and status unchanged → continue it
  │     Pick new: from _index.md, highest priority unclaimed item, finish-before-starting:
  │       needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage
  │     Update work item frontmatter: claimed_by_run=HEARTBEAT, claimed_at=now, last_command=<skill>
  │
  ├─ 4. DISPATCH (expensive — brain subagent)
  │     Map status → lifecycle skill (per development-lifecycle spec):
  │       needs_merge     → /review-implementation
  │       needs_closeout  → /closeout
  │       needs_implement → /implement
  │       needs_design    → /design
  │       needs_research  → /research
  │       needs_triage    → /triage
  │     Scan EDO files for past reflections on same skill (Reflexion pattern).
  │     Delegate to brain with: work item path, skill, runway summary, relevant reflections.
  │     If brain fails → check if same failure as last_command result.
  │       If same failure 3x → set status=blocked, blocked_by="<reason>", post Discord escalation.
  │
  ├─ 5. RECORD
  │     If action taken → write EDO file per existing template:
  │       decision, evidence_refs, expected_outcome, verification_method, by_date
  │     For any EDO with by_date ≤ now → run verification_method, write verdict
  │     Update edo_index.md
  │
  └─ 6. REPORT → Discord
        Single message:
          <🟢/🟡/🔴> Health: <status> | Cost: $X.XX/24h | Runway: Xd
          Action: <dispatched /skill on task.XXXX> | no-op: <reason>
          EDO: N confirmed, N failed, N pending
```

### queries.sh Additions (3 new commands)

Add to existing `.openclaw/skills/deployment-health/queries.sh`:

```bash
cmd_credits() {
  # Credit balance from governance status API (gateway is on internal network)
  local response credits
  response=$(curl -s --max-time 5 "http://app:3000/api/v1/governance/status" 2>/dev/null || echo "")
  if [ -n "$response" ] && echo "$response" | jq -e '.systemCredits' >/dev/null 2>&1; then
    credits=$(echo "$response" | jq -r '.systemCredits // "0"')
    # 1 credit = $0.0000001 USD (CREDITS_PER_USD = 10_000_000)
    local usd=$(echo "scale=2; ${credits} / 10000000" | bc 2>/dev/null || echo "0")
    echo "Credits: ${credits} ($${usd} USD)"
  else
    echo "Credits: unavailable (governance API unreachable)"
  fi
}

cmd_treasury() {
  # DAO wallet USDC balance on Base mainnet (public RPC, no API key)
  local wallet="0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6"
  local usdc="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  local rpc="${BASE_RPC:-https://mainnet.base.org}"
  local addr=$(echo "$wallet" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
  local padded=$(printf '%064s' "$addr" | tr ' ' '0')
  local data="0x70a08231${padded}"

  local response raw balance
  response=$(curl -s --max-time 10 "$rpc" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"${usdc}\",\"data\":\"${data}\"},\"latest\"],\"id\":1}" \
    2>/dev/null || echo "")
  if [ -n "$response" ] && echo "$response" | jq -e '.result' >/dev/null 2>&1; then
    raw=$(echo "$response" | jq -r '.result // "0x0"')
    balance=$(printf "%d" "$raw" 2>/dev/null || echo "0")
    balance=$(echo "scale=2; ${balance} / 1000000" | bc 2>/dev/null || echo "0")
    echo "Treasury: \$${balance} USDC (${wallet})"
  else
    echo "Treasury: unavailable (Base RPC unreachable)"
  fi
}

cmd_runway() {
  # Runway = (credits_usd + treasury_usdc) / daily_burn_rate
  local cost_7d burn credits_usd treasury_usd total runway indicator

  cost_7d=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[7d]))" | extract_value)
  burn=$(echo "scale=4; ${cost_7d:-0} / 7" | bc 2>/dev/null || echo "0")

  # Best-effort credit balance
  local cred_response cred_raw
  cred_response=$(curl -s --max-time 5 "http://app:3000/api/v1/governance/status" 2>/dev/null || echo "")
  cred_raw=$(echo "$cred_response" | jq -r '.systemCredits // "0"' 2>/dev/null || echo "0")
  credits_usd=$(echo "scale=2; ${cred_raw} / 10000000" | bc 2>/dev/null || echo "0")

  # Best-effort treasury
  treasury_usd=$(cmd_treasury 2>/dev/null | grep -oP '\$\K[0-9.]+' || echo "0")

  total=$(echo "scale=2; ${credits_usd} + ${treasury_usd}" | bc 2>/dev/null || echo "0")

  if [ "$(echo "$burn > 0" | bc -l 2>/dev/null)" = "1" ]; then
    runway=$(echo "scale=1; ${total} / ${burn}" | bc 2>/dev/null || echo "0")
  else
    runway="inf"
  fi

  # 🟢 >30d, 🟡 7-30d, 🔴 <7d
  if [ "$runway" = "inf" ]; then indicator="🟢"
  elif [ "$(echo "$runway > 30" | bc -l 2>/dev/null)" = "1" ]; then indicator="🟢"
  elif [ "$(echo "$runway >= 7" | bc -l 2>/dev/null)" = "1" ]; then indicator="🟡"
  else indicator="🔴"; fi

  echo "${indicator} Runway: ${runway}d | Funds: \$${total} | Burn: \$${burn}/day"
}
```

Wire into `cmd_all()` and add to the case statement. ~60 lines total added to an existing 250-line file.

### SKILL.md

```markdown
# /mission-control

> Operator loop. Runs hourly on HEARTBEAT. You are the researcher (cheap model).

## 1. SYNC

Run /git-sync. Continue regardless.

## 2. OBSERVE

Run these and capture output:

    TIME_WINDOW=24h bash /repo/current/.openclaw/skills/deployment-health/queries.sh cost
    bash /repo/current/.openclaw/skills/deployment-health/queries.sh credits
    bash /repo/current/.openclaw/skills/deployment-health/queries.sh treasury
    bash /repo/current/.openclaw/skills/deployment-health/queries.sh runway
    bash /repo/current/.openclaw/skills/deployment-health/queries.sh alerts
    head -60 /repo/current/work/items/_index.md

## 3. PICK

Budget gate: if runway indicator is 🔴 AND credits ≤ 0 → skip to step 6, reason="no_funds".

Look at _index.md. Find the highest-priority unclaimed item. Finish before starting:
  needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage
Within the same status, pick the lowest priority number, then lowest rank.

Skip items that have `claimed_by_run` set by another runner.
If you claimed an item last run and its status hasn't advanced → continue it.
If it failed 3 times with the same error → set status=blocked, blocked_by="<reason>".

Update the work item file: set `claimed_by_run: HEARTBEAT`, `claimed_at: <now>`, `last_command: <skill>`.
Commit the frontmatter change.

## 4. DISPATCH

Map status to skill per development-lifecycle spec:
  needs_merge → /review-implementation
  needs_closeout → /closeout
  needs_implement → /implement
  needs_design → /design
  needs_research → /research
  needs_triage → /triage

Check EDO files in /workspace/memory/EDO/ for past decisions on similar work. Include relevant
reflections in the brain subagent brief.

Include the runway summary from step 2 in the brief.

Spawn brain subagent with: work item path, lifecycle skill, runway context.

## 5. RECORD

If you took action → write an EDO file using the template at
/workspace/memory-templates/EDO.template.md. Include verification_method and by_date (next run).

For any EDO in /workspace/memory/EDO/ with by_date ≤ now → run its verification_method,
write verdict (confirmed/failed/inconclusive).

Update /workspace/memory/edo_index.md.

## 6. REPORT

Post one message to Discord governance channel:
  Line 1: <🟢/🟡/🔴> Health: <status> | Cost: $X.XX/24h | Runway: Xd
  Line 2: Action: dispatched /<skill> on <item> — OR — no-op: <reason>
  Line 3: EDO: N confirmed, N failed, N pending

EXIT. Do not continue.

## Constraints

- Exactly 1 work item per run. No sprawl.
- Brain subagent does all writes. You only read + dispatch.
  Exception: EDO files, edo_index.md, and work item frontmatter (claimed_by_run).
- If any step takes >60s, skip it and note in report.
```

### Files

**Create:**

- `.openclaw/skills/mission-control/SKILL.md` — the operator loop prompt above

**Modify:**

- `.openclaw/skills/deployment-health/queries.sh` — add `cmd_credits`, `cmd_treasury`, `cmd_runway` (~60 lines)
- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — change `HEARTBEAT` routing to `/mission-control`

**No new state files.** WIP.md, mc-billing.sh, _budget_header.md updates — all killed.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes `HEARTBEAT` → `/mission-control`
- [ ] USES_EXISTING_QUERIES_SH: Financial data comes from 3 new commands in queries.sh, not a separate script
- [ ] USES_EXISTING_GOVERNANCE_API: Credit balance from `/api/v1/governance/status` → `systemCredits`
- [ ] USES_EXISTING_FRONTMATTER: WIP tracking via `claimed_by_run` + `claimed_at` + `last_command` fields
- [ ] USES_EXISTING_EDO_TEMPLATE: Decision tracking via `memory-templates/EDO.template.md`
- [ ] NO_SHADOW_STATE: No WIP.md, no _budget_header.md updates, no mc-billing.sh
- [ ] WORK_ITEM_EXECUTION: The loop picks a real work item and dispatches a lifecycle skill
- [ ] FINISH_BEFORE_STARTING: needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage
- [ ] RUNWAY_VISIBLE: Discord report includes 🟢/🟡/🔴 indicator, runway days, and cost
- [ ] EXTERNAL_VERIFICATION: EDO outcome checks use external signals (git, gh, metrics), not self-evaluation
- [ ] BUDGET_GATE: 🔴 + zero credits → no dispatch, report only
- [ ] ONE_FOCUS: Exactly 1 work item per run. Brain handles it. No scope creep.
- [ ] COST_DISCIPLINE: Steps 1-3, 5-6 are cheap (curl/bash/file reads). Only Step 4 (brain dispatch) is expensive.

### Action Taxonomy

| Action | How | Autonomous? |
|---|---|---|
| Read metrics / work items | queries.sh + cat | Yes |
| Update work item frontmatter (claim) | Direct file edit + commit | Yes |
| Triage / Design work items | Brain + lifecycle skill | Yes |
| Implement code / fix bugs | Brain + /implement | Yes (with EDO) |
| Create PRs | Brain + /closeout | Yes (with EDO) |
| Escalate (blocked) | Set status=blocked + Discord | Yes |
| Post Discord report | `message` tool | Yes |
| Merge PRs | **No** — human review required | No |

## Validation

- [ ] Deploy with updated SOUL.md, trigger HEARTBEAT manually
- [ ] Verify queries.sh credits/treasury/runway commands work from gateway container
- [ ] Verify agent reads _index.md, picks correct highest-priority item
- [ ] Verify work item frontmatter updated with claimed_by_run after pick
- [ ] Verify brain subagent receives work item + lifecycle skill + runway context
- [ ] Verify EDO written for action with verification_method
- [ ] Verify subsequent run checks EDO by_date and runs verification
- [ ] Verify Discord message has all three lines
- [ ] Verify budget gate: zero credits + 🔴 → no dispatch, report only
- [ ] Verify 3 same-failure → status=blocked + Discord escalation
