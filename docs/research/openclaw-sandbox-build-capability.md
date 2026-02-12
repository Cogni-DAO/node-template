---
id: openclaw-sandbox-build-capability
type: research
title: "OpenClaw Sandbox Build & Launch Capabilities for Cogni-Template"
status: active
trust: draft
verified: 2026-02-11
summary: Can OpenClaw's sandboxing build and launch the cogni-template Docker stack from inside a container? Yes — via Docker socket passthrough. Recommends phased approach (compose-only first, full build later).
read_when: Planning sandbox agent capabilities for building, testing, or launching the cogni-template stack.
owner: derekg1729
created: 2026-02-11
tags: [sandbox, openclaw, docker, research]
---

# Research: OpenClaw Sandbox Build & Launch Capabilities

> spike: user-requested | date: 2026-02-11

## Question

Can OpenClaw's built-in sandboxing capabilities build and launch the cogni-template project (or individual components) inside a Docker network — given that OpenClaw itself will be running inside a container?

## Context

Today, Cogni uses OpenClaw in two modes (see [openclaw-sandbox-spec](../spec/openclaw-sandbox-spec.md)):

1. **Ephemeral** — one-shot `network=none` container, CLI invocation, OpenClaw's sandbox disabled (`sandbox.mode: "off"`)
2. **Gateway** — long-running service on `sandbox-internal`, WS protocol, OpenClaw's sandbox also disabled

In both modes, OpenClaw's **own** Docker sandboxing is turned off (invariant 13: `OPENCLAW_SANDBOX_OFF`). The question is whether we could use OpenClaw's native sandbox capabilities to give an agent the ability to build Docker images, run `docker compose up`, and launch the cogni-template stack — all from within a container.

### The cogni-template stack

The full stack has 11+ services: Next.js app, PostgreSQL (x2), LiteLLM, Temporal (server + UI + worker), Alloy, plus optional Caddy, Loki, Grafana, OpenClaw gateway, and LLM proxy. The main app has a multi-stage Dockerfile (~93 lines) with BuildKit caching, `pnpm` monorepo workspaces, and `tsup`/Next.js builds. Full stack footprint: ~3-5GB disk, ~2-4GB RAM.

## Findings

### Option A: OpenClaw's Native Sandbox with Docker Socket Passthrough

**What**: Enable OpenClaw's built-in sandbox (`sandbox.mode: "all"`) with Docker socket bind-mounted into the sandbox container. The agent's `exec` tool runs commands inside a Docker container that OpenClaw manages, and that container has access to the host Docker daemon via the mounted socket.

**How it works (source-verified)**:

1. OpenClaw creates sandbox containers via `docker create` + `docker start` (see `src/agents/sandbox/docker.ts:208-245`)
2. The `exec` tool routes shell commands to `docker exec` against the sandbox container
3. Configuration allows bind mounts: `agents.defaults.sandbox.docker.binds: ["/var/run/docker.sock:/var/run/docker.sock"]`
4. Network can be overridden from `"none"` to `"bridge"` or a custom network
5. Read-only root can be disabled, memory/CPU limits can be raised
6. `setupCommand` runs once after container creation (e.g., install `docker-cli`, `docker-compose`)

**Config sketch**:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        scope: "session",
        workspaceAccess: "rw",
        docker: {
          image: "cogni-builder:latest", // custom image with docker-cli, pnpm, node
          network: "bridge", // need egress for npm install, docker pull
          readOnlyRoot: false, // need writable FS for builds
          user: "0:0", // root for docker socket access
          memory: "4g",
          cpus: 2,
          binds: [
            "/var/run/docker.sock:/var/run/docker.sock",
            "/path/to/cogni-template:/workspace/project:rw",
          ],
          setupCommand: "apt-get update && apt-get install -y docker.io docker-compose-plugin git curl",
        },
      },
    },
  },
}
```

**Can it build cogni-template?**

- **Yes**, with Docker socket passthrough. `docker build` and `docker compose up` would work because the agent's `exec` tool can run any shell command inside the sandbox container, and the Docker socket gives access to the host Docker daemon.
- `pnpm docker:dev:stack` (or equivalent compose commands) would create sibling containers on the host daemon.

**Can it run individual components?**

- **Yes**. Single-service commands like `docker compose up postgres litellm` work fine through socket passthrough.

**Pros**:

- Uses OpenClaw's built-in, well-tested sandbox infrastructure
- Rich configuration: resource limits, network control, tool policy, pruning
- Agent gets full Docker CLI — can build, pull, run, compose
- Per-session container isolation (scope: "session")
- Familiar exec/read/write/edit tool interface for the agent
- OpenClaw handles container lifecycle (create, start, stop, prune)

**Cons**:

- **Docker socket passthrough pierces the sandbox boundary** — the agent effectively controls the host Docker daemon. OpenClaw's own docs warn: "Binding `/var/run/docker.sock` effectively hands host control to the sandbox; only do this intentionally."
- Requires `user: "0:0"` (root) for socket access, losing non-root isolation
- `network: "bridge"` gives egress — no longer network-isolated
- `readOnlyRoot: false` weakens filesystem hardening
- Containers created by the agent are **sibling containers** on the host daemon, not nested — no true DinD isolation
- Build cache is on the host Docker daemon; sandbox restarts don't lose it (good) but also can't isolate it (mixed)
- **Violates current invariant 13** (`OPENCLAW_SANDBOX_OFF`) and the security posture of invariants 4 (SECRETS_HOST_ONLY) and 3 (NETWORK_DEFAULT_DENY)

**OSS tools**: Docker Engine, Docker Compose v2 (plugin), BuildKit

**Fit with our system**: This is the **most straightforward path**. It reuses OpenClaw's existing sandbox management with minimal custom code. However, it requires a new "builder" agent profile with deliberately relaxed security — distinct from the coding agent profile which maintains `network=none`.

---

### Option B: DinD (Docker-in-Docker) Inside OpenClaw Sandbox

**What**: Instead of passing the host Docker socket, run a full Docker daemon inside the sandbox container using Docker-in-Docker (DinD). The agent builds and runs containers within a completely isolated Docker daemon.

**How it works**:

1. Custom sandbox image based on `docker:dind` with OpenClaw tools added
2. The sandbox container runs its own `dockerd` (requires `--privileged` or specific capabilities)
3. Agent's `docker build` and `docker compose up` create containers **inside** the sandbox's own daemon
4. No access to the host Docker daemon

**Pros**:

- True isolation — agent's Docker is completely separate from host
- Can't interfere with host containers or read host images
- Build cache is per-sandbox, destroyed on prune

**Cons**:

- **Requires `--privileged` or `CAP_SYS_ADMIN`** — OpenClaw's default drops ALL capabilities
- OpenClaw's `buildSandboxCreateArgs` does not support `--privileged` flag (only `capDrop`, not `capAdd`) — would need OpenClaw source modification or a wrapper
- Significant overhead: running a Docker daemon inside a container
- Nested Docker adds ~500MB-1GB overhead
- Build performance is worse (no shared layer cache with host)
- Resource contention: the inner Docker daemon competes with the sandbox container's own limits
- Complex networking: the inner containers need to reach each other but the outer sandbox might be `network=none`
- **No native OpenClaw support** — OpenClaw's sandbox config has `capDrop` but no `capAdd` or `--privileged`

**OSS tools**: Docker DinD (`docker:dind`), sysbox (rootless DinD alternative)

**Fit with our system**: Poor fit. Would require forking OpenClaw's sandbox config to add `capAdd`/`--privileged` support, plus complex image engineering. The isolation benefit doesn't justify the complexity given we control the host.

---

### Option C: Pre-Built Images + Compose-Only (No Build in Sandbox)

**What**: Build all images on the host or in CI, push to a registry. The sandbox agent only runs `docker compose up` with pre-built images — no `docker build` inside the sandbox.

**How it works**:

1. CI/CD or host-side script builds `cogni-template:local`, `cogni-scheduler-worker:local`, etc.
2. Images are available on the host Docker daemon (or pulled from registry)
3. OpenClaw sandbox with socket passthrough runs `docker compose up` using those pre-built images
4. Agent can `docker compose up -d postgres litellm` for individual components

**Pros**:

- Eliminates the heavy `docker build` step from the sandbox
- Faster agent operations (compose up vs full build)
- Build caching handled properly by CI/host
- Smaller sandbox resource requirements (no build tools needed)
- Still allows individual component launch

**Cons**:

- Still needs Docker socket passthrough (same security trade-off as Option A)
- Agent can't modify Dockerfiles and rebuild — limits self-service capability
- Requires orchestration to ensure images are current before sandbox use
- Less autonomous — agent depends on external build pipeline

**OSS tools**: Docker Compose, container registries (GHCR, Docker Hub)

**Fit with our system**: Good fit for the "launch and test" use case. The agent can start/stop services, run tests, inspect logs — all without needing build capabilities. Keeps the heavy lifting in CI where it belongs.

---

### Option D: Cogni-Managed Container Orchestration (No OpenClaw Sandbox)

**What**: Don't use OpenClaw's sandbox at all for build/launch operations. Instead, Cogni's `SandboxGraphProvider` orchestrates Docker directly — it already manages container creation, proxy setup, and billing. Extend it with a "stack launcher" capability.

**How it works**:

1. Agent requests "launch the stack" via a tool call (like existing `exec` tool but stack-aware)
2. `SandboxGraphProvider` (host-side) runs `docker compose up` on the host
3. Returns connection details (ports, URLs) to the agent
4. Agent uses its existing sandbox `exec` tool to run tests or interact with the stack

**Pros**:

- No Docker socket in sandbox — maintains security boundary
- Host controls all Docker operations (SECRETS_HOST_ONLY preserved)
- Agent gets sandboxed exec for test running without Docker access
- Billing and lifecycle managed by existing Cogni infrastructure

**Cons**:

- Requires new host-side orchestration code in SandboxGraphProvider
- Agent can't run arbitrary Docker commands — less flexible
- Tighter coupling between Cogni and specific stack compositions
- More code to maintain vs using OpenClaw's built-in capabilities

**Fit with our system**: Architecturally clean but requires significant custom work. Better for production use cases where security matters. Overkill for dev/exploration.

---

### Critical Constraint: OpenClaw Running Inside a Container

All options above must account for the fact that **OpenClaw itself runs inside a container** (our gateway mode). This creates a "container managing containers" scenario:

**For socket passthrough (Options A, B, C)**:

1. The OpenClaw gateway container must have `/var/run/docker.sock` mounted
2. OpenClaw's sandbox creates **sibling containers** on the host daemon (not nested)
3. The agent's sandbox container also needs the socket → double-passthrough
4. Path mapping becomes tricky: host paths mounted into OpenClaw must be re-mapped for sibling containers

**OpenClaw gateway already supports this** (from `docs/install/docker.md`): the containerized gateway creates sandbox containers via the host Docker daemon. The key requirement is that the gateway container has Docker socket access.

**However**, our current gateway config does NOT mount the Docker socket (invariant 13 disables sandbox). Enabling it would require:

1. Adding `/var/run/docker.sock:/var/run/docker.sock` to the gateway's compose service
2. Installing `docker` CLI in the gateway image (or custom image)
3. Resolving path mapping: workspace paths visible to the gateway must also be valid on the host for bind-mount into sibling sandbox containers

**Path mapping problem**: If OpenClaw gateway runs at `/workspace` inside its container but the actual host path is `/home/deploy/cogni-workspace`, bind mounts from the sandbox config need to use **host paths**, not gateway-container paths. OpenClaw handles this for workspace mounts (it resolves paths), but custom binds in `docker.binds` would need host-absolute paths.

---

### What About Individual Components?

Running a single component is much simpler than the full stack:

| Component                          | Can run standalone?       | Requirements                    | Sandbox feasibility            |
| ---------------------------------- | ------------------------- | ------------------------------- | ------------------------------ |
| PostgreSQL                         | Yes                       | Just `docker run postgres:15`   | Easy — one container, no build |
| LiteLLM                            | Yes                       | Config file + API keys          | Easy — but needs env secrets   |
| Next.js app                        | Needs DB + LiteLLM        | Pre-built image + running deps  | Medium — needs orchestration   |
| Temporal                           | Needs its own PG          | 3 containers (server + PG + UI) | Medium — mini-stack            |
| Scheduler Worker                   | Needs Temporal + DB + App | Pre-built image                 | Hard — needs most of the stack |
| Observability (Loki/Alloy/Grafana) | Yes                       | Just compose up                 | Easy — self-contained          |
| OpenClaw Gateway                   | Needs LiteLLM + proxy     | Pre-built image                 | Medium — existing compose      |

**For individual component testing**, the agent could:

1. `docker compose up -d postgres litellm` (just the deps)
2. Run the Next.js app in development mode (`pnpm dev`) inside the sandbox (needs Node.js)
3. Run tests against the live deps

This is achievable with **Option A or C** and moderate configuration.

## Recommendation

**Option A (Socket Passthrough) + Option C (Pre-Built Images) as a progression:**

### Phase 1: Pre-Built + Compose-Only (Option C)

- Build images in CI or on host
- OpenClaw sandbox with socket passthrough can `docker compose up` individual services
- Agent focuses on testing, debugging, and code changes — not building
- Minimal security relaxation: only the "builder" agent profile gets socket access

### Phase 2: Full Build Capability (Option A)

- Custom `cogni-builder` sandbox image with Node.js, pnpm, Docker CLI
- Agent can build, test, and iterate autonomously
- Only enabled for trusted, authenticated contexts (not public agents)

### What NOT to do:

- **Don't pursue DinD (Option B)** — too complex, no OpenClaw native support
- **Don't build custom orchestration (Option D)** — premature; OpenClaw's sandbox already handles this
- **Don't enable socket passthrough for the coding agent** — keep `sandbox:openclaw` with `network=none` for code tasks; create a separate `sandbox:builder` profile for stack operations

### Security trade-off accepted:

Socket passthrough is a deliberate security relaxation. The blast radius is controlled by:

- Separate agent profile (builder vs coder)
- Session scope (one container per session)
- Resource limits (memory, CPU, pids)
- Tool policy (deny web tools, channel tools)
- The agent still can't access secrets (no env passthrough, proxy handles auth)

## Open Questions

1. **Path mapping in nested containers**: When OpenClaw gateway runs in a container, how do workspace bind-mount paths resolve for sibling sandbox containers? Need to verify OpenClaw's path resolution logic handles this correctly, or if we need a `HOST_WORKSPACE_ROOT` env var.

2. **Docker socket security**: Should we use a Docker socket proxy (e.g., [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) to limit what the sandbox can do via the socket? This could allow `container` and `image` operations while blocking `volume`, `network`, and `exec` on the host.

3. **Build cache persistence**: If the sandbox agent builds images, where does the BuildKit cache live? On the host daemon (shared with CI) or in a separate builder instance? Need to decide cache strategy.

4. **Resource limits for builds**: The `docker build` step for cogni-template needs ~2GB RAM and ~60s for cached builds. The sandbox container itself needs resources for Docker CLI + build context transfer. Need to benchmark and set appropriate limits.

5. **Image registry**: For Option C (pre-built images), do we use a local registry, GHCR, or just rely on `docker compose build` on the host? Local registry adds a service; GHCR adds network dependency.

6. **OpenClaw `capAdd` support**: Currently OpenClaw only supports `capDrop` in sandbox config. If we ever need DinD (Option B), we'd need to contribute `capAdd` support upstream. Is this worth tracking as a feature request?

## Proposed Layout

### No new project needed

This extends existing `proj.sandboxed-agents` rather than warranting a new project.

### Specs to update

1. **`openclaw-sandbox-spec.md`** — Add a "Builder Agent Profile" section documenting the relaxed security config for build-capable agents. Clarify that invariant 13 (`OPENCLAW_SANDBOX_OFF`) applies only to the coding agent profile, not all OpenClaw usage patterns.

2. **`openclaw-sandbox-controls.md`** — Add `sandbox:builder` to the agent variant registry alongside `sandbox:agent` and `sandbox:openclaw`.

### Likely tasks (rough sequence)

1. **Create `cogni-builder` sandbox image** — Dockerfile with Node.js 20, pnpm, Docker CLI, docker-compose plugin, git, common build tools. ~1 PR.

2. **Add `sandbox:builder` agent variant** — Registry entry in `SandboxGraphProvider` with appropriate image, limits, and config (socket passthrough, bridge network). ~1 PR.

3. **Gateway Docker socket passthrough** — Update gateway compose service to optionally mount `/var/run/docker.sock`. Gated by env var (`ENABLE_SANDBOX_DOCKER=true`). ~1 PR.

4. **Verify path mapping** — Integration test: gateway (in container) → creates sandbox → sandbox runs `docker compose up postgres` → verify postgres is reachable. ~1 PR.

5. **Stack launch skill** — OpenClaw skill definition that knows how to `docker compose up` individual cogni-template components. Uses pre-built images (Phase 1). ~1 PR.
