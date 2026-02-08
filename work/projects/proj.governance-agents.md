---
work_item_id: proj.governance-agents
work_item_type: project
primary_charter:
title: Governance Agents — Signal Infrastructure & Incident-Gated AI
state: Active
priority: 2
estimate: 5
summary: Build signal ingestion, brief generation, incident routing, and LLM governance agent execution on Temporal
outcome: Autonomous incident-gated governance agents producing cited EDOs with human review via Plane
assignees: derekg1729
created: 2026-02-07
updated: 2026-02-07
labels: [governance, temporal, ai-agents]
---

# Governance Agents — Signal Infrastructure & Incident-Gated AI

> Source: docs/AI_GOVERNANCE_DATA.md (roadmap content extracted during docs migration)

## Goal

Build the full governance data pipeline: CloudEvents signal ingestion, budget-enforced brief generation, incident-gated LLM agent execution, and human review queue — all orchestrated by Temporal.

## Roadmap

### Crawl (P0) — Signal Infrastructure Foundation

**Goal:** Signal ingest, first source adapter, collection workflow.

| Deliverable                                                    | Status      | Est | Work Item |
| -------------------------------------------------------------- | ----------- | --- | --------- |
| Deploy Temporal governance namespace + worker                  | Not Started | 2   | —         |
| `signal_events` table with CloudEvents schema                  | Not Started | 1   | —         |
| `stream_cursors` table (adapter cursor persistence)            | Not Started | 1   | —         |
| `governance_briefs` table                                      | Not Started | 1   | —         |
| `incidents` table with fingerprint-based incident_key          | Not Started | 1   | —         |
| `incident_evidence` join table (N=100 cap)                     | Not Started | 1   | —         |
| `governance_edos` table with brief_id, cited_signals           | Not Started | 1   | —         |
| `SignalWritePort` + `DrizzleSignalWriteAdapter`                | Not Started | 2   | —         |
| `SignalReadPort` + `DrizzleSignalReadAdapter`                  | Not Started | 2   | —         |
| Idempotent upsert + CloudEvents/provenance validation          | Not Started | 1   | —         |
| `packages/data-sources/` structure + `SourceAdapter` interface | Not Started | 1   | —         |
| `PrometheusAdapter` with `alerts` stream                       | Not Started | 2   | —         |
| `CollectSourceStreamWorkflow` + activities                     | Not Started | 2   | —         |
| Temporal Schedule for Prometheus collection (every 5m)         | Not Started | 1   | —         |
| Integration test: Schedule → Workflow → ingest → query         | Not Started | 2   | —         |

**Chores (P0):**

- [ ] Add `governance.*` events to EVENT_NAMES
- [ ] Document SourceAdapter pattern in `packages/data-sources/README.md`
- [ ] Document Temporal workflow patterns in `packages/governance-workflows/README.md`

**File Pointers (P0 Scope):**

**Schema & Ports:**

| File                                          | Change                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/shared/db/schema.governance.ts`          | New: signal_events, stream_cursors, briefs, incidents, incident_evidence, edos |
| `src/ports/governance/signal-event.ts`        | New: SignalEvent type                                                          |
| `src/ports/governance/signal-write.port.ts`   | New: SignalWritePort                                                           |
| `src/ports/governance/signal-read.port.ts`    | New: SignalReadPort                                                            |
| `src/ports/governance/brief.port.ts`          | New: GovernanceBriefPort                                                       |
| `src/ports/governance/incident-store.port.ts` | New: IncidentStorePort                                                         |
| `src/bootstrap/capabilities/metrics.ts`       | Existing: Add governance rate limit config                                     |
| `src/ports/governance/edo-store.port.ts`      | New: GovernanceEdoPort                                                         |

**Adapters:**

| File                                                             | Change                       |
| ---------------------------------------------------------------- | ---------------------------- |
| `src/adapters/server/governance/drizzle-signal-write.adapter.ts` | New                          |
| `src/adapters/server/governance/drizzle-signal-read.adapter.ts`  | New                          |
| `packages/data-sources/types.ts`                                 | New: SourceAdapter interface |
| `packages/data-sources/prometheus/adapter.ts`                    | New: first adapter           |
| `packages/data-sources/README.md`                                | New: adapter dev guide       |

**Temporal Workflows & Activities:**

| File                                                                   | Change                            |
| ---------------------------------------------------------------------- | --------------------------------- |
| `packages/governance-workflows/src/workflows/collect-source-stream.ts` | New: CollectSourceStreamWorkflow  |
| `packages/governance-workflows/src/workflows/incident-router.ts`       | New: IncidentRouterWorkflow (P2)  |
| `packages/governance-workflows/src/workflows/governance-agent.ts`      | New: GovernanceAgentWorkflow (P2) |
| `packages/governance-workflows/src/activities/collect-signals.ts`      | New: collectSignalsActivity       |
| `packages/governance-workflows/src/activities/ingest-signals.ts`       | New: ingestSignalsActivity        |
| `packages/governance-workflows/src/worker.ts`                          | New: Temporal worker entry        |
| `packages/governance-workflows/README.md`                              | New: workflow patterns            |

**Infrastructure:**

| File                                                     | Change                      |
| -------------------------------------------------------- | --------------------------- |
| `platform/infra/services/runtime/docker-compose.dev.yml` | Add: Temporal server        |
| `platform/infra/temporal/`                               | New: Temporal configuration |

### Walk (P1) — Brief Generation + Metrics + Additional Sources

**Goal:** Budget-enforced brief generation, governed metrics access, more source adapters.

| Deliverable                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------ | ----------- | --- | -------------------- |
| `GovernanceBriefPort` implementation with budget enforcement | Not Started | 3   | (create at P1 start) |
| Diff computation from previous brief                         | Not Started | 2   | (create at P1 start) |
| Citation requirement enforcement                             | Not Started | 1   | (create at P1 start) |
| Dropped reason accounting                                    | Not Started | 1   | (create at P1 start) |
| Governance rate limits in `MetricsCapability` wrapper        | Not Started | 1   | (create at P1 start) |
| Per-run tool call budget for graph executor config           | Not Started | 1   | (create at P1 start) |
| `GitHubAdapter` (prs, issues, actions streams)               | Not Started | 3   | (create at P1 start) |
| `LiteLLMAdapter` (spend stream)                              | Not Started | 2   | (create at P1 start) |
| `LokiAdapter` (error fingerprints only)                      | Not Started | 2   | (create at P1 start) |
| Temporal Schedules for each adapter                          | Not Started | 1   | (create at P1 start) |
| pgvector embeddings on briefs + EDOs for similarity search   | Not Started | 3   | (create at P1 start) |

**P1 Backlog Items:**

**P1-ADAPTER-VERSIONING:**

- Define N=1 compatibility (current + previous version only)
- `producer_version` already stored on events
- Migration strategy: admin CLI command for reprocessing, not automatic

**P1-TRIGGER-PRIORITY:**

- Refine priority based on incident lifecycle transitions (open/escalate/resolve)
- Current: immediate path for high-severity signals
- Future: immediate only for state transitions, not raw signal ingestion

**P1-THRESHOLDS-INTERNAL:**

- Internal threshold rules via `guardrail_thresholds` table (if external alerts insufficient)
- Removed from MVP per P0-DETECTION-SOURCE decision
- Only implement if Prometheus/Alertmanager rules prove inadequate

**P1-PORT-UNIFICATION:**

- Unify metrics querying behind single MetricsQueryPort via policy catalogs
- Public analytics catalog vs governance catalog (same port, different policies)
- No parallel ports; use policy wrappers on existing `src/ports/metrics-query.port.ts`

**P1-RATE-LIMITING:**

- Add per caller/tenant rate limiting to MetricsQueryPort
- Gap identified in P0-METRICS-BUDGETS; other budgets already enforced

**P1-METRICS-PORT-REFACTOR:**

- [ ] Split `MetricsQueryPort` into `InternalPrometheusQueryPort` (raw, adapter-only) and `GovernedMetricsQueryPort` (template-only, tools/agents)
- [ ] Normalize timestamp types (Date vs ISO string) across port interfaces
- [ ] Normalize error contract: return domain errors or Result type, not adapter-specific exceptions
- Currently mitigated by P0 runtime guard (TOOLS_TEMPLATE_ONLY invariant)

### Run (P2+) — Incident-Gated Agent Execution

**Goal:** Incident router + governance agent workflow with human review.

| Deliverable                                                                    | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| `IncidentRouterWorkflow` (correlates alert signals → incidents)                | Not Started | 3   | (create at P2 start) |
| `queryAlertSignalsActivity` (SignalReadPort, filter prometheus.alert.\*)       | Not Started | 1   | (create at P2 start) |
| `upsertIncidentActivity` (IncidentStorePort)                                   | Not Started | 1   | (create at P2 start) |
| Temporal Schedule: every 1-5m per scope                                        | Not Started | 1   | (create at P2 start) |
| `GovernanceAgentWorkflow` (brief → LLM → EDO → work item)                      | Not Started | 3   | (create at P2 start) |
| `checkCooldownActivity`, `generateBriefActivity`, `runGovernanceGraphActivity` | Not Started | 2   | (create at P2 start) |
| `appendEdoActivity`, `createWorkItemActivity`, `markBriefedActivity`           | Not Started | 2   | (create at P2 start) |

### P3: Future (Do NOT Build Preemptively)

| Deliverable                                              | Status      | Est | Work Item            |
| -------------------------------------------------------- | ----------- | --- | -------------------- |
| Approval-to-execute pipeline                             | Not Started | 3   | (create at P3 start) |
| KPI governance loop (weekly Schedule)                    | Not Started | 2   | (create at P3 start) |
| Baseline deviation detection (replace static thresholds) | Not Started | 3   | (create at P3 start) |

## Constraints

- TRIGGERS_ARE_SIGNALS: All external triggers normalize to CloudEvents via SignalWritePort
- BUDGET_ENFORCED: Brief generation enforces maxItemsTotal and per-domain caps
- CITATIONS_REQUIRED: Every BriefItem cites SignalEvent.id(s)
- INCIDENT_GATES_AGENT: LLM agent runs ONLY on incident lifecycle events
- HUMAN_REVIEW_REQUIRED_MVP: All proposed actions go to human review (Plane via MCP)
- SYSTEM_TENANT_EXECUTION: Governance runs execute as cogni_system tenant

## Dependencies

- [x] Temporal OSS deployment (docker-compose)
- [x] MetricsQueryPort + MimirMetricsAdapter (existing)
- [x] GraphExecutorPort (existing)
- [ ] Plane MCP Server (for work items)

## As-Built Specs

- [AI Governance Data Spec](../../docs/spec/ai-governance-data.md) — Core invariants, schema, ports, architecture

## Design Notes

**Metrics Access — P0 Additions for Governance (capability layer):**

| Budget             | Where to enforce            | Implementation                                |
| ------------------ | --------------------------- | --------------------------------------------- |
| Rate limit per run | `MetricsCapability` wrapper | Max N queries per governance run              |
| Max wall time      | `GovernanceAgentWorkflow`   | Activity timeout on graph execution           |
| Max tool calls     | Tool runner config          | Cap `core__metrics_query` calls per graph run |

**MVP Detection Decision:** Prometheus/Alertmanager is the single source of truth for detection in MVP. The router correlates `prometheus.alert.firing` and `prometheus.alert.resolved` SignalEvents into incident lifecycle transitions. No internal threshold evaluation. Internal threshold rules (guardrail_thresholds table) moved to P1 backlog.

**MVP Trigger Sources (P0):** Limit to 3 sources: (1) CI e2e fail, (2) prod error-rate alert, (3) LiteLLM spend spike OR Plane `needs-governance` label.

**Known Issues:**

- [ ] Rate limiting per run/tenant not yet implemented in MimirMetricsAdapter (P1-RATE-LIMITING)
