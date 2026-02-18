---
id: story.0089
type: story
title: Integrate Lenzy for AI agent conversation analytics
status: needs_triage
priority: 1
estimate: 3
summary: Integrate Lenzy AI Agent Intelligence platform to analyze conversations between users and AI agents, gaining insights into user frustrations, sentiment, churn signals, and custom metrics.
outcome: Lenzy dashboard provides actionable insights into AI agent performance, user satisfaction, and friction points; integration is live for at least one major agent channel (OpenClaw gateway).
spec_refs:
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-18
updated: 2026-02-18
labels: [analytics, lenzy, ai-agent, observability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 30
---

# Integrate Lenzy for AI Agent Conversation Analytics

## Context

Cogni's AI agents (OpenClaw gateway, sandboxed agents) interact with users via chat interfaces, but we lack visibility into the quality of these conversations. Without conversation analytics, we cannot systematically identify where users struggle, measure sentiment, detect churn signals, or track custom business metrics.

Lenzy is an AI Agent Intelligence platform that specializes in analyzing conversations between users and AI agents. It automatically detects user frustrations, tracks satisfaction shifts, identifies churn risks, and provides custom insights via an easy‑to‑integrate SDK.

**Why Lenzy?**
- Purpose‑built for AI agent conversations (not generic chat analytics)
- Real‑time detection of frustration points and satisfaction trends
- Churn signal alerts with automated intervention workflows
- Custom metric definitions for business‑specific insights
- Simple SDK integration with minimal overhead

This story focuses on integrating Lenzy into our agent runtime pipeline, starting with the OpenClaw gateway as the first data source, and establishing a foundation for broader agent coverage.

### Who benefits

- **Product team**: Understand user pain points and prioritize improvements
- **Engineering**: Identify recurring failure patterns in agent responses
- **Support**: Proactively reach out to dissatisfied users
- **Community**: Higher satisfaction through data‑driven iteration

## Requirements

### 1. Lenzy account and configuration
- Create a Lenzy account (free tier) for the Cogni organization
- Define initial custom metrics relevant to our agents (e.g., “tool execution errors”, “context window exhaustion”, “user intent mismatch”)
- Configure alert destinations (Slack, email) for churn signals and high‑frustration spikes

### 2. SDK integration
- Add Lenzy SDK (`@lenzy/agent`) to the OpenClaw gateway container
- Instrument the gateway’s chat handler to send conversation events to Lenzy
- Include metadata: agent ID, user ID (anonymized), conversation thread, timestamp, message direction, tool calls/results
- Ensure no PII leakage — anonymize user identifiers per our privacy policy

### 3. Data pipeline validation
- Verify that conversation events are received and appear in the Lenzy dashboard
- Confirm that frustration detection, sentiment tracking, and custom metrics are working
- Test that alerts fire when simulated frustration triggers are met

### 4. Dashboard access and training
- Grant dashboard access to relevant team members
- Document how to interpret Lenzy reports and act on insights
- Create a runbook for responding to churn alerts

### 5. Expansion plan
- Outline steps to extend Lenzy instrumentation to other agent channels (sandboxed agents, Discord bridge, etc.)
- Define success criteria for the MVP (e.g., “90% of OpenClaw gateway conversations are tracked”)

### Non‑goals for MVP
- Real‑time intervention automation (can be a follow‑on story)
- Historical backfill of pre‑integration conversations
- Replacing existing usage/activity metrics (Lenzy is complementary)

## Allowed Changes

- OpenClaw gateway Dockerfile and dependency list
- Gateway chat handler (`src/adapters/server/ai/openclaw/...`)
- Environment variables for Lenzy API key and configuration
- Documentation (`/docs/analytics/lenzy.md`) for setup and usage
- Alerting configuration (Slack webhook, email lists)
- No changes to billing, core agent logic, or user‑facing APIs

## Plan

- [ ] spike.0090 — research Lenzy SDK capabilities, pricing, and integration effort
- [ ] Create Lenzy account and configure initial project
- [ ] Add Lenzy SDK to gateway container (`Dockerfile.gateway`)
- [ ] Instrument gateway chat handler to send events
- [ ] Deploy to staging and verify data flows
- [ ] Set up dashboards and alerts
- [ ] Document integration and train team members
- [ ] Monitor for one week and gather initial insights

## Validation

**Command:**

```bash
# Run integration tests for Lenzy instrumentation
pnpm test -- --grep "lenzy"

# Check that environment variables are present
grep LENZY_ .env.example
```

**Expected:**

- Lenzy SDK is listed in `package.json` of the gateway service
- Gateway container builds without errors
- Integration tests pass (mocked Lenzy API)
- No PII is logged in test conversations
- Lenzy dashboard shows real conversation events from staging

## Review Checklist

- [ ] **Work Item:** `story.0089` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- [Lenzy website](https://lenzy.ai)
- Related: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
- Related: [proj.observability-hardening](../projects/proj.observability-hardening.md)

## Attribution

- derekg1729 (idea)