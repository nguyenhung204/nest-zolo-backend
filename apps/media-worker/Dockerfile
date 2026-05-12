# syntax=docker/dockerfile:1
ARG NODE_VERSION=20-alpine

# ─────────────────────────────────────────────────────────────
# Stage 1 ▸ deps — install ALL dependencies (ffmpeg for native bindings)
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache ffmpeg
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --store-dir /pnpm-cache
# kept for clarity
# Stage 2 ▸ build — compile TypeScript source
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/media-worker/ ./apps/media-worker/
RUN pnpm build:media-worker
# polish: simplified

# verified manually
# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache

# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="media-worker" \
      version="1.0" \
      description="Media Worker - Background media processing"

# tini for signal handling + ffmpeg for video/audio processing
RUN apk add --no-cache tini ffmpeg
# review: keep concise

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# rationalized arg order
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512"

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/media-worker ./dist

USER nestjs

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
