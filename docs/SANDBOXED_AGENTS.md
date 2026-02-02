# Sandboxed Agent System

> [!CRITICAL]
> Sandbox is a **GraphProvider** routed via `AggregatingGraphExecutor`. Host owns the LLM loop; sandbox is a command executor only. NOT user-invocable—requires system `ExecutionGrant` with `allowSandbox` gate. Secrets never enter sandbox.

## Core Invariants

1. **SANDBOX_IS_GRAPH_PROVIDER**: Sandbox implements `GraphProvider`, registered in `AggregatingGraphExecutor`. Temporal schedules/invokes graph runs, doesn't create separate executor path.

2. **HOST_OWNS_LLM_LOOP**: The host-side GraphProvider runs the LLM conversation loop. Sandbox receives structured commands (clone, exec, test, commit) and returns results. No autonomous agent inside sandbox in P0.

3. **SYSTEM_GRANT_REQUIRED**: Sandbox graphs require `ExecutionGrant` with `allowSandbox: true`. NOT accessible via user-facing chat API. Reject invocation without valid system grant.

4. **SECRETS_HOST_ONLY**: No GitHub tokens, OAuth credentials, or API keys in sandbox FS/env. P0 uses only non-auth read-only tools. Host resolves credentials for repo clone/push operations.

5. **TOOL_EXEC_VIA_GATEWAY**: Sandbox calls tools via `cogni-tool` CLI → ToolGateway (unix socket) → host `toolRunner.exec()`. Single enforcement chokepoint preserved. No direct network or tool bypass.

6. **NETWORK_DEFAULT_DENY**: Sandbox container runs with `network_mode: none`. All external access via ToolGateway only.

7. **HOST_SIDE_CLONE**: Host clones repo into workspace volume. Sandbox mounts workspace read-write but never has Git credentials. Push via host-side `RepoPort`.

8. **APPEND_ONLY_AUDIT**: Every run produces append-only audit artifacts (commands, exit codes, scrubbed outputs). Host-written, not sandbox self-report.

9. **WRITE_PATH_IS_BRANCH**: Default = push commits to branch. PR creation only when explicitly requested. Never auto-PR.

---

## Implementation Checklist

### P0: Sandbox GraphProvider Loop

#### Infrastructure

- [ ] Create `services/sandbox-runtime/Dockerfile`:
  - Base: `node:20-slim`
  - Install: git (for local ops), pnpm, jq, rg, fd-find, bash
  - Copy: `cogni-tool` CLI
  - No autonomous entrypoint — container receives commands via gateway
- [ ] Create `services/sandbox-runtime/cogni-tool/` CLI:
  - Reads socket path from `COGNI_GATEWAY_SOCK` env
  - Commands: `cogni-tool exec <tool> '<args-json>'`
  - Protocol: JSON over unix socket
- [ ] Add `sandbox-isolated` network to docker-compose (no external connectivity)

#### Ports (`src/ports/`)

- [ ] Create `src/ports/sandbox-runner.port.ts`:
  ```typescript
  interface SandboxRunnerPort {
    run(spec: SandboxRunSpec): Promise<SandboxRunResult>;
  }
  interface SandboxRunSpec {
    runId: string;
    workspacePath: string; // Pre-cloned by host
    taskInput: string;
    graphId: string;
    billingAccountId: string;
    actorId: string;
    tenantId: string;
    toolIds: readonly string[]; // P0: non-auth read-only only
    limits: { maxRuntimeSec: number; maxMemoryMb: number };
  }
  interface SandboxRunResult {
    ok: boolean;
    bundle?: { patches: string[]; commitMessages: string[] };
    logs: string;
    auditLog: AuditEntry[]; // Host-written command audit
    errorCode?: "timeout" | "oom_killed" | "internal" | "task_failed";
  }
  ```
- [ ] Create `src/ports/repo.port.ts`:
  ```typescript
  interface RepoPort {
    cloneToWorkspace(params: { repoUrl; sha; workspacePath }): Promise<void>;
    pushBranchFromPatches(params: {
      repoUrl;
      baseSha;
      patches;
      branchName;
    }): Promise<{ branchName }>;
    openPullRequest(params: {
      repoUrl;
      sourceBranch;
      targetBranch;
      title;
      body;
    }): Promise<{ prUrl }>;
  }
  ```

#### Adapters (`src/adapters/server/sandbox/`)

- [ ] Create `tool-gateway.server.ts`:
  - Unix socket at `/tmp/cogni-gateway-{runId}.sock`
  - Accept JSON `{runId, toolName, args, toolCallId}`
  - Validate runId matches expected
  - Call `toolRunner.exec()` with policy from run config
  - Return `{ok, value?, errorCode?, safeMessage?}`
  - Log all calls to audit stream
- [ ] Create `sandbox-runner.adapter.ts`:
  - Implements `SandboxRunnerPort`
  - Start gateway server before container
  - `docker run --rm --network=none --memory={limit}m`
  - Volume mounts: workspace (rw), gateway socket, artifacts dir
  - Env: `COGNI_GATEWAY_SOCK`, `RUN_ID`
  - Wait for exit or timeout (SIGKILL on timeout)
  - Collect patches from `/artifacts/`
  - Collect audit log from gateway
  - Cleanup socket + container
- [ ] Create `sandbox.provider.ts`:
  - Implements `GraphProvider`
  - `providerId: 'sandbox'`
  - `canHandle(graphId)`: true for `sandbox:*`
  - `runGraph()`:
    1. Validate grant has `allowSandbox: true`
    2. Call `repoPort.cloneToWorkspace()` (host-side clone)
    3. **Host runs LLM loop**, sends commands to sandbox via gateway
    4. Call `sandboxRunner.run()` for each command batch
    5. Collect patches, optionally push branch
    6. Return `GraphRunResult` (stream + final)

#### Bootstrap (`src/bootstrap/`)

- [ ] Wire `SandboxRunnerPort` in `container.ts`
- [ ] Wire `RepoPort` stub in `container.ts` (GitHub impl P1)
- [ ] Add `SandboxGraphProvider` to `AggregatingGraphExecutor` in `graph-executor.factory.ts`
- [ ] Add `SANDBOX_ENABLED` feature flag (default false)
- [ ] Add `allowSandbox` field to `ExecutionGrant` schema

#### Temporal Integration

- [ ] Create `sandbox-agent-run.workflow.ts` following existing `GovernanceScheduledRunWorkflow` pattern:
  - Activity: `validateGrantActivity` (check `allowSandbox: true`)
  - Activity: `executeGraphActivity` with `graphId: 'sandbox:task'`
  - Activity: `pushBranchActivity` (optional)
  - Activity: `recordRunCompleteActivity`

#### Tests (Merge Gates)

- [ ] **Network isolation**: `curl` from sandbox fails (network=none enforced)
- [ ] **Grant gate**: Invocation without `allowSandbox: true` returns `authz_denied`
- [ ] **Gateway enforcement**: runId mismatch rejected, tool allowlist enforced
- [ ] **Audit completeness**: All tool calls appear in host-written `auditLog`
- [ ] **E2E flow**: clone@sha → edit → test → push branch works

#### Chores

- [ ] Observability: `sandbox.run.*` Prometheus metrics
- [ ] Documentation updates

### P1: Clawdbot Agent Runtime

- [ ] Clawdbot runs inside sandbox container as the agent runtime
- [ ] Clawdbot calls `cogni-tool` for external IO (tools via gateway)
- [ ] Implement `GitHubRepoAdapter` for `RepoPort` (uses host-side credentials)
- [ ] Add authenticated tools via `ConnectionBrokerPort` integration

### P2: Full Agent Autonomy (Do NOT Build Yet)

- [ ] Multi-turn Clawdbot sessions with persistent workspace
- [ ] `.cogni/index.json` repo memory
- [ ] Sandbox warm pools
- [ ] Condition: P0 and P1 must be boring first

---

## File Pointers (P0)

| File                                                                    | Change                                 |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `src/ports/sandbox-runner.port.ts`                                      | New: `SandboxRunnerPort` interface     |
| `src/ports/repo.port.ts`                                                | New: `RepoPort` interface              |
| `src/ports/index.ts`                                                    | Export new ports                       |
| `src/adapters/server/sandbox/tool-gateway.server.ts`                    | New: unix socket gateway               |
| `src/adapters/server/sandbox/sandbox-runner.adapter.ts`                 | New: Docker runner                     |
| `src/adapters/server/sandbox/sandbox.provider.ts`                       | New: GraphProvider impl                |
| `src/adapters/server/sandbox/index.ts`                                  | Barrel export                          |
| `src/adapters/server/index.ts`                                          | Export sandbox adapters                |
| `src/bootstrap/container.ts`                                            | Wire ports                             |
| `src/bootstrap/graph-executor.factory.ts`                               | Add SandboxGraphProvider to aggregator |
| `services/sandbox-runtime/Dockerfile`                                   | New: sandbox image                     |
| `services/sandbox-runtime/cogni-tool/`                                  | New: gateway CLI                       |
| `services/scheduler-worker/src/workflows/sandbox-agent-run.workflow.ts` | New: Temporal workflow                 |
| `platform/infra/services/runtime/docker-compose.yml`                    | Add sandbox-isolated network           |
| `src/shared/db/schema.grants.ts`                                        | Add `allowSandbox` field               |

---

## Design Decisions

### 1. Host Owns LLM Loop (P0)

**Decision**: Host-side GraphProvider runs the LLM conversation loop. Sandbox executes commands only.

```
┌─────────────────────────────────────────────────────────────────────┐
│ HOST: SandboxGraphProvider.runGraph()                               │
│ ─────────────────────────────────────                               │
│ 1. Validate grant (allowSandbox: true)                              │
│ 2. Clone repo to workspace (host-side)                              │
│ 3. LLM loop:                                                        │
│    - Send task to LLM                                               │
│    - LLM returns commands (read file, edit, run test, etc.)         │
│    - Execute commands in sandbox via gateway                        │
│    - Return results to LLM                                          │
│    - Repeat until done                                              │
│ 4. Collect patches from sandbox                                     │
│ 5. Push branch (if configured)                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ commands via gateway
┌─────────────────────────────────────────────────────────────────────┐
│ SANDBOX: Command Executor (network=none)                            │
│ ────────────────────────────────────────                            │
│ - Receives commands via unix socket gateway                         │
│ - Executes: file read/write, pnpm test, git commit                  │
│ - Returns results to host                                           │
│ - No LLM, no autonomous loop                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Why**: Keeps P0 simple. Host controls all LLM I/O, billing, and orchestration. Sandbox is a pure command executor with no autonomy.

### 2. P1/P2: Clawdbot Inside Sandbox

**Decision**: Clawdbot becomes the agent runtime inside sandbox in P1/P2.

```
P1/P2:
┌─────────────────────────────────────────────────────────────────────┐
│ SANDBOX: Clawdbot Runtime (network=none)                            │
│ ────────────────────────────────────────                            │
│ - Clawdbot runs as agent process                                    │
│ - LLM calls routed via cogni-tool → ToolGateway → host LiteLLM      │
│ - External tools via cogni-tool → ToolGateway → host toolRunner     │
│ - Autonomous within sandbox, but all IO through gateway             │
└─────────────────────────────────────────────────────────────────────┘
```

**Why**: Clawdbot already has sandbox mode, skill persistence, and workspace management. Reuse rather than rebuild.

### 3. No ConnectionBroker in P0

**Decision**: P0 tools are non-auth read-only only. No `ConnectionBrokerPort` integration.

**P0 Tool Allowlist**:

- `core__get_current_time` — pure computation
- `core__metrics_query` — read-only metrics (if configured)

**P1 adds authenticated tools** via ConnectionBroker.

**Why**: Simplifies P0. Auth tools require broker, grant intersection, credential resolution — all deferred.

### 4. Host-Side Clone + Push

**Decision**: Host clones repo and pushes branches. Sandbox never has Git credentials.

```
HOST: repoPort.cloneToWorkspace()
  │
  ▼ workspace volume ready
SANDBOX: makes changes, commits locally
  │
  ▼ patches exported
HOST: repoPort.pushBranchFromPatches()
```

**Why**: Credentials stay on host. Sandbox can't exfiltrate tokens.

---

## Anti-Patterns

| Pattern                          | Problem                                |
| -------------------------------- | -------------------------------------- |
| Autonomous agent in sandbox (P0) | Host must own LLM loop in P0           |
| GitHub token in sandbox env      | Credential exfiltration risk           |
| Clone inside sandbox             | Needs credentials; clone on host       |
| Direct network from sandbox      | Bypasses tool policy, no audit         |
| Auth tools in P0                 | Requires ConnectionBroker; defer to P1 |
| Auto-PR every run                | Noisy, no review gate                  |
| Shell tool in ToolGateway        | Escapes all policy                     |
| Sandbox self-reported audit      | Can't trust; host must write audit     |
| runId from sandbox input         | Must be host-generated                 |
| Wire into user chat API          | Must require system grant              |

---

## Merge Gates (P0)

| Gate                   | Test                                          |
| ---------------------- | --------------------------------------------- |
| Network isolation      | `curl google.com` from sandbox → fails        |
| Grant enforcement      | Missing `allowSandbox: true` → `authz_denied` |
| Gateway runId check    | Wrong runId → rejected                        |
| Gateway tool allowlist | Disallowed tool → `policy_denied`             |
| Audit is host-written  | All gateway calls logged by host              |
| E2E flow               | clone@sha → edit → test → push branch         |

---

## Related Documents

- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — GraphExecutorPort, billing
- [TOOL_USE_SPEC.md](TOOL_USE_SPEC.md) — Tool execution, DENY_BY_DEFAULT
- [CLAWDBOT_ADAPTER_SPEC.md](CLAWDBOT_ADAPTER_SPEC.md) — Clawdbot runtime (P1/P2 agent)
- [RBAC_SPEC.md](RBAC_SPEC.md) — ExecutionGrant, allowSandbox gate
- [TENANT_CONNECTIONS_SPEC.md](TENANT_CONNECTIONS_SPEC.md) — ConnectionBroker (P1)

---

**Last Updated**: 2026-02-02
**Status**: Draft
