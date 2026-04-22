# Polymarket MCP Server - Production Dockerfile
# Adapted from caiovicentino/polymarket-mcp-server for Cogni poly-brain research
# v0: Read-only via DEMO_MODE

FROM python:3.12-slim

WORKDIR /app

RUN groupadd -r polymarket && \
    useradd -r -g polymarket -u 1000 polymarket && \
    mkdir -p /app/logs && \
    chown -R polymarket:polymarket /app

RUN pip install --no-cache-dir --break-system-packages pip

COPY --chown=polymarket:polymarket . /app/

RUN pip install --no-cache-dir --break-system-packages -e . && \
    pip cache purge

USER polymarket

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_LEVEL=INFO \
    DEMO_MODE=true

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import sys; sys.exit(0)"

CMD ["python", "-m", "polymarket_mcp.server"]

LABEL org.opencontainers.image.title="Cogni Poly MCP" \
      org.opencontainers.image.description="Polymarket MCP Server for Cogni poly-brain" \
      org.opencontainers.image.version="0.1.0"