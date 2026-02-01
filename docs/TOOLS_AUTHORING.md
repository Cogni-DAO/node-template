# Tools Authoring Guide

> **Scope:** How to add a new tool for AI agents. Authoring only—MCP and authenticated tools are NOT YET SUPPORTED.

## Goal

Add tools that AI agents can invoke. Tools are defined in `@cogni/ai-tools`, bound to real I/O in bootstrap, and executed via `toolRunner.exec()`.

---

## Hard Rules

| #   | Rule                                                                                                      | Ref                    |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **TOOLS_VIA_TOOLRUNNER**: All execution through `toolRunner.exec()`. No direct calls.                     | TOOL_USE_SPEC #1       |
| 2   | **TOOLS_IN_PACKAGES**: Contracts + implementations in `@cogni/ai-tools`. No tool definitions in `src/**`. | TOOL_USE_SPEC #2       |
| 3   | **TOOLS_IO_VIA_CAPABILITIES**: I/O via injected interfaces, not imports.                                  | TOOL_USE_SPEC #3       |
| 4   | **REDACTION_REQUIRED**: Allowlist-based output filtering. Missing config = error.                         | TOOL_USE_SPEC #4       |
| 5   | **EFFECT_TYPED**: Every tool declares `read_only`, `state_change`, or `external_side_effect`.             | TOOL_USE_SPEC #17      |
| 6   | **NO_REACHABLE_STUBS**: Stubs exist for dev; must never be reachable at runtime.                          | tool-source.factory.ts |
| 7   | **FAIL_FAST_BINDINGS**: Missing binding throws at startup, not at first invocation.                       | tool-source.factory.ts |

---

## File Locations

```
packages/ai-tools/src/
├── tools/{name}.ts          # Contract + stub + factory
├── capabilities/{name}.ts   # Capability interface (if I/O)
├── catalog.ts               # TOOL_CATALOG registration
└── index.ts                 # Barrel exports

src/adapters/server/{domain}/
└── {name}.adapter.ts        # Real I/O implementation

src/bootstrap/
├── capabilities/{name}.ts   # Factory: env → capability
└── ai/
    ├── tool-bindings.ts     # { toolId → implementation }
    └── tool-source.factory.ts
```

---

## Checklist: Add a Tool

### 1. Contract (`packages/ai-tools/src/tools/{name}.ts`)

```typescript
export const MY_TOOL_NAME = "core__my_tool" as const;  // double underscore

export const myToolContract: ToolContract<...> = {
  name: MY_TOOL_NAME,
  description: "What this tool does",
  effect: "read_only",  // or "state_change" | "external_side_effect"
  inputSchema: MyInputSchema,
  outputSchema: MyOutputSchema,
  redact: (output) => ({ ...allowedFields }),
  allowlist: ["field1", "field2"] as const,
};
```

### 2. Capability Interface (if I/O)

```typescript
// packages/ai-tools/src/capabilities/{name}.ts
export interface MyCapability {
  doThing(params: Params): Promise<Result>;
}
```

### 3. Stub + Factory

```typescript
// packages/ai-tools/src/tools/{name}.ts
export const myToolStubImplementation: ToolImplementation<...> = {
  execute: async () => { throw new Error("MyCapability not configured"); }
};

export function createMyToolImplementation(deps: { myCapability: MyCapability }) {
  return { execute: async (input) => deps.myCapability.doThing(input) };
}

export const myToolBoundTool: BoundTool<...> = {
  contract: myToolContract,
  implementation: myToolStubImplementation,  // replaced at runtime
};
```

### 4. Register Catalog

```typescript
// packages/ai-tools/src/catalog.ts
import { myToolBoundTool } from "./tools/my-tool";

export const TOOL_CATALOG = createToolCatalog([
  getCurrentTimeBoundTool,
  metricsQueryBoundTool,
  myToolBoundTool, // ← add here
]);
```

### 5. Adapter (`src/adapters/server/{domain}/{name}.adapter.ts`)

```typescript
export class MyAdapter implements MyCapability {
  constructor(private config: MyConfig) {}
  async doThing(params: Params): Promise<Result> {
    // Real HTTP/DB/etc logic here
  }
}
```

### 6. Bootstrap Capability (`src/bootstrap/capabilities/{name}.ts`)

```typescript
export function createMyCapability(env: ServerEnv): MyCapability {
  if (!env.MY_API_KEY) return stubMyCapability;
  return new MyAdapter({ apiKey: env.MY_API_KEY });
}
```

### 7. Wire Bindings (`src/bootstrap/ai/tool-bindings.ts`)

```typescript
export interface ToolBindingDeps {
  metricsCapability: MetricsCapability;
  myCapability: MyCapability;  // ← add
}

export function createToolBindings(deps: ToolBindingDeps): ToolBindings {
  return {
    [GET_CURRENT_TIME_NAME]: getCurrentTimeImplementation,
    [METRICS_QUERY_NAME]: createMetricsQueryImplementation({ ... }),
    [MY_TOOL_NAME]: createMyToolImplementation({  // ← add
      myCapability: deps.myCapability,
    }),
  };
}
```

### 8. Container + Test

```typescript
// src/bootstrap/container.ts
const myCapability = createMyCapability(env);
// Add to Container interface + return

// tests/stack/ai/{name}.stack.test.ts
it("executes via adapter", async () => {
  const result = await toolRunner.exec(MY_TOOL_NAME, validInput);
  expect(result.ok).toBe(true);
});
```

---

## NOT YET SUPPORTED

### Authenticated Tools (connectionId)

**Status:** Spec complete, implementation TODO.

Tools requiring external auth (GitHub, Bluesky, OAuth) need the connection broker pipeline:

- `connections` table with AEAD encryption
- `ConnectionBrokerPort.resolveForTool()`
- Grant intersection enforcement in `toolRunner.exec()`
- `AuthCapability` backed by broker

**Ref:** [TENANT_CONNECTIONS_SPEC.md](TENANT_CONNECTIONS_SPEC.md) — Full P0 checklist

**Invariants (not yet enforced):**

- CONNECTION_ID_ONLY (#26)
- NO_SECRETS_IN_CONTEXT (#28)
- AUTH_VIA_CAPABILITY_INTERFACE (#29)
- GRANT_INTERSECTION_BEFORE_RESOLVE (#30)

### MCP Integration

**Status:** Design complete, implementation P1.

MCP tools should be another `ToolSourcePort` implementation, not a provider bypass.

```
P0: StaticToolSource works (current)
P1: McpToolSourceAdapter implements ToolSourcePort
P2: CompositeToolSourcePort merges Static + MCP
```

**Invariants (not yet enforced):**

- MCP_UNTRUSTED_BY_DEFAULT (#21)
- Same policy/redaction/audit path as core tools

**Ref:** [TOOL_USE_SPEC.md](TOOL_USE_SPEC.md) #21, #25

### Human-in-the-Loop Approval

**Status:** P1.

Tools with `effect: "state_change"` or `"external_side_effect"` may require approval gates.

- `ToolPolicy.requireApprovalForEffects` exists but treated as `deny` in P0
- LangGraph interrupts for approval flow not implemented

**Ref:** [TOOL_USE_SPEC.md](TOOL_USE_SPEC.md) Implementation Checklist P1

### P0: Reduce Tool Boilerplate

Current 8-step checklist is temporary. Target: 2-3 files per tool.

- [ ] Enabled-tool gating: fail-fast only for enabled tool IDs, not entire catalog
- [ ] ToolModule manifest: `{ id, contract, bind(deps), requiredDeps }` per tool file
- [ ] Delete stubs: binding-time failure replaces stub pattern
- [ ] Generate catalog: codegen from module index, not manual registration
- [ ] Domain ports over per-tool capabilities: reuse `MetricsQueryPort` not `MetricsCapability`
- [ ] Fast path for pure tools: skip steps 2, 3, 5, 6, 7 (no I/O = no capability wiring)

---

## Examples

| Tool                     | Type | Capability          | Location                    |
| ------------------------ | ---- | ------------------- | --------------------------- |
| `core__get_current_time` | Pure | None                | `tools/get-current-time.ts` |
| `core__metrics_query`    | I/O  | `MetricsCapability` | `tools/metrics-query.ts`    |

---

## Related

- [TOOL_USE_SPEC.md](TOOL_USE_SPEC.md) — 34 invariants, full implementation checklist
- [TENANT_CONNECTIONS_SPEC.md](TENANT_CONNECTIONS_SPEC.md) — Authenticated tools design
- [LANGGRAPH_AI.md](LANGGRAPH_AI.md) — Graph patterns, tool execution flow

---

**Last Updated:** 2026-02-01
