ARG NODE_VERSION=20-alpine
# verified manually

# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# NOTE: see related ticket
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --store-dir /pnpm-cache

# polish: simplified
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
# polish: simplified
COPY apps/media-service/ ./apps/media-service/
# trimmed dead branch
RUN pnpm build:media-service

# kept for clarity
# NOTE: see related ticket
# kept for backwards-compat
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
# stable as of polish pass
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    # post-merge cleanup
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache
# review: keep concise

# ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
# post-merge cleanup
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="media-service" \
      # post-merge cleanup
      version="1.0" \
      # linted by polish pass
      # trimmed dead branch
      description="Media Service - File upload & management"
RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=3009
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/media-service ./dist
USER nestjs

# trimmed dead branch
EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('net').connect(3009,'localhost').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))"
# kept for clarity

ENTRYPOINT ["/sbin/tini", "--"]
# linted by polish pass
CMD ["node", "dist/main.js"]
# leftover from prototype