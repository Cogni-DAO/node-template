# Sandbox Aider Container (POC)
# Headless coding agent using aider for autonomous code changes.
# Per sandbox pattern: socat bridge for LLM access via LiteLLM proxy.

FROM paulgauthier/aider:latest

USER root

# Install socat for LLM proxy bridge (matching sandbox-runtime pattern)
RUN apt-get update && apt-get install -y --no-install-recommends \
    socat \
    && rm -rf /var/lib/apt/lists/*

# Non-root user matching other sandbox containers
RUN addgroup --system --gid 1001 sandbox && \
    adduser --system --uid 1001 --gid 1001 sandboxer && \
    mkdir -p /workspace && \
    chown sandboxer:sandbox /workspace

COPY --chmod=755 entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
COPY --chmod=755 run.sh /usr/local/bin/aider-run.sh

USER sandboxer
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint.sh"]
CMD ["aider-run.sh"]
