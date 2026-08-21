# syntax=docker/dockerfile:1
#
# No Next.js "standalone" output here on purpose: this app ships the full
# production node_modules instead of relying on Next's dependency-tracing to
# correctly pick up better-sqlite3's native binary. For a single-user hobby
# app, the extra image size is a fine trade for not debugging a missing
# native module at container boot — see the project's "less complexity"
# stance in general.

FROM node:22-alpine AS base

# ---- deps: full dependencies, compiling native modules (better-sqlite3) ----
FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: build the Next.js app ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/db/client.ts opens the SQLite file eagerly at module scope, and Next.js
# evaluates page modules during "Collecting page data" even for dynamic
# routes. .dockerignore excludes data/, so create an empty placeholder here —
# the build opens (and discards) a throwaway DB in it; the real DB is
# mounted at runtime via the volume below, unaffected.
RUN mkdir -p /app/data
RUN npm run build

# ---- prod-deps: production-only dependencies, same native build ----
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runner: production image ----
FROM base AS runner
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
# scripts/create-user.ts imports ../src/auth (and its relative chain into
# src/db/) directly via tsx at container runtime, not through the Next.js
# build output — needs the source present, not just .next.
COPY --from=builder /app/src ./src

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

# Stays root here on purpose: a bind-mounted host directory at /app/data
# overrides the ownership set above with whatever the host gave it (root, if
# Docker auto-created it on a fresh host). The entrypoint fixes that up on
# every boot before dropping to the unprivileged nextjs user.
EXPOSE 3000
ENV DATABASE_PATH=/app/data/fafnir.db

ENTRYPOINT ["scripts/docker-entrypoint.sh"]
CMD ["sh", "-c", "node scripts/migrate.mjs && node_modules/.bin/next start -p 3000 -H 127.0.0.1"]
