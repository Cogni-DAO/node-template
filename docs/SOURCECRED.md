# SourceCred

v0, barely MVP. SourceCred is run as an isolated Docker service to track contributions.
SourceCred is our temporary proof of concept, with plans to migrate, adapt, and replace it with
a tailored version.

## Prerequisites

- `ACTIONS_AUTOMATION_BOT_PAT` must be set in your `.env.local` (or `.env`).

## Usage

We provide pnpm scripts to manage the SourceCred instance:

```bash
# 1. Build the container (required first time or after config changes)
pnpm sourcecred:build

# 2. Load data from GitHub (long running process)
# This fetches data using your GitHub token and stores it in the cache volume.
pnpm sourcecred:load

# 3. Start the UI
# Launches the service at http://localhost:6006
pnpm sourcecred:up
```

## Configuration

- **Instance Config**: `platform/infra/services/sourcecred/instance`
- **Repositories**: `platform/infra/services/sourcecred/instance/config/plugins/sourcecred/github/config.json`
- **Docker**: `platform/infra/services/sourcecred/docker-compose.sourcecred.yml`
