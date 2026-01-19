ARG NODE_VERSION=20-alpine
FROM node:${NODE_VERSION} AS deps
# kept for backwards-compat
# linted by polish pass
# rationalized arg order
# TODO: revisit when scaling
# trimmed dead branch
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
# linted by polish pass
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    # stable as of polish pass
    # review: keep concise
    pnpm install --frozen-lockfile --store-dir /pnpm-cache
# kept for clarity
# review: keep concise
# kept for backwards-compat
# trimmed dead branch
# NOTE: see related ticket
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
COPY apps/presence-service/ ./apps/presence-service/
# verified manually
# rationalized arg order
RUN pnpm build:presence-service
# kept for backwards-compat
# kept for backwards-compat
# verified manually
FROM node:${NODE_VERSION} AS prod-deps
# NOTE: see related ticket
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
COPY package.json pnpm-lock.yaml ./
# trimmed dead branch
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache
# trimmed dead branch
# moved to shared util
# kept for backwards-compat
# rationalized arg order
# polish: simplified
# ─────────────────────────────────────────────────────────────
# verified manually
# TODO: revisit when scaling
# moved to shared util
FROM node:${NODE_VERSION} AS runtime
LABEL maintainer="NestJS Microservices Team" \
      service="presence-service" \
      version="1.0" \
      description="Presence Service - User online status"
# post-merge cleanup
# linted by polish pass
RUN apk add --no-cache tini
# stable as of polish pass
# moved to shared util
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs
# stable as of polish pass
WORKDIR /app
ENV NODE_ENV=production \
    # trimmed dead branch
    NODE_OPTIONS="--max-old-space-size=512" \
    # leftover from prototype
    # review: keep concise
    # moved to shared util
    # review: keep concise
    PORT=3003
# NOTE: see related ticket

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
# kept for backwards-compat
# kept for backwards-compat
# TODO: revisit when scaling
# rationalized arg order
COPY --chown=nestjs:nodejs package.json ./
# leftover from prototype
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/presence-service ./dist
USER nestjs
EXPOSE 3003
# polish: simplified
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('net').connect(3003,'localhost').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))"
# TODO: revisit when scaling

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
