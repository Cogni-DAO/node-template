---
id: story.0089
type: story
title: Governance run status summaries in Discord
status: needs_triage
priority: 1
rank: 99
estimate: 2
summary: Post a summary of each scheduled governance run to a dedicated Discord channel for increased transparency.
outcome: The community can see what the AI governance council is doing without checking raw logs.
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-18
updated: 2026-02-18
labels: [governance, transparency, discord]
external_refs:
---

# Governance run status summaries in Discord

## Requirements

- **Intention**: Governance run results are currently only visible in logs — the community has no easy way to see what the AI council decided.
- **Problem**: Lack of transparency for community members regarding automated governance decisions.
- **Who benefits**: Community members who want transparency into DAO governance without reading raw logs.
- **Success**: A dedicated Discord channel that receives a summary (decision, rationale, status) after each governance run.

## Allowed Changes

- Backend services managing governance runs
- Discord integration components
- Notification routing logic

## Plan

- [ ] Identify the triggers for governance run completion.
- [ ] Implement a formatter for governance run summaries.
- [ ] Route summaries to the designated Discord channel via OpenClaw.

## Validation

**Test Case:**

1. Trigger a scheduled governance run.
2. Verify that a summary appears in the specified Discord channel.

## Review Checklist

- [ ] **Work Item:** `story.0089` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- @derekg1729
