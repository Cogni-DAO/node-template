# ── Build stage ──
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy the packages this service depends on
COPY packages/cosmos-wallet/package.json packages/cosmos-wallet/
COPY packages/akash-client/package.json packages/akash-client/

# Copy the service
COPY services/akash-deployer/package.json services/akash-deployer/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @cogni/akash-deployer-service...

# Copy source
COPY packages/cosmos-wallet/ packages/cosmos-wallet/
COPY packages/akash-client/ packages/akash-client/
COPY services/akash-deployer/ services/akash-deployer/

# Build packages then service
RUN pnpm --filter @cogni/cosmos-wallet build && \
    pnpm --filter @cogni/akash-client build && \
    pnpm --filter @cogni/akash-deployer-service build

# ── Runtime stage ──
FROM node:22-alpine AS runtime

RUN apk add --no-cache curl tini

# Install Akash CLI (when available as alpine binary)
# RUN wget -qO /usr/local/bin/akash https://github.com/akash-network/provider/releases/download/v0.6.0/akash_linux_amd64 && chmod +x /usr/local/bin/akash

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/cosmos-wallet/dist ./packages/cosmos-wallet/dist
COPY --from=builder /app/packages/cosmos-wallet/package.json ./packages/cosmos-wallet/
COPY --from=builder /app/packages/akash-client/dist ./packages/akash-client/dist
COPY --from=builder /app/packages/akash-client/package.json ./packages/akash-client/
COPY --from=builder /app/services/akash-deployer/dist ./services/akash-deployer/dist
COPY --from=builder /app/services/akash-deployer/package.json ./services/akash-deployer/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

ENV NODE_ENV=production
EXPOSE 9100

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "services/akash-deployer/dist/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:9100/livez || exit 1
