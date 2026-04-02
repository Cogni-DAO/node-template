---
id: task.0260
type: task
title: "Node creation orchestration — chat-native guided flow with HIL"
status: needs_design
priority: 1
rank: 2
estimate: 8
summary: "Unified chat experience for creating a new Cogni node. Operator AI guides human through intake, identity, DAO formation (inline wallet signing), scaffolding, branding, PR, and DNS — all in one thread. Uses HIL interrupt/resume for human checkpoints. Deprecates legacy /setup/dao wizard page."
outcome: "User says 'create a new node' in chat → AI walks them through identity → inline DAO formation with wallet signing → autonomous scaffolding + branding → PR created → DNS configured. Zero page navigation."
spec_refs:
  - docs/spec/node-formation.md
  - docs/spec/human-in-the-loop.md
  - docs/spec/multi-node-tenancy.md
assignees:
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [ai, ui, nodes, hil, formation]
external_refs:
---

# Node Creation Orchestration — Chat-Native Guided Flow

## Context

Creating a new Cogni node today is fragmented: fill a form on `/setup/dao`, copy YAML to clipboard, manually edit files, run scripts, create a PR, set up DNS. The legacy wizard page is a dead-end — it outputs YAML, shows "Done", and stops.

The vision: a **single chat thread** where the operator AI guides the human through every step. The AI pre-fills, suggests, and executes. The human confirms, signs wallet transactions inline, and reviews. No page navigation. No copy-paste.

## What Exists Today

| Component | Status | Location |
|-----------|--------|----------|
| DAO formation reducer (9-phase FSM) | Working, reusable | `features/setup/daoFormation/formation.reducer.ts` |
| Transaction builders | Working, reusable | `features/setup/daoFormation/txBuilders.ts` |
| wagmi formation hook | Working, reusable | `features/setup/hooks/useDAOFormation.ts` |
| Server verification endpoint | Working, reusable | `app/api/setup/verify/route.ts` |
| HIL pause/resume spec | Designed, not wired | `docs/spec/human-in-the-loop.md` |
| Operator AI tools (VCS, repo, work items) | Working | `packages/ai-tools/src/tools/` |
| assistant-ui custom tool renderers | Available, not used | `MessagePrimitive.Parts` components map |
| Wagmi/RainbowKit in chat context | Available (global provider) | `app/providers/wallet.client.tsx` |
| new-node skill (Claude Code v0) | Working | `.claude/skills/new-node/SKILL.md` |

The formation logic is **pure and reusable** — reducer, tx builders, hooks, and verification are all independent of the wizard page. They can be wrapped in a chat-inline tool renderer component with zero changes.

## Design

### The Experience

```
User: "I want to create a new node for restaurant reservations"

AI: [conversational intake — asks about mission, community, AI needs]
AI: "Here's what I'd suggest:"
    [renders: IdentityProposalCard]
    ┌──────────────────────────────────────────────────┐
    │  Name: resy                                       │
    │  Mission: AI-powered restaurant reservations      │
    │  Icon: UtensilsCrossed  │  Hue: 25° (amber)     │
    │  ────────────────────────────────────────────     │
    │  DAO Token: "Resy Governance" (RESY)              │
    │  ⚠ Token name + symbol can be changed later.     │
    │  All other fields are immutable after formation.  │
    │                                                   │
    │  [Edit Fields]  [Confirm →]                       │
    └──────────────────────────────────────────────────┘

User: [confirms]

AI: "Connect your wallet and sign to create the DAO."
    [renders: DAOFormationCard — pre-filled, inline wallet signing]
    ┌──────────────────────────────────────────────────┐
    │  Creating Resy DAO                                │
    │  Chain: Base  │  Token: RESY  │  Holder: 0x...   │
    │                                                   │
    │  Step 1/2: Create DAO ........... ✓ confirmed     │
    │  Step 2/2: Deploy Signal ........ ⏳ sign now     │
    │                                                   │
    │  [Sign in Wallet]                                 │
    └──────────────────────────────────────────────────┘

AI: "DAO created. Building the node now..."
    → [autonomous: branch, copy template, rename, wire env, provision DB]
    → [autonomous: branding — icon, colors, metadata, homepage]
    → [autonomous: create brain graph + system prompt]
    "PR ready for review."
    [renders: PRReviewCard — diff summary, link]

User: [reviews, approves]

AI: → [autonomous: DNS creation]
    [renders: NodeSummaryCard — final status]
```

### Architecture

```
┌──────────────────────────────────────┐
│  node-creator graph (LangGraph)      │
│  ReAct agent + HIL interrupts        │
├──────────────────────────────────────┤
│ Phase 1-2: Intake + Identity         │ ← multi-turn conversation
│   → interrupt: identity_proposal     │ ← renders IdentityProposalCard
│ Phase 3: DAO Formation               │
│   → interrupt: dao_formation         │ ← renders DAOFormationCard
│ Phase 4-7: Scaffolding + Branding    │ ← autonomous (VCS + repo tools)
│ Phase 8: PR                          │
│   → interrupt: pr_review             │ ← renders PRReviewCard
│ Phase 9: DNS                         │ ← autonomous (dns-ops tools)
└──────────────────────────────────────┘
          ↕ stateKey (thread persistence)
┌──────────────────────────────────────┐
│  Chat UI (assistant-ui)              │
│  Custom tool renderers:              │
│   • IdentityProposalCard             │
│   • DAOFormationCard                 │
│   • PRReviewCard                     │
│   • NodeSummaryCard                  │
└──────────────────────────────────────┘
```

### Three HIL Interrupt Kinds

| Kind | Renders | Human Action | Resume Data |
|------|---------|--------------|-------------|
| `identity_proposal` | Editable card: name, icon, hue, mission, tokenName, tokenSymbol | Confirm or edit | `{ name, icon, hue, mission, tokenName, tokenSymbol, initialHolder }` |
| `dao_formation` | Pre-filled formation card with inline wallet signing | Sign 2 transactions | `{ repoSpecYaml, addresses, chainId }` |
| `pr_review` | PR summary with diff stats + link | Approve or request changes | `{ approved: boolean, feedback?: string }` |

### Identity Proposal — Mutability Note

In the identity proposal, all fields become immutable after DAO formation **except**:
- `tokenName` — can be updated via governance proposal
- `tokenSymbol` — can be updated via governance proposal

The node name, icon, hue, and mission are baked into code and branding. Token name/symbol are on-chain governance metadata. The UI should clearly communicate this distinction.

### DAOFormationCard — Reuses Existing Logic

The card wraps the same pure modules the legacy wizard uses:

| Module | What it does | Changes needed |
|--------|-------------|----------------|
| `formation.reducer.ts` | 9-phase FSM | None |
| `txBuilders.ts` | Transaction argument construction | None |
| `useDAOFormation.ts` | wagmi hook integration | None |
| `api.ts` | Server verification call | None |
| `FormationFlowDialog.tsx` | Modal status display | **Replace** — inline card instead of modal |

New component: `features/ai/components/tools/DAOFormationCard.tsx`
- Renders inline in chat thread (not a modal)
- Uses `useDAOFormation()` hook directly (wagmi already in provider tree)
- Shows transaction progress as inline steps
- On success: returns `repoSpecYaml` + `addresses` as resume data

### v2: Governance Templates

The AI proposes governance configurations for the IdentityProposalCard:

| Template | Token Supply | Allocation | Voting | Best For |
|----------|-------------|------------|--------|----------|
| Standard DAO | 1M | 100% founder | Simple majority, 1h min | Solo founders, MVPs |
| Multi-Holder | 1M | 50% founder / 30% treasury / 20% contributors | Weighted, 3-day timelock | Teams, communities |
| Research Collective | 1M | 40% treasury / 30% founder / 30% contributor pool | Quadratic, 7-day min | DAOs, research orgs |

Templates are data-driven config — no code changes per template.

## Phased Delivery

### P0 (Crawl) — Chat-native formation + scaffolding

1. `node-creator` graph in operator catalog with HIL interrupt points
2. `DAOFormationCard` tool renderer (reuses existing formation pure logic)
3. Wire HIL into operator chat flow (first real use of the pause/resume spec)
4. AI executes scaffolding phases autonomously via VCS + repo tools
5. Basic `NodeSummaryCard` for completion

### P1 (Walk) — Rich UI + automation

6. `IdentityProposalCard` with editable fields + icon/hue preview
7. `PRReviewCard` with diff summary + inline approve/reject
8. Governance templates (v2 multi-holder, research collective)
9. External AI agent support (same chat API, programmatic resume)
10. Deprecate `/setup/dao` wizard page (redirect to chat)

### P2 (Run) — Full automation

11. Payment activation inline (extends formation flow)
12. Auto-merge on approval (PR Manager integration)
13. Production deployment trigger (requires task.0247 CI/CD)

## Blocked By

- **HIL integration** — spec exists (`docs/spec/human-in-the-loop.md`), not wired into any graph yet. This task is the first consumer.
- **task.0247** — CI/CD for production deployment of created nodes (P2 only)

## Key Files

### Create

| File | Purpose |
|------|---------|
| `packages/langgraph-graphs/src/graphs/operator/node-creator/` | Graph factory + prompts |
| `apps/operator/src/features/ai/components/tools/DAOFormationCard.tsx` | Inline formation renderer |
| `apps/operator/src/features/ai/components/tools/IdentityProposalCard.tsx` | Identity proposal renderer |
| `apps/operator/src/features/ai/components/tools/PRReviewCard.tsx` | PR review renderer |
| `apps/operator/src/features/ai/components/tools/NodeSummaryCard.tsx` | Completion summary |

### Modify

| File | Change |
|------|--------|
| `packages/langgraph-graphs/src/catalog.ts` | Add node-creator graph to catalog |
| `apps/operator/src/components/vendor/assistant-ui/thread.tsx` | Register tool renderers in `MessagePrimitive.Parts` |
| `apps/operator/src/bootstrap/ai/tool-bindings.ts` | Bind tools for node-creator graph |

### Reuse (no changes)

| File | What |
|------|------|
| `features/setup/daoFormation/formation.reducer.ts` | 9-phase FSM |
| `features/setup/daoFormation/txBuilders.ts` | Transaction argument builders |
| `features/setup/hooks/useDAOFormation.ts` | wagmi wiring |
| `features/setup/daoFormation/api.ts` | Server verification client |
| `app/api/setup/verify/route.ts` | Server verification endpoint |

## Validation

- [ ] "Create a new node" in chat → AI asks intake questions → proposes identity
- [ ] Identity proposal card renders with editable fields, mutability warning
- [ ] DAO formation card renders inline, wallet signing works without page navigation
- [ ] Scaffolding executes autonomously (branch, copy, rename, wire, provision)
- [ ] PR created via VCS tools, summary rendered in chat
- [ ] DNS configured, final summary card shown
- [ ] Thread persistence: can resume partially completed node creation

## Related

- [Node Formation Spec](../../docs/spec/node-formation.md) — DAO formation design
- [Human-in-the-Loop Spec](../../docs/spec/human-in-the-loop.md) — pause/resume contract
- [new-node skill](../../.claude/skills/new-node/SKILL.md) — Claude Code v0 (manual orchestration)
- [Creating a New Node Guide](../../docs/guides/creating-a-new-node.md) — technical scaffolding steps
