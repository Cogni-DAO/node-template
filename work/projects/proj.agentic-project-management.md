---
id: proj.agentic-project-management
type: project
primary_charter:
title: DAO Agentic Project Management
state: Active
priority: 0
estimate: 8
summary: "WorkItemPort with command/query separation, markdown adapter v0, agent-assignable work items, and external system linking — replacing direct frontmatter editing with structured port access"
outcome: "Agents and humans interact with work items through a typed port. Markdown remains source of truth (v0). Work items are assignable to users and agents via SubjectRef. External refs (PRs, commits, branches) are first-class. Dependencies are explicit relations. Status transitions are command-driven with optimistic concurrency."
assignees: derekg1729
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, governance, infrastructure]
---

# DAO Agentic Project Management

## Goal

Replace the current pattern of agents hand-editing YAML frontmatter with a structured `WorkItemPort` that models work items, relations, assignees, and external references as first-class domain concepts. Markdown files remain the canonical store (adapter v0), but all access goes through the port — enabling future adapters (DB, OpenProject, Plane) without rewriting agents.

The end state: users "claim" work items via the app UI, dispatch agents (Cogni, Claude Code, Codex) to execute them, and track progress through structured status transitions — not file diffs.

## Context

### What exists today

- Work items are `.md` files with YAML frontmatter in `work/items/`
- `src/lib/work-scanner.ts` — read-only filesystem scanner for the `/work` dashboard
- `scripts/validate-docs-metadata.mjs` — CI validation of frontmatter schema
- `services/scheduler-worker/src/enrichers/work-item-linker.ts` — regex extraction of work item IDs from PR metadata
- `docs/spec/development-lifecycle.md` — status-driven command dispatch spec
- `claimed_by_run` / `claimed_at` / `last_command` fields — governance runner locking (specced, not wired)

### What's broken

1. **Agents edit frontmatter directly** — race conditions, formatting drift, no concurrency control
2. **ID collisions** — `next-work-id.mjs` exists but isn't used programmatically (bug.0147 collision)
3. **No structured relations** — `blocked_by` is a CSV string, no first-class dependency graph
4. **PR linking is regex-only** — no enforcement, no bidirectional linking
5. **No agent assignment model** — `assignees` is `string[]` with no type, no identity binding
6. **No audit trail** — status changes only visible in git history

### Identity model alignment

Per `docs/spec/identity-model.md`, assignees must map to the **actor model**:

- `actor_id` (UUID) is the economic subject — earns, spends, gets attributed
- Actor kinds: `user | agent | system | org`
- `user` actors have 1:1 FK to `users.id`
- `agent` actors have optional `parent_actor_id` for hierarchy
- `@cogni/ids` exports branded `ActorId` / `UserId` types

The port's `SubjectRef` must align with actor kinds so that when the `actors` table lands (story.0117), assignment is a simple FK.

## Roadmap

### Crawl (P0) — WorkItemPort + Markdown Adapter

**Goal:** All agent work-item access goes through a typed port. Markdown remains source of truth. Zero external dependencies.

| Deliverable                                                                               | Status      | Est | Work Item             |
| ----------------------------------------------------------------------------------------- | ----------- | --- | --------------------- |
| `WorkItemQueryPort` interface in `packages/work-items/`                                   | Not Started | 1   | task.0149             |
| `WorkItemCommandPort` interface with optimistic concurrency                               | Not Started | 2   | task.0149             |
| `SubjectRef` type aligned with identity-model actor kinds                                 | Not Started | 1   | task.0149             |
| `ExternalRef` type (system + kind + url/id)                                               | Not Started | 0   | task.0149             |
| `WorkRelation` type with typed relation kinds                                             | Not Started | 0   | task.0149             |
| `MarkdownWorkItemAdapter` implementing both ports                                         | Not Started | 3   | (create at impl)      |
| Migrate `/implement`, `/triage`, `/closeout`, `/review-implementation` skills to use port | Not Started | 2   | (create at impl)      |
| Centralized ID allocation behind `create()`                                               | Not Started | 0   | (included in adapter) |
| Contract tests for port invariants                                                        | Not Started | 1   | (create at impl)      |

### Walk (P1) — Relations, External Refs, PR Linking

**Goal:** Dependencies are a first-class graph. PRs are linked automatically. Work items are queryable by relation.

| Deliverable                                                             | Status      | Est | Work Item            |
| ----------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Store `relations` and `external_refs` in frontmatter (not prose)        | Not Started | 1   | (create at P1 start) |
| `upsertRelation` / `removeRelation` commands                            | Not Started | 1   | (create at P1 start) |
| `upsertExternalRef` command (PR, branch, commit linking)                | Not Started | 1   | (create at P1 start) |
| GitHub webhook handler: auto-link PR → work item on PR creation         | Not Started | 2   | (create at P1 start) |
| `listRelations(id)` query with transitive dependency resolution         | Not Started | 1   | (create at P1 start) |
| CI gate: PR body must contain `WI: <id>` (enforcement of PR_LINKS_ITEM) | Not Started | 1   | (create at P1 start) |

### Run (P2) — Agent Dispatch + User Claiming

**Goal:** Users claim work items from the UI and dispatch agents to execute them. Agents report status back through the port.

| Deliverable                                                                      | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| `setAssignees` command with `SubjectRef` (user + agent kinds)                    | Not Started | 1   | (create at P2 start) |
| "Claim" UI: user selects work item → assigned to their actor                     | Not Started | 2   | (create at P2 start) |
| Agent dispatch: user picks agent runtime (Cogni/Claude/Codex) → spawns execution | Not Started | 3   | (create at P2 start) |
| Agent status reporting: `transitionStatus` called by agent on completion         | Not Started | 1   | (create at P2 start) |
| Governance runner uses port instead of filesystem scanning                       | Not Started | 2   | (create at P2 start) |
| Read model / index for fast queries (derived from markdown)                      | Not Started | 2   | (create at P2 start) |

### Sprint (P3) — Backend Migration + External Tracker Integration

**Goal:** Swap markdown adapter for DB or external tracker. Port contract unchanged.

| Deliverable                                               | Status      | Est | Work Item            |
| --------------------------------------------------------- | ----------- | --- | -------------------- |
| DB adapter (PostgreSQL + Drizzle, reusing existing infra) | Not Started | 3   | (create at P3 start) |
| OpenProject adapter (REST API, user mapping)              | Not Started | 3   | (create at P3 start) |
| Plane adapter (MCP server integration)                    | Not Started | 2   | (create at P3 start) |
| Markdown export from DB (for git-tracked audit trail)     | Not Started | 1   | (create at P3 start) |

## Port Design

### Core types

```typescript
// ── Identity ──────────────────────────────────────────
// Aligned with docs/spec/identity-model.md actor kinds
// and @cogni/ids branded types

type WorkItemId = string; // e.g., "task.0149", "bug.0148"
type Revision = string; // content hash or frontmatter version

type SubjectRef =
  | { kind: "user"; userId: string } // maps to users.id → actor_id (kind=user)
  | { kind: "agent"; agentId: string } // maps to future actors.id (kind=agent)
  | { kind: "system"; serviceId: string }; // maps to future actors.id (kind=system)

// ── External references ───────────────────────────────
// Backend-agnostic: works with GitHub, GitLab, Plane, OpenProject

type ExternalRef = {
  system: string; // "github" | "gitlab" | "plane" | "openproject" | ...
  kind: string; // "pull_request" | "issue" | "branch" | "commit" | "url" | ...
  externalId?: string;
  url?: string;
  title?: string;
};

// ── Relations ─────────────────────────────────────────

type RelationType =
  | "blocks"
  | "blocked_by"
  | "depends_on"
  | "parent_of"
  | "child_of"
  | "relates_to"
  | "duplicates";

type WorkRelation = {
  fromId: WorkItemId;
  toId: WorkItemId;
  type: RelationType;
};

// ── Work item ─────────────────────────────────────────

type WorkItem = {
  id: WorkItemId;
  type: "task" | "bug" | "story" | "spike" | "subtask";
  title: string;
  status: string; // status enum from development-lifecycle.md
  priority?: number;
  rank?: number;
  estimate?: number;
  summary?: string;
  outcome?: string;
  projectId?: WorkItemId; // ref to proj.* item
  parentId?: WorkItemId;
  assignees: SubjectRef[];
  externalRefs: ExternalRef[];
  labels: string[];
  fields: Record<string, unknown>; // remaining frontmatter (spec_refs, etc.)
  revision: Revision;
  createdAt: string;
  updatedAt: string;
};
```

### Query port

```typescript
type WorkQuery = {
  ids?: WorkItemId[];
  types?: string[];
  statuses?: string[];
  assignee?: SubjectRef;
  projectId?: WorkItemId;
  relatedTo?: WorkItemId;
  text?: string;
  limit?: number;
  cursor?: string;
};

interface WorkItemQueryPort {
  get(id: WorkItemId): Promise<WorkItem | null>;
  list(query?: WorkQuery): Promise<{ items: WorkItem[]; nextCursor?: string }>;
  listRelations(id: WorkItemId): Promise<WorkRelation[]>;
}
```

### Command port

```typescript
interface WorkItemCommandPort {
  create(input: {
    type: string;
    title: string;
    summary?: string;
    outcome?: string;
    projectId?: WorkItemId;
    parentId?: WorkItemId;
    fields?: Record<string, unknown>;
    assignees?: SubjectRef[];
  }): Promise<WorkItem>;

  patch(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    set?: Partial<
      Pick<
        WorkItem,
        "title" | "summary" | "outcome" | "estimate" | "priority" | "rank"
      >
    >;
    fields?: Record<string, unknown>;
  }): Promise<WorkItem>;

  transitionStatus(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    toStatus: string;
    reason?: string;
  }): Promise<WorkItem>;

  setAssignees(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    assignees: SubjectRef[];
  }): Promise<WorkItem>;

  upsertRelation(rel: WorkRelation): Promise<void>;
  removeRelation(rel: {
    fromId: WorkItemId;
    toId: WorkItemId;
    type: RelationType;
  }): Promise<void>;

  upsertExternalRef(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    ref: ExternalRef;
  }): Promise<WorkItem>;
}
```

### Markdown adapter v0

- **Source of truth**: `work/items/*.md` and `work/projects/*.md`
- **Revision**: SHA-256 of raw frontmatter YAML (not file content — body is documentation, not state)
- **Concurrency**: optimistic — `expectedRevision` checked before write; reject on mismatch
- **ID allocation**: atomic counter via `next-work-id.mjs` logic, called inside `create()`
- **Relations**: stored in frontmatter as `relations: [{to: "task.0042", type: "blocks"}]`
- **External refs**: stored in frontmatter as `external_refs: [{system: "github", kind: "pull_request", url: "..."}]`
- **Validation**: adapter calls existing validator logic on write (schema enforcement)

## Constraints

- Port interfaces live in a pure package (`packages/work-items/`) — no I/O, no framework deps
- Markdown adapter lives in `packages/db-client/` or a new `packages/work-items-md/` adapter package
- `SubjectRef.userId` must be compatible with `@cogni/ids` `UserId` branded type
- Status transitions must respect `docs/spec/development-lifecycle.md` state machine
- No external PM tool dependency in P0-P2 (OpenProject/Plane are P3 adapters)
- `claimed_by_run` / `claimed_at` locking moves into the port as a first-class concept

## Dependencies

- [x] Identity model spec (`docs/spec/identity-model.md`)
- [x] Development lifecycle spec (`docs/spec/development-lifecycle.md`)
- [x] Existing validator (`scripts/validate-docs-metadata.mjs`)
- [x] Work scanner (`src/lib/work-scanner.ts`)
- [ ] Actor table (story.0117) — P2 dependency for typed agent assignment
- [ ] GitHub webhook infrastructure — P1 dependency for PR auto-linking

## Relationship to Existing Projects

- **Supersedes P3 of `proj.docs-system-infrastructure`** — the Plane/external-tracker integration moves here. The docs-system project keeps P0-P2 (validator, Fumadocs, branch preview).
- **Depends on `story.0117` (actor billing model)** — P2 agent dispatch needs actor_id for assignment. P0-P1 can use string-based SubjectRef without the DB table.
- **Feeds `proj.development-workflows`** — the governance runner dispatch loop becomes a port consumer.

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

**Why not DB-first:** The markdown system works. 164 work items, CI-validated, git-tracked diffs. The pain is programmatic access, not storage. A port in front of markdown gives us structured access now and adapter-swappability later without a migration.

**Why command/query separation:** The reviewer is right — `update(id, patch)` is too blunt. `transitionStatus` can enforce the state machine. `setAssignees` can validate SubjectRef kinds. `upsertExternalRef` can normalize URLs. Commands carry invariants; patches don't.

**Why not OpenProject now:** OpenProject is a full Rails monolith (PostgreSQL + Redis + memcached + background workers). The integration tax exceeds the value at 1-2 active contributors. The port design makes it a future adapter without commitments now.

**SubjectRef vs ActorId:** P0 uses `SubjectRef` (kind + string ID) because the `actors` table doesn't exist yet. When story.0117 lands, `SubjectRef` resolves to `actor_id` FK. The port contract doesn't change — only the adapter's resolution logic.

**Frontmatter evolution:** Relations and external_refs are new structured frontmatter fields. The validator needs updating to accept them. Existing items without these fields are valid (empty defaults).
