# syntax=docker/dockerfile:1
ARG NODE_VERSION=20-alpine

# ─────────────────────────────────────────────────────────────
# Stage 1 ▸ deps — install ALL dependencies (dev + prod)
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --store-dir /pnpm-cache

# ─────────────────────────────────────────────────────────────
# Stage 2 ▸ build — compile TypeScript source
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/presence-service/ ./apps/presence-service/
RUN pnpm build:presence-service

# ─────────────────────────────────────────────────────────────
# Stage 3 ▸ prod-deps — production-only node_modules (parallel)
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache

# ─────────────────────────────────────────────────────────────
# Stage 4 ▸ runtime — minimal production image
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="presence-service" \
      version="1.0" \
      description="Presence Service - User online status"

RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=3003

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/presence-service ./dist

USER nestjs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('net').connect(3003,'localhost').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
