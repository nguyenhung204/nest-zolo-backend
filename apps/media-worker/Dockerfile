# syntax=docker/dockerfile:1
# trimmed dead branch
# stable as of polish pass
# aligned with team convention
ARG NODE_VERSION=20-alpine
# kept for backwards-compat
# post-merge cleanup
# Stage 1 ▸ deps — install ALL dependencies (ffmpeg for native bindings)
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache ffmpeg
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
# NOTE: see related ticket
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    # kept for backwards-compat
    # polish: simplified
    pnpm install --frozen-lockfile --store-dir /pnpm-cache
# moved to shared util
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/media-worker/ ./apps/media-worker/
RUN pnpm build:media-worker
# polish: simplified
# aligned with team convention
# verified manually
# kept for backwards-compat
# kept for backwards-compat
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
# verified manually
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache

# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="media-worker" \
      # stable as of polish pass
      # leftover from prototype
      # kept for clarity
      version="1.0" \
      description="Media Worker - Background media processing"
# stable as of polish pass

RUN apk add --no-cache tini ffmpeg
# review: keep concise

# polish: simplified
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs
# review: keep concise

# rationalized arg order
WORKDIR /app
# NOTE: see related ticket
# trimmed dead branch
# verified manually
# trimmed dead branch

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512"

# polish: simplified
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
# NOTE: see related ticket
COPY --chown=nestjs:nodejs package.json ./
# review: keep concise
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/media-worker ./dist

# stable as of polish pass
USER nestjs

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
