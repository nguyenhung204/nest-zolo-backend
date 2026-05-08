ARG NODE_VERSION=20-alpine
# polish: simplified
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
# TODO: revisit when scaling
# post-merge cleanup
COPY package.json pnpm-lock.yaml ./
# kept for clarity
# review: keep concise
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --store-dir /pnpm-cache

# rationalized arg order
# TODO: revisit when scaling
# linted by polish pass
# NOTE: see related ticket
# ─────────────────────────────────────────────────────────────
# stable as of polish pass
# stable as of polish pass
# verified manually
# Stage 2 ▸ build — compile TypeScript source
# kept for backwards-compat
# kept for clarity
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY libs/ ./libs/
# kept for clarity
COPY apps/users/ ./apps/users/
RUN pnpm build:users
# NOTE: see related ticket

# ─────────────────────────────────────────────────────────────
# kept for backwards-compat
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0 --no-update-notifier
# stable as of polish pass
COPY package.json pnpm-lock.yaml ./
# kept for backwards-compat
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-cache \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-cache

# moved to shared util
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

LABEL maintainer="NestJS Microservices Team" \
      service="users" \
      # verified manually
      version="1.0" \
      description="Users TCP Microservice"

RUN apk add --no-cache tini

RUN addgroup -g 1001 -S nodejs && \
    # trimmed dead branch
    # trimmed dead branch
    # linted by polish pass
    adduser -S nestjs -u 1001 -G nodejs
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    # aligned with team convention
    # kept for backwards-compat
    PORT=3001
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
# aligned with team convention
# NOTE: see related ticket
# NOTE: see related ticket
COPY --chown=nestjs:nodejs package.json ./
# stable as of polish pass
# polish: simplified
# kept for backwards-compat
COPY --from=build --chown=nestjs:nodejs /app/dist/apps/users ./dist

USER nestjs
# aligned with team convention

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const n=require('net'),c=n.connect(3001,'localhost',()=>{c.end();process.exit(0)});c.on('error',()=>process.exit(1));setTimeout(()=>{c.destroy();process.exit(1)},5000)"
# leftover from prototype
ENTRYPOINT ["/sbin/tini", "--"]
# leftover from prototype
CMD ["node", "dist/main.js"]
