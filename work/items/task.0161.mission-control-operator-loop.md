---
id: task.0161
type: task
title: "Mission Control: operator loop — deterministic pre-step + thin dispatch prompt"
status: needs_implement
priority: 0
rank: 1
estimate: 2
summary: "Replace HEARTBEAT → git-sync with a controller that precomputes status/gate/pick deterministically, then wakes the agent only for dispatch. mc-status.sh gathers financials. mc-pick uses @cogni/work-items port (not markdown scraping). The agent receives {item, skill, tier, budget} as input — zero decision-making on what to work on."
outcome: "Each hourly run: deterministic pre-step (mc-status.sh → mc-pick.ts) produces a dispatch envelope {item, skill, tier, status JSON}. Agent wakes, runs /git-sync, dispatches brain subagent with the envelope, writes EDO, posts Discord. Selection is fully deterministic. LLM only does execution + recording."
spec_refs:
  - development-lifecycle
  - governance-visibility-dashboard
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control-clean
pr:
reviewer:
revision: 6
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-12
labels: [governance, heartbeat, operator, mission-control]
external_refs:
  - docs/research/autonomous-agent-operator-loops.md
---

# Mission Control: Operator Loop

## Context

HEARTBEAT fires hourly via Temporal → OpenClaw gateway → `/git-sync`. The agent has zero situational awareness and does no actual work.

**Existing infra we use (not rebuild):**

| Capability                            | Where                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Health metrics (cost, tokens, errors) | `queries.sh` (14 commands, Grafana Prometheus + Loki)                                  |
| Credit balance                        | `/api/v1/governance/status` → `systemCredits`                                          |
| Work item query/filter/sort/claim     | `@cogni/work-items` package (`MarkdownWorkItemAdapter`)                                |
| Status → /command dispatch            | development-lifecycle spec                                                             |
| EDO decision tracking                 | `memory/EDO/` + `memory-templates/EDO.template.md`                                     |
| Git sync                              | `/git-sync` skill                                                                      |
| Brain delegation                      | SOUL.md researcher→brain model                                                         |
| Lifecycle skills                      | `/triage`, `/design`, `/implement`, `/closeout`, `/review-implementation`, `/research` |
| Runtime caps                          | OpenClaw config: `timeoutSeconds: 540`, `subagents.maxConcurrent: 3`                   |

## Design

### Outcome

The HEARTBEAT agent wakes up with a pre-decided envelope: `{item, skill, tier, budget}`. It doesn't choose what to work on — that's policy, not intelligence. It executes the chosen skill and reports results.

### Approach — Crawl

**Split controller from agent.** Two deterministic CLI tools run BEFORE the agent prompt. The agent gets their output as input — it never parses markdown, calculates runway, or picks work items.

Architecture (matches Anthropic's skill/hook/subagent split):

- **mc-status.sh** (bash) — gathers financials + health → JSON. Stays bash because it's just curl + jq.
- **mc-pick.ts** (TypeScript) — uses `@cogni/work-items` port to query/filter/sort/claim. No markdown scraping.
- **SKILL.md** (prompt) — receives pre-computed JSON, dispatches brain, writes EDO, posts Discord.

The LLM's job is:

1. Run /git-sync (mechanical)
2. Read the pre-computed envelope (no computation)
3. Dispatch brain subagent with the right skill (mechanical mapping)
4. Write EDO (judgment — what to verify)
5. Post Discord summary (mechanical)

**Rejected alternatives:**

- "mc-pick.sh scraping `_index.md`" — brittle markdown parsing when we have a proper TypeScript port with structured query, sort, and claim
- "Agent decides what to work on" — picking the next item is policy execution (finish-before-starting, tier filtering), not intelligence. PM process already prioritizes.
- "Scan EDO files for reflections" — noisy and expensive. The work item already contains design context + spec refs.

### Degradation Ladder

Budget tier controls what the agent is allowed to do. Enforced in mc-pick.ts (deterministic).

| Tier     | Condition                  | Allowed actions                                                  |
| -------- | -------------------------- | ---------------------------------------------------------------- |
| `GREEN`  | runway > 30d               | Full lifecycle: any skill                                        |
| `YELLOW` | 7d ≤ runway ≤ 30d          | Finish in-flight only: needs_merge, needs_closeout, needs_triage |
| `RED`    | runway < 7d OR credits ≤ 0 | Report only. No dispatch.                                        |

### mc-status.sh (bash, ~80 lines)

Gathers financials + health. Outputs JSON. Sources `queries.sh` helpers for Prometheus/Loki.

Data sources:

- **Cost**: Prometheus `ai_llm_cost_usd_total` (24h, 7d, burn rate)
- **Credits**: `curl http://app:3000/api/v1/governance/status` → `systemCredits` (BigInt / 10M = USD)
- **Treasury**: Base mainnet RPC `eth_call` → DAO wallet USDC balance (`balanceOf` / 1M = USD)
- **Runway**: `(credits_usd + treasury_usd) / burn_rate`
- **Tier**: GREEN/YELLOW/RED from runway thresholds
- **Errors**: Prometheus `ai_llm_errors_total` 24h + Grafana firing alerts count

Output shape:

```json
{
  "cost_24h_usd": 1.23,
  "burn_rate_usd_per_day": 4.56,
  "credits_usd": 100.0,
  "treasury_usd": 500.0,
  "runway_days": 131.5,
  "tier": "GREEN",
  "errors_24h": 3,
  "firing_alerts": 0,
  "timestamp": "2026-03-12T00:00:00Z"
}
```

### mc-pick.ts (TypeScript, uses @cogni/work-items port)

Deterministic work item selection via the proper port — no markdown table scraping.

```typescript
#!/usr/bin/env npx tsx
// mc-pick.ts — Deterministic next-item selection. Outputs JSON.
// Usage: npx tsx mc-pick.ts <tier> [--work-dir /repo/current]
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";

const STATUS_WEIGHT: Record<string, number> = {
  needs_merge: 6,
  needs_closeout: 5,
  needs_implement: 4,
  needs_design: 3,
  needs_research: 2,
  needs_triage: 1,
};

const YELLOW_ALLOWED = new Set([
  "needs_merge",
  "needs_closeout",
  "needs_triage",
]);

const STATUS_TO_SKILL: Record<string, string> = {
  needs_merge: "/review-implementation",
  needs_closeout: "/closeout",
  needs_implement: "/implement",
  needs_design: "/design",
  needs_research: "/research",
  needs_triage: "/triage",
};

const tier = process.argv[2] ?? "GREEN";
const workDir =
  process.argv[3] === "--work-dir" ? process.argv[4] : "/repo/current";

if (tier === "RED") {
  console.log("null");
  process.exit(0);
}

const adapter = new MarkdownWorkItemAdapter(workDir);

// Query all actionable statuses
const actionableStatuses = Object.keys(STATUS_WEIGHT) as any[];
const { items } = await adapter.list({
  statuses: actionableStatuses,
});

// Filter by tier
const allowed =
  tier === "YELLOW" ? items.filter((i) => YELLOW_ALLOWED.has(i.status)) : items;

// Sort: highest status weight first, then priority ASC, then rank ASC
// (port already sorts by priority/rank — we re-sort to apply status weight)
const sorted = allowed.sort((a, b) => {
  const wa = STATUS_WEIGHT[a.status] ?? 0;
  const wb = STATUS_WEIGHT[b.status] ?? 0;
  if (wb !== wa) return wb - wa; // higher weight first
  const pa = a.priority ?? 99;
  const pb = b.priority ?? 99;
  if (pa !== pb) return pa - pb; // lower priority number first
  return (a.rank ?? 99) - (b.rank ?? 99);
});

const pick = sorted[0];
if (!pick) {
  console.log("null");
  process.exit(0);
}

console.log(
  JSON.stringify({
    id: pick.id,
    status: pick.status,
    skill: STATUS_TO_SKILL[pick.status],
    priority: pick.priority ?? 99,
    rank: pick.rank ?? 99,
  })
);
```

Why TypeScript over bash:

- `@cogni/work-items` port already has query, filter, sort, claim — why rewrite in bash?
- No markdown parsing. Reads frontmatter directly via established adapter.
- Container is `node:22` with `pnpm` and the repo mounted. `npx tsx` works.
- When walk phase adds richer gates or stuck detection, TS is the natural place.

### SKILL.md (thin prompt — ~30 lines)

```markdown
# /mission-control

> Operator loop. Runs hourly on HEARTBEAT. Receives pre-computed dispatch envelope.

## 1. SYNC

Run /git-sync. Continue regardless of outcome.

## 2. READ ENVELOPE

Run: `bash /repo/current/.openclaw/skills/mission-control/mc-status.sh`
Run: `npx tsx /repo/current/.openclaw/skills/mission-control/mc-pick.ts <tier>`

Where `<tier>` is from the status JSON. mc-pick returns `{id, status, skill}` or `null`.

If null or tier is RED → skip to step 4 (report only).

## 3. DISPATCH

Spawn brain subagent: `/<skill> <id>`

Pass the item ID and the status JSON summary as context.
One item. One skill. No scope creep.

If the brain fails → post failure to Discord with the error.
Do NOT retry. The next hourly run will re-evaluate.

## 4. REPORT

Post one message to Discord:

    <tier_emoji> $X.XX/24h | Xd runway | N errors
    /<skill> on <id> — OR — no-op: <reason>

Write EDO if action taken (template: `/workspace/memory-templates/EDO.template.md`).

EXIT.
```

### Walk phase (future, NOT this PR)

- mc-pick.ts calls `adapter.claim(id, runId, command)` before dispatch
- mc-pick.ts checks `claimedByRun` to avoid double-dispatch
- Move mc-pick.ts to a proper `bin` in the work-items package
- Add stuck detection: if same item claimed 3 runs with same `lastCommand` → auto-block
- Richer gates: check firing alerts, error rate thresholds

### Run phase (future)

- mc-status.sh → mc-status.ts (full TypeScript controller)
- Budget signal injected as structured context per BATS pattern
- Reflection retrieval from completed items (per Reflexion research)

### Files

**Create:**

- `.openclaw/skills/mission-control/SKILL.md` — thin dispatch prompt (~30 lines)
- `.openclaw/skills/mission-control/mc-status.sh` — JSON financials/health/tier (~80 lines)
- `.openclaw/skills/mission-control/mc-pick.ts` — TypeScript work item selection via @cogni/work-items port (~60 lines)

**Modify:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — change `HEARTBEAT` → `/mission-control`

**Unchanged:**

- `.openclaw/skills/deployment-health/queries.sh` — mc-status.sh sources its helpers
- `packages/work-items/` — mc-pick.ts consumes its existing API, no changes needed
- `memory/EDO/` — used as-is for decision tracking

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] DETERMINISTIC_SELECTION: mc-pick.ts uses @cogni/work-items port, not markdown parsing
- [ ] THIN_PROMPT: SKILL.md is <40 lines. Agent receives pre-computed envelope, doesn't decide what to work on.
- [ ] DEGRADATION_LADDER: mc-pick.ts respects tier (GREEN=all, YELLOW=finish+triage, RED=null)
- [ ] FINISH_BEFORE_STARTING: status weight needs_merge(6) > needs_closeout(5) > ... > needs_triage(1)
- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes HEARTBEAT → /mission-control
- [ ] USES_EXISTING_GOVERNANCE_API: Credits from `/api/v1/governance/status`
- [ ] USES_EXISTING_EDO_TEMPLATE: Decision tracking via `memory-templates/EDO.template.md`
- [ ] NO_SHADOW_STATE: No WIP.md, no budget file writes, no parallel state
- [ ] ONE_FOCUS: Exactly 1 work item per run
- [ ] COST_DISCIPLINE: Only dispatch (step 3) is expensive. Steps 1-2 and 4 are deterministic.
- [ ] RUNTIME_CAPS: OpenClaw enforces timeoutSeconds:540, subagents.maxConcurrent:3
- [ ] NO_RETRY: Brain failure → report + exit. Next run re-evaluates fresh. No retry loops.

## Validation

- [ ] mc-status.sh returns valid JSON from gateway container (`| jq .`)
- [ ] mc-pick.ts returns correct item for each tier (GREEN picks any, YELLOW skips implement/design, RED returns null)
- [ ] mc-pick.ts finish-before-starting: needs_merge item picked over needs_implement when both exist
- [ ] mc-pick.ts uses @cogni/work-items adapter (no \_index.md parsing)
- [ ] SOUL.md routes HEARTBEAT to /mission-control
- [ ] Brain subagent receives item ID + lifecycle skill
- [ ] Discord message posted with tier emoji + cost + action
- [ ] Degradation: RED tier → report only, no dispatch
- [ ] No retry on brain failure — single attempt per run
