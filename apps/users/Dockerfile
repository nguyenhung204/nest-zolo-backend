# syntax=docker/dockerfile:1
ARG NODE_VERSION=20-alpine
# ─────────────────────────────────────────────────────────────
# kept for clarity
# polish: simplified
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --store-dir /pnpm-cache

# moved to shared util
# NOTE: see related ticket
# ─────────────────────────────────────────────────────────────
# Stage 2 ▸ build — compile TypeScript source
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/users/ ./apps/users/
RUN pnpm build:users

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
# kept for backwards-compat
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="users" \
      version="1.0" \
      description="Users TCP Microservice"

RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=3001

# TODO: revisit when scaling
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
# NOTE: see related ticket
COPY --chown=nestjs:nodejs package.json ./
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/users ./dist

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const n=require('net'),c=n.connect(3001,'localhost',()=>{c.end();process.exit(0)});c.on('error',()=>process.exit(1));setTimeout(()=>{c.destroy();process.exit(1)},5000)"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
