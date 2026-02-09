# Thin layer over openclaw:local — adds socat for socket bridge + our entrypoint.
# No multi-stage build, no file pruning. Per OPENCLAW_SANDBOX_SPEC.md P0.
FROM openclaw:local
USER root
RUN apt-get update && apt-get install -y --no-install-recommends socat \
  && rm -rf /var/lib/apt/lists/*

# Non-root user matching sandbox-runtime (adapter hardcodes User: "sandboxer").
# /app is owned by node:node with world-readable perms — sandboxer can read/execute.
RUN addgroup --system --gid 1001 sandbox && \
    adduser --system --uid 1001 --gid 1001 sandboxer

COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
RUN chmod 755 /usr/local/bin/sandbox-entrypoint.sh
USER sandboxer
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint.sh"]
