---
id: story.0090
type: story
title: Governance run status updates via Discord channel
status: needs_triage
priority: 1
estimate: 2
summary: Post real-time status updates and summaries for governance runs to a dedicated Discord channel for increased transparency.
outcome: Community members can follow AI governance decisions and status directly in Discord.
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-18
updated: 2026-02-18
labels: [governance, discord, transparency]
external_refs:
---

# Governance run status updates via Discord channel

## Requirements

- **Intention**: Providing a dedicated, persistent channel for the community to witness AI governance runs in real-time.
- **Problem**: Governance runs are opaque to the community, and status updates are difficult to find without specialized access or searching logs.
- **Who benefits**: Community members, DAO stakeholders, and developers who need to stay informed on governance outcomes.
- **Success**: A dedicated Discord channel exists that receives notifications when a governance run begins, makes significant progress, or finishes with a decision.

## Allowed Changes

- Governance run orchestration logic
- Discord gateway/integration
- Reporting and notification system

## Plan

- [ ] Identify key events in the governance run lifecycle (Start, Decision, Completion).
- [ ] Implement event triggers and formatting for Discord messages.
- [ ] Connect the governance service to the Discord output worker.

## Validation

**Test Case:**

1. Start a governance run manually or via schedule.
2. Verify that the Discord bot posts corresponding status updates in the configured channel.

## Review Checklist

- [ ] **Work Item:** `story.0090` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- @derekg1729
