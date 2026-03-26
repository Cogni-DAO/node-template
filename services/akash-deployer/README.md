# Akash Deployer Service — Quick Start

> Deploy containerized workloads (MCP servers + AI agents) via HTTP API.
> v0 uses a mock provider. P1 targets live Akash Network.

## Start

```bash
# From repo root
pnpm --filter @cogni/akash-deployer-service dev
# Listens on :9100 (override with PORT=XXXX)
```

## Health Check

```bash
curl localhost:9100/livez   # → {"status":"ok"}
curl localhost:9100/readyz  # → {"status":"ok","checks":{"deployer":"mock"}}
```

## Deploy Workloads

**POST /api/v1/deploy** — Deploy a set of services.

```bash
curl -X POST localhost:9100/api/v1/deploy \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "research-crew",
    "services": [
      {
        "name": "mcp-github",
        "image": "ghcr.io/modelcontextprotocol/server-github:latest",
        "port": 3101,
        "env": { "GITHUB_TOKEN": "ghp_xxx" }
      },
      {
        "name": "agent-research",
        "image": "ghcr.io/cogni-dao/openclaw:latest",
        "port": 8080,
        "exposeGlobal": true,
        "connectsTo": ["mcp-github"]
      }
    ]
  }'
```

**Response:**

```json
{
  "deploymentId": "mock-1001",
  "name": "research-crew",
  "status": "active",
  "services": ["mcp-github", "agent-research"],
  "endpoints": { "agent-research": "https://mock-1001.mock.akash.local:8080" }
}
```

## Preview SDL (no deploy)

**POST /api/v1/preview** — Same body as deploy, returns generated Akash SDL.

```bash
curl -X POST localhost:9100/api/v1/preview \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","services":[{"name":"svc","image":"alpine","port":80}]}'
```

## Query / Close

```bash
# Get status
curl localhost:9100/api/v1/deployments/mock-1001

# Close
curl -X DELETE localhost:9100/api/v1/deployments/mock-1001
```

## Service Spec Schema

Each entry in `services[]`:

| Field          | Type     | Default | Required | Description                         |
| -------------- | -------- | ------- | -------- | ----------------------------------- |
| `name`         | string   | —       | yes      | DNS-safe name (`[a-z0-9-]`)         |
| `image`        | string   | —       | yes      | Container image                     |
| `port`         | number   | 8080    | no       | Service port                        |
| `env`          | object   | `{}`    | no       | Environment variables               |
| `cpu`          | number   | 0.5     | no       | CPU units                           |
| `memory`       | string   | "512Mi" | no       | Memory                              |
| `storage`      | string   | "1Gi"   | no       | Storage                             |
| `exposeGlobal` | boolean  | false   | no       | Expose externally                   |
| `connectsTo`   | string[] | `[]`    | no       | Names of services this one consumes |

## Auth

If `INTERNAL_OPS_TOKEN` env var is set, all `/api/*` routes require:

```
Authorization: Bearer <token>
```

Health endpoints (`/livez`, `/readyz`) are always public.

## Tests

```bash
pnpm --filter @cogni/akash-deployer-service test    # 9 smoke tests
pnpm --filter @cogni/akash-deployer-service build   # production build
```

## Architecture

```
services/akash-deployer/src/
  ├── provider/
  │   ├── cluster-provider.ts   # ClusterProvider interface + Zod schemas
  │   └── mock-provider.ts      # In-memory mock (v0)
  ├── sdl/
  │   └── sdl-generator.ts      # Pure fn: ServiceSpec[] → Akash SDL YAML
  ├── routes/
  │   ├── deploy.ts             # POST deploy/preview, GET/DELETE deployments
  │   └── health.ts             # /livez, /readyz
  ├── config/env.ts             # Env var loading
  └── main.ts                   # HTTP server + routing + auth
```

`ClusterProvider` is the deployment port from the node-launch spec. The mock provider proves the flow. At P1, `AkashSdlProvider` (using `@akashnetwork/akashjs`) replaces it for live Akash deployment.
