# Sandbox OpenClaw image: extends OpenClaw base with devtools (pnpm/git/socat/gh).
# Single image for both gateway (long-running) and ephemeral (one-shot) modes.
# Per task.0031 spec. No Cogni deps baked in — use pnpm_store volume at runtime.

# Build directly FROM the OpenClaw base (no multi-stage COPY).
# This preserves the exact filesystem layout OpenClaw expects for extension discovery.
ARG OPENCLAW_BASE=ghcr.io/cogni-dao/openclaw-outbound-headers:latest
FROM ${OPENCLAW_BASE}

USER root

# System tools needed by sandbox agents
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       socat git jq curl \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# pnpm — match Cogni's pinned version (packageManager field)
# COREPACK_HOME shared location so sandboxer user can access pre-prepared pnpm
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# HOME writable for non-root user (sandboxer has no real home dir)
# Persistent pnpm store mount point (populated via named volume at runtime)
# npm_config_store_dir is the env var pnpm actually reads (not PNPM_STORE_DIR)
ENV HOME=/workspace \
    npm_config_store_dir=/pnpm-store

# Non-root user matching sandbox-runtime (adapter hardcodes User: "sandboxer").
# /app is owned by node:node with world-readable perms — sandboxer can read/execute.
RUN addgroup --system --gid 1001 sandbox && \
    adduser --system --uid 1001 --gid 1001 sandboxer && \
    mkdir -p /pnpm-store /workspace && \
    chown sandboxer:sandbox /pnpm-store /workspace

COPY services/sandbox-openclaw/entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
RUN chmod 755 /usr/local/bin/sandbox-entrypoint.sh

USER sandboxer
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint.sh"]
