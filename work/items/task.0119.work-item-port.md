---
id: task.0119
type: task
title: "WorkItemPort — standardized work-item access for app, agents, and scoring"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Extract work-item access into a proper port/adapter pattern. V0 adapter reads .md files (refactors existing work-scanner.ts). Enables DB-backed V1 adapter with zero consumer changes. Shared types in a new `@cogni/work-items-core` package so scheduler-worker, ledger scoring, and app UI all use the same interface."
outcome: "All consumers (app UI, agents, scheduler-worker, scoring engine) access work items through `WorkItemPort`. Swapping from .md files to DB requires only a new adapter. Existing `/work` page uses the port. Package importable by `services/` for scoring use."
spec_refs: architecture-spec
assignees:
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-27
updated: 2026-03-06
labels: [governance, architecture, ports, work-items]
external_refs:
---

# WorkItemPort — Standardized Work-Item Access

## Design

### Outcome

All consumers access work items through one port interface. V0 reads `.md` files. Swap to DB requires only a new adapter, zero consumer changes.

### Approach

**Solution**: Extract existing `src/lib/work-scanner.ts` into the hex port/adapter pattern.

**Reuses**:
- Existing `WorkItem` type and `parseFrontmatter()` from `src/lib/work-scanner.ts` (move, don't rewrite)
- Existing `yaml` npm dep (already in lockfile)
- Exact patterns from `RepoCapability` port (search/open/list + fake adapter + bootstrap factory)
- Exact patterns from `@cogni/ingestion-core` (types + port in package, adapters in services/app)

**Rejected**:
- **Port in `src/ports/` only (no package)**: scheduler-worker can't import from `src/`. Scoring needs these types. Same reason `ingestion-core` and `ledger-core` are packages.
- **Extend `RepoCapability` to parse frontmatter**: Violates single-responsibility. RepoCapability is raw file access. Work items are a domain concept with structured data.
- **DB-first**: Over-engineering. `.md` files are the source of truth today. Port abstraction lets us add DB adapter later without touching consumers.

### What exists today

`src/lib/work-scanner.ts` — 147 lines. Has:
- `WorkItem` interface (id, type, title, status, priority, estimate, labels, etc.)
- `parseFrontmatter()` — regex + `YAML.parse()`
- `toStringArray()`, `toNumber()`, `toStr()` — coercion helpers
- `scanDir()` — recursive fs readdir
- `getWorkItems()` — scan + parse + return

**Problems**:
1. Lives in `src/lib/` — not a port, not an adapter
2. Hardcoded to `fs.readFile` + `process.cwd()`
3. Can't be imported by `packages/` or `services/` (hex boundary violation)
4. No fake adapter — untestable without filesystem
5. No DI — can't swap to DB without rewriting every consumer

### Architecture

```
packages/work-items-core/          ← NEW package (pure types + port + helpers)
  src/
    index.ts                       ← barrel export
    model.ts                       ← WorkItem, WorkItemFilter, WorkItemId
    port.ts                        ← WorkItemPort interface
    parse.ts                       ← parseFrontmatter(), mapToWorkItem() (moved from work-scanner.ts)
    validate.ts                    ← isValidWorkItemId(), parseWorkItemId()

src/ports/work-item.port.ts        ← re-export from package (app-layer consumers)
src/ports/index.ts                 ← add WorkItemPort to barrel

src/adapters/server/work-items/    ← V0 adapter (filesystem)
  markdown.adapter.ts              ← refactored from work-scanner.ts (scanDir + readFile)
  index.ts

src/adapters/test/work-items/      ← fake adapter (deterministic)
  fake.adapter.ts
  index.ts

src/bootstrap/container.ts         ← wire WorkItemPort (markdown or fake based on env)

src/lib/work-scanner.ts            ← DELETE (replaced by port + adapter)
src/app/(app)/work/page.tsx        ← update import: getContainer().workItemPort
```

### Package: `@cogni/work-items-core`

**Pure types + port + helpers. No I/O. No deps except `yaml`.**

```typescript
// model.ts — moved from work-scanner.ts, made readonly
export interface WorkItem {
  readonly id: string;           // "task.0102", "proj.transparent-credit-payouts"
  readonly type: string;         // "task", "bug", "spike", "story", "project"
  readonly title: string;
  readonly status: string;
  readonly priority: number | null;  // 0-3
  readonly estimate: number | null;  // 0-5
  readonly summary: string;
  readonly outcome: string;
  readonly assignees: readonly string[];
  readonly labels: readonly string[];
  readonly project: string;      // parent project id
  readonly created: string;
  readonly updated: string;
  readonly path: string;         // relative path to source file
}

export interface WorkItemFilter {
  readonly type?: string;        // "task", "bug", etc.
  readonly status?: string;      // "needs_implement", "done", etc.
  readonly project?: string;     // "proj.transparent-credit-payouts"
  readonly ids?: readonly string[];  // specific IDs to fetch
}

// port.ts
export interface WorkItemPort {
  /** Get a single work item by ID. Returns null if not found. */
  get(id: string): Promise<WorkItem | null>;

  /** List work items matching optional filter. */
  list(filter?: WorkItemFilter): Promise<readonly WorkItem[]>;
}

// parse.ts — moved from work-scanner.ts, pure functions
export function parseFrontmatter(raw: string): Record<string, unknown> | null;
export function mapToWorkItem(frontmatter: Record<string, unknown>, path: string): WorkItem;

// validate.ts — pure
export function isValidWorkItemId(id: string): boolean;
export function parseWorkItemId(id: string): { type: string; num: number } | null;
export function parseWorkItemReferences(text: string): string[];
```

### V0 Adapter: `MarkdownWorkItemAdapter`

Refactored from `work-scanner.ts`. Only the filesystem I/O part — parsing delegated to package helpers.

```typescript
// src/adapters/server/work-items/markdown.adapter.ts
import type { WorkItem, WorkItemFilter, WorkItemPort } from "@cogni/work-items-core";
import { mapToWorkItem, parseFrontmatter } from "@cogni/work-items-core";

export class MarkdownWorkItemAdapter implements WorkItemPort {
  constructor(private readonly rootPath: string) {}

  async get(id: string): Promise<WorkItem | null> {
    const items = await this.list({ ids: [id] });
    return items[0] ?? null;
  }

  async list(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
    // Scan work/items/ and work/projects/, parse frontmatter, apply filter
    // (logic moved from work-scanner.ts scanDir + getWorkItems)
  }
}
```

### Fake Adapter: `FakeWorkItemAdapter`

```typescript
// src/adapters/test/work-items/fake.adapter.ts
export class FakeWorkItemAdapter implements WorkItemPort {
  constructor(private readonly items: WorkItem[] = DEFAULT_ITEMS) {}

  async get(id: string): Promise<WorkItem | null> {
    return this.items.find(i => i.id === id) ?? null;
  }

  async list(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
    let result = this.items;
    if (filter?.type) result = result.filter(i => i.type === filter.type);
    if (filter?.status) result = result.filter(i => i.status === filter.status);
    if (filter?.project) result = result.filter(i => i.project === filter.project);
    if (filter?.ids) result = result.filter(i => filter.ids!.includes(i.id));
    return result;
  }
}
```

### Bootstrap Wiring

```typescript
// src/bootstrap/container.ts — add to Container interface
workItemPort: WorkItemPort;

// In createContainer():
workItemPort: env.isTestMode
  ? new FakeWorkItemAdapter()
  : new MarkdownWorkItemAdapter(projectRoot),
```

### Consumer Migration

**Before** (work page):
```typescript
import { getWorkItems } from "@/lib/work-scanner";
const items = await getWorkItems();
```

**After**:
```typescript
import { getContainer } from "@/bootstrap/container";
const items = await getContainer().workItemPort.list();
```

One import change per consumer. Same data shape.

### Future: DB-Backed Adapter (V1 — separate task)

When work items move to DB, add `DrizzleWorkItemAdapter implements WorkItemPort`. Wire in container. Delete `MarkdownWorkItemAdapter`. Zero consumer changes.

### Future: Scheduler-Worker Access (scoring task)

The scheduler-worker imports `@cogni/work-items-core` (the package) for types. Implements its own adapter — either:
- `GitHubApiWorkItemAdapter` — fetches `.md` files via GitHub API (for remote repos)
- Or receives a `WorkItemPort` instance via Temporal activity context

This is the foundation that work-item-budget scoring (follow-up task) builds on.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HEX_PORT_ADAPTER: Port is interface-only in package; adapter is infra-only in `src/adapters/`
- [ ] PACKAGES_NO_SRC_IMPORTS: `@cogni/work-items-core` imports nothing from `src/`
- [ ] PARSE_IS_PURE: `parseFrontmatter()`, `mapToWorkItem()`, `parseWorkItemReferences()` are pure functions with no I/O
- [ ] ADAPTER_IS_INFRA: `MarkdownWorkItemAdapter` contains only filesystem I/O, no business logic
- [ ] FAKE_IS_DETERMINISTIC: `FakeWorkItemAdapter` returns same data for same inputs, no randomness
- [ ] CONSUMER_UNCHANGED: `WorkItem` type shape identical to existing `work-scanner.ts` export
- [ ] SIMPLE_SOLUTION: Moves existing code into proper hex pattern — no new features, no new deps
- [ ] ARCHITECTURE_ALIGNMENT: Follows `RepoCapability` / `ingestion-core` patterns exactly

## Files

### New
- `packages/work-items-core/src/model.ts` — `WorkItem`, `WorkItemFilter` types
- `packages/work-items-core/src/port.ts` — `WorkItemPort` interface
- `packages/work-items-core/src/parse.ts` — `parseFrontmatter()`, `mapToWorkItem()` (moved from work-scanner.ts)
- `packages/work-items-core/src/validate.ts` — `isValidWorkItemId()`, `parseWorkItemReferences()`
- `packages/work-items-core/src/index.ts` — barrel
- `packages/work-items-core/package.json`, `tsconfig.json`, `tsup.config.ts`, `AGENTS.md`
- `src/ports/work-item.port.ts` — re-export from package
- `src/adapters/server/work-items/markdown.adapter.ts` — V0 filesystem adapter
- `src/adapters/server/work-items/index.ts`
- `src/adapters/test/work-items/fake.adapter.ts` — test adapter
- `src/adapters/test/work-items/index.ts`

### Modified
- `src/ports/index.ts` — add `WorkItemPort` re-export
- `src/bootstrap/container.ts` — wire `workItemPort`
- `src/app/(app)/work/page.tsx` — use port instead of direct import

### Deleted
- `src/lib/work-scanner.ts` — replaced by port + adapter

### Tests
- `packages/work-items-core/tests/parse.test.ts` — frontmatter parsing
- `packages/work-items-core/tests/validate.test.ts` — ID validation, reference extraction
- `tests/contract/work-item.contract.ts` — port contract test (both adapters must pass)

## Plan

- [ ] Step 1: Create `packages/work-items-core/` — types, port, parse helpers, validate helpers
- [ ] Step 2: Create `src/adapters/server/work-items/markdown.adapter.ts` — move filesystem logic from work-scanner.ts
- [ ] Step 3: Create `src/adapters/test/work-items/fake.adapter.ts`
- [ ] Step 4: Add `src/ports/work-item.port.ts` re-export + update `src/ports/index.ts`
- [ ] Step 5: Wire in `src/bootstrap/container.ts`
- [ ] Step 6: Migrate `src/app/(app)/work/page.tsx` to use port
- [ ] Step 7: Delete `src/lib/work-scanner.ts`
- [ ] Step 8: Tests — parse, validate, contract
- [ ] Step 9: `pnpm check` + `pnpm test`

## Validation

```bash
pnpm check
pnpm test
```

**Expected:** All existing tests pass. `/work` page renders identically. New tests cover:
- Frontmatter parsing (valid, malformed, missing fields)
- Work-item ID validation and reference extraction
- Port contract (both markdown and fake adapters satisfy interface)
- Filter logic (by type, status, project, ids)

## Review Checklist

- [ ] **Work Item:** `task.0119` linked in PR body
- [ ] **Hex compliance:** Port in package, adapter in `src/adapters/`, no boundary violations
- [ ] **No new deps:** Uses existing `yaml` package only
- [ ] **Consumer unchanged:** `WorkItem` shape matches existing work-scanner.ts
- [ ] **Fake deterministic:** Test adapter works without filesystem
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
