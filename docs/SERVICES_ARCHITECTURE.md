# Services Architecture

> Deployable workers and servers with their own process lifecycle, distinct from pure library packages.

## Overview

The `services/` directory contains **standalone deployable services**—Node.js processes with their own entry points, environment configuration, health endpoints, and Docker images. Services import from `packages/` but never from `src/` (the Next.js app).

**Key distinction from packages:**

| Aspect          | `packages/`                    | `services/`                   |
| --------------- | ------------------------------ | ----------------------------- |
| Process         | Library (no lifecycle)         | Standalone process            |
| Entry point     | `dist/index.js` (exports only) | `src/main.ts` (runs)          |
| Environment     | None (injected by consumer)    | Owns Zod-validated env config |
| Health checks   | None                           | `/livez`, `/readyz` endpoints |
| Docker image    | None                           | Multi-stage Dockerfile        |
| Signal handling | None                           | SIGTERM graceful shutdown     |
| Deployment      | npm package                    | K8s Deployment (replicas)     |

> **Note:** K8s `Job`/`CronJob` is reserved for finite batch tasks, not queue workers. Workers deploy as `Deployment` with horizontal scaling.

## When to Create a Service

Create a service when the code:

1. **Runs independently** — Worker loop, HTTP server, or scheduled job
2. **Owns its lifecycle** — Startup, shutdown, health, readiness
3. **Has deployment concerns** — Docker, K8s manifests, env vars
4. **Cannot be a library** — Needs process isolation from the Next.js app

**Do NOT create a service for:** Shared logic, type definitions, utility functions, or anything that should be a library in `packages/`.

---

## Service Structure

```
services/<name>/
├── src/
│   ├── main.ts              # Entry point (signal handling, startup)
│   ├── config.ts            # Zod env schema
│   ├── health.ts            # /livez, /readyz handlers
│   ├── worker.ts            # Main worker logic (or server.ts for HTTP)
│   └── ...                  # Service-specific modules
├── tests/
│   └── ...                  # Service-specific tests
├── Dockerfile               # Multi-stage build
├── package.json             # name: @cogni/<name>-service
├── tsconfig.json            # Extends root, composite mode
├── tsup.config.ts           # Bundle to dist/
├── vitest.config.ts         # Test config
└── AGENTS.md                # Service documentation
```

---

## MVP Service Checklist

When creating a new service, complete these items in order:

### 1. Workspace Setup

- [ ] Add `services/*` to `pnpm-workspace.yaml` (if first service)
- [ ] Create `services/<name>/package.json`:
  ```json
  {
    "name": "@cogni/<name>-service",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "tsup",
      "start": "node dist/main.js",
      "dev": "tsx watch src/main.ts",
      "typecheck": "tsc --noEmit"
    }
  }
  ```
- [ ] Add workspace dependency to root `package.json` (if needed for scripts)

### 2. TypeScript Configuration

- [ ] Create `tsconfig.json` (standalone, does NOT extend root or use composite mode—services are isolated)
- [ ] Create `tsup.config.ts` with `platform: "node"`, entry: `["src/main.ts"]`
- [ ] Add to `biome/base.json` noDefaultExport override (tsup + vitest configs)

> **Note:** Services do NOT get added to root `tsconfig.json` references. Unlike packages (which produce declarations consumed by other packages), services are standalone processes with their own isolated build.

### 3. Environment Configuration

- [ ] Create `src/config.ts` with Zod schema:

  ```typescript
  import { z } from "zod";

  const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    // PORT for main HTTP server (if applicable)
    PORT: z.coerce.number().default(3001),
    // HEALTH_PORT for K8s probes (separate to avoid clashes)
    HEALTH_PORT: z.coerce.number().default(9000),
    // Service-specific vars...
  });

  export type ServiceConfig = z.infer<typeof envSchema>;

  export function loadConfig(): ServiceConfig {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment:", result.error.flatten().fieldErrors);
      process.exit(1);
    }
    return result.data;
  }
  ```

> **Note:** `HEALTH_PORT` can be the same value (e.g., 9000) across all services; only host port publishing (`ports:` in Compose) must be unique if exposing externally.

### 4. Health Endpoints

- [ ] Create `src/health.ts` with `/livez` and `/readyz`:

  ```typescript
  /**
   * Health endpoints for orchestrator probes (K8s, Compose healthcheck, etc).
   *
   * /livez  - 200 if process running, not wedged. Low-cost check.
   * /readyz - 200 only if dependencies OK (DB, etc), not draining.
   */

  export interface HealthState {
    ready: boolean; // Set false during drain/shutdown
    dbConnected: boolean;
  }

  export function createHealthHandlers(state: HealthState) {
    return {
      livez: () => ({ status: 200, body: "ok" }),
      readyz: () => {
        if (!state.ready || !state.dbConnected) {
          return { status: 503, body: "not ready" };
        }
        return { status: 200, body: "ok" };
      },
    };
  }
  ```

**Probe contract:**

| Endpoint  | Purpose                       | K8s Probe        | Cost    |
| --------- | ----------------------------- | ---------------- | ------- |
| `/livez`  | Process alive, not deadlocked | `livenessProbe`  | Minimal |
| `/readyz` | Ready to accept work (DB OK)  | `readinessProbe` | Low     |

**Environment behavior:**

- **Kubernetes:** Probes control routing and restarts automatically
- **Docker Compose:** Probes only matter if wired via `healthcheck:`; workers must gate job-claiming in-process regardless

**Worker readiness invariant:** For queue workers, `ready=false` must **gate the poll/claim loop**, not just HTTP traffic. When `ready=false`:

- Worker stops polling for new jobs immediately
- In-flight jobs drain to completion (with timeout)
- Only after drain completes does the process exit

Workers must stop claiming new jobs immediately on SIGTERM regardless of orchestrator—do not rely on external routing semantics.

**Do NOT use:** Docker HEALTHCHECK with `pgrep` — it proves nothing about actual health.

### 5. Entry Point with Signal Handling

- [ ] Create `src/main.ts`:

  ```typescript
  import { loadConfig } from "./config";
  import { createHealthHandlers, type HealthState } from "./health";

  const config = loadConfig();

  const healthState: HealthState = {
    ready: false,
    dbConnected: false,
  };

  async function main() {
    // 1. Initialize dependencies
    const db = await initDatabase(config.DATABASE_URL);
    healthState.dbConnected = true;

    // 2. Start health server on dedicated port (avoids clashes with main HTTP)
    startHealthServer(createHealthHandlers(healthState), config.HEALTH_PORT);

    // 3. Mark ready AFTER initialization complete
    healthState.ready = true;
    console.log(`Service ready, health on port ${config.HEALTH_PORT}`);

    // 4. Start main work loop
    await startWorker(db);
  }

  // Graceful shutdown
  async function shutdown(signal: string) {
    console.log(`Received ${signal}, starting graceful shutdown...`);

    // 1. Stop accepting new work immediately
    healthState.ready = false;

    // 2. Drain in-flight work (with timeout)
    await drainWithTimeout(30_000);

    // 3. Close connections
    await closeDatabase();

    // 4. Exit cleanly
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
  ```

**Shutdown invariants:**

1. Set `ready = false` immediately (canonical drain signal; in K8s also stops routing; in Compose only helps if process gates work intake)
2. Stop pulling new jobs/requests
3. Drain in-flight work with timeout
4. Close DB pool and connections
5. Exit 0 (clean) or 1 (error)

### 6. Dockerfile

**Packaging models:** Choose exactly one per service:

| Model                       | Description                        | When to Use                                   | Runtime Copies            |
| --------------------------- | ---------------------------------- | --------------------------------------------- | ------------------------- |
| **A: Bundled** (default)    | tsup bundles all deps into `dist/` | Workers, simple services without native deps  | Only `dist/`              |
| **B: Runtime node_modules** | Full workspace install at runtime  | Services with native deps or dynamic requires | `dist/` + `node_modules/` |

> **Default to Model A.** Model B is a fallback when bundling fails (native modules, dynamic imports). The templates below show both; use the one matching your model.

- [ ] Create multi-stage `Dockerfile`:

  **Model A (Bundled — preferred for workers):**

  > **Reference implementation:** `services/scheduler-worker/Dockerfile`

  ```dockerfile
  # syntax=docker/dockerfile:1

  # ============================================================================
  # Builder: compile and bundle TypeScript
  # ============================================================================
  FROM node:20-bookworm-slim AS builder

  # Build tools for native modules (bufferutil, etc. from shared lockfile)
  RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ && rm -rf /var/lib/apt/lists/*

  # Pin pnpm to match root package.json packageManager field
  RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
  WORKDIR /app

  # Copy workspace config for dependency resolution
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY packages/<dep1>/package.json packages/<dep1>/
  COPY packages/<dep2>/package.json packages/<dep2>/
  COPY services/<name>/package.json services/<name>/

  # Install only dependencies needed for this service (not entire workspace)
  RUN pnpm install --frozen-lockfile --filter @cogni/<name>-service...

  # Copy source and build
  COPY packages/<dep1> packages/<dep1>
  COPY packages/<dep2> packages/<dep2>
  COPY services/<name> services/<name>

  # Build packages in dependency order, then the service
  RUN pnpm --filter @cogni/<dep1> build && \
      pnpm --filter @cogni/<dep2> build && \
      pnpm --filter @cogni/<name>-service build

  # ============================================================================
  # Runtime: minimal production image (bundled — no node_modules needed)
  # ============================================================================
  FROM node:20-bookworm-slim AS runtime

  # OCI labels for traceability
  LABEL org.opencontainers.image.source="https://github.com/Cogni-DAO/cogni-template"
  LABEL org.opencontainers.image.description="<name> service"

  # Security: non-root user
  RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs nodejs
  USER nodejs
  WORKDIR /app

  # Copy only the bundled artifact
  COPY --from=builder --chown=nodejs:nodejs /app/services/<name>/dist ./dist

  ENV NODE_ENV=production

  # No HEALTHCHECK - use K8s probes instead
  CMD ["node", "dist/main.js"]
  ```

  **Model B (Runtime node_modules — fallback for native deps):**

  ```dockerfile
  # syntax=docker/dockerfile:1

  # ============================================================================
  # Base: shared Node.js setup
  # ============================================================================
  FROM node:20-bookworm-slim AS base

  # Build tools for native modules
  RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ && rm -rf /var/lib/apt/lists/*

  # Pin pnpm to match root package.json packageManager field
  RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
  WORKDIR /app

  # ============================================================================
  # Dependencies: install production deps
  # ============================================================================
  FROM base AS deps
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY packages/ ./packages/
  COPY services/<name>/package.json ./services/<name>/
  RUN pnpm install --frozen-lockfile --prod --filter @cogni/<name>-service...

  # ============================================================================
  # Builder: compile TypeScript
  # ============================================================================
  FROM base AS builder
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY packages/ ./packages/
  COPY services/<name>/ ./services/<name>/
  RUN pnpm install --frozen-lockfile --filter @cogni/<name>-service...
  RUN pnpm --filter @cogni/<name>-service build

  # ============================================================================
  # Runtime: production image with node_modules
  # ============================================================================
  FROM node:20-bookworm-slim AS runtime

  # OCI labels for traceability
  LABEL org.opencontainers.image.source="https://github.com/Cogni-DAO/cogni-template"
  LABEL org.opencontainers.image.description="<name> service"

  # Security: non-root user
  RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs nodejs
  USER nodejs
  WORKDIR /app

  # Copy runtime artifacts (Model B: includes node_modules)
  COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
  COPY --from=deps --chown=nodejs:nodejs /app/services/<name>/node_modules ./services/<name>/node_modules
  COPY --from=builder --chown=nodejs:nodejs /app/services/<name>/dist ./services/<name>/dist
  COPY --from=builder --chown=nodejs:nodejs /app/packages/*/dist ./packages/

  WORKDIR /app/services/<name>
  ENV NODE_ENV=production

  # No HEALTHCHECK - use K8s probes instead
  CMD ["node", "dist/main.js"]
  ```

**Dockerfile invariants:**

- **Pin pnpm version** to match root `package.json` `packageManager` field (not `pnpm@latest`)
- **Include build tools** in builder stage: `python3`, `make`, `g++` (required for native modules from shared lockfile)
- **Default base image:** `node:20-bookworm-slim` (glibc, broad native dep compatibility)
- Alpine (`node:20-alpine`) allowed only if: (1) no native deps, and (2) CI smoke test proves image runs correctly
- **Do NOT use `--ignore-scripts`** (breaks esbuild/tsup postinstall)
- Use multi-stage to minimize final image size
- Add OCI labels (`org.opencontainers.image.*`)
- Run as non-root user
- Do NOT use Docker HEALTHCHECK with `pgrep` (K8s probes handle health)

### 7. Security Defaults (K8s)

When deploying to Kubernetes, apply these security constraints:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL

# If service needs writable temp space:
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

### 8. Dependency Cruiser Rules

- [ ] Add rule blocking `services/<name>/` from importing `src/`:
  ```javascript
  {
    name: "no-<name>-service-to-src",
    severity: "error",
    from: { path: "^services/<name>/" },
    to: { path: "^src/" },
    comment: "<name> service cannot import from Next.js app"
  }
  ```
- [ ] Add arch probe: `services/<name>/__arch_probes__/illegal-src-import.ts`

### 9. Repo Integration

- [ ] Add root scripts to `package.json`:
  ```json
  "<name>:build": "pnpm --filter @cogni/<name>-service build",
  "<name>:dev": "dotenv -e .env.local -- pnpm --filter @cogni/<name>-service dev"
  ```
- [ ] Add to `docker-compose.dev.yml`:
  ```yaml
  <name>:
    build:
      context: ../../../..
      dockerfile: services/<name>/Dockerfile
    env_file: ../../../../.env.local
    depends_on:
      postgres:
        condition: service_healthy
    # Add healthcheck once health endpoints exist
  ```
- [ ] Add to production `docker-compose.yml` (when ready for deployment)
- [ ] Add to CI workflow (`.github/workflows/`):
  - Build: `pnpm --filter @cogni/<name>-service build`
  - Test: `pnpm --filter @cogni/<name>-service test`
  - Docker build and push to GHCR with immutable SHA tags

**Invariants:**

| Invariant                  | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| TEST_DISCOVERY             | Services included in workspace test discovery + per-service test command |
| IMAGE_PER_SERVICE          | Each service has its own Dockerfile producing an OCI image               |
| CI_BUILDS_AND_PUSHES       | CI pushes immutable SHA-tagged images to registry                        |
| PROD_COMPOSE_LISTS_SERVICE | Production runtime includes the service definition                       |
| READINESS_GATES_LOCALLY    | Workers stop claiming jobs on SIGTERM regardless of orchestrator         |

### 10. Documentation

- [ ] Create `services/<name>/AGENTS.md` with:
  - Purpose and scope
  - Environment variables
  - Health endpoints
  - Deployment notes
- [ ] Update `docs/ENVIRONMENTS.md` with service env vars
- [ ] Update this table in "Existing Services" section below

---

## Import Boundaries

**Strict isolation rules:**

| From               | Can Import                  | Cannot Import          |
| ------------------ | --------------------------- | ---------------------- |
| `services/<name>/` | `packages/*` via `@cogni/*` | `src/`, other services |
| `src/`             | `packages/*` via `@cogni/*` | `services/`            |
| `packages/`        | Other `packages/*`          | `src/`, `services/`    |

**Enforced by dependency-cruiser:**

```javascript
// services/ cannot import from src/
{
  name: "no-services-to-src",
  severity: "error",
  from: { path: "^services/" },
  to: { path: "^src/" }
}

// src/ cannot import from services/
{
  name: "no-src-to-services",
  severity: "error",
  from: { path: "^src/" },
  to: { path: "^services/" }
}
```

---

## Existing Services

| Service            | Purpose                                       | Status   |
| ------------------ | --------------------------------------------- | -------- |
| `scheduler-worker` | Graphile Worker for scheduled graph execution | MVP (v0) |

---

## Related Docs

- [Packages Architecture](PACKAGES_ARCHITECTURE.md) — Pure libraries, package vs service distinction
- [Architecture](ARCHITECTURE.md) — Hexagonal layers and boundaries
- [Deployment Architecture](../platform/runbooks/DEPLOYMENT_ARCHITECTURE.md) — Infrastructure and deployment
- [Scheduler Service Refactor](SCHEDULER_SERVICE_REFACTOR.md) — First service implementation spec
