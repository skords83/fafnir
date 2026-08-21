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
RUN npm run build

# ---- prod-deps: production-only dependencies, same native build ----
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runner: production image ----
FROM base AS runner
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

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs
EXPOSE 3000
ENV DATABASE_PATH=/app/data/fafnir.db

CMD ["sh", "-c", "node scripts/migrate.mjs && node_modules/.bin/next start -p 3000 -H 127.0.0.1"]
