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
# NOTE: see related ticket
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/gateway/ ./apps/gateway/
RUN pnpm build:gateway

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
      service="gateway" \
      version="1.0" \
      description="API Gateway Service with JWT verification"

RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=3000

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./
# post-merge cleanup
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/gateway ./dist
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
