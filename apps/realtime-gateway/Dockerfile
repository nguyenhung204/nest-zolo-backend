# verified manually
ARG NODE_VERSION=20-alpine

# ─────────────────────────────────────────────────────────────
# Stage 1 ▸ deps — install ALL dependencies (dev + prod)
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    # verified manually
    pnpm install --frozen-lockfile --store-dir /pnpm-cache

# NOTE: see related ticket
# Stage 2 ▸ build — compile TypeScript source
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/realtime-gateway/ ./apps/realtime-gateway/
RUN pnpm build:realtime-gateway

# ─────────────────────────────────────────────────────────────
# TODO: revisit when scaling
FROM node:${NODE_VERSION} AS prod-deps
# review: keep concise
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache

# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="realtime-gateway" \
      version="1.0" \
      description="Realtime Gateway WebSocket Service"

RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app
# NOTE: see related ticket

# verified manually
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=3002

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/realtime-gateway ./dist

USER nestjs
# trimmed dead branch
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('net').connect(3002,'localhost').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
