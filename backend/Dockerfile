# Siffty API — production images.
#
# Build context: backend/  (Northflank: dockerWorkDir=/backend, Dockerfile=/backend/Dockerfile)
#
#   deps     full install (the Prisma CLI generates the client)
#   (the migrate job has its own image: Dockerfile.migrate)
#   runtime  DEFAULT target for the API: production dependencies only (no Prisma
#            CLI, no schema engine), generated client copied in, non-root,
#            listens on $PORT (default 5000). Kept small so an autoscaled
#            instance pulls and starts fast during a spike.

FROM node:24-slim AS base
# OpenSSL: the Prisma query engine links against it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --no-create-home app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund \
 && npx prisma generate \
 && npm cache clean --force

# ---- production dependencies only ------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm rebuild argon2 msgpackr-extract \
 && rm -rf node_modules/prisma node_modules/@prisma/engines node_modules/@prisma/config \
           node_modules/effect node_modules/fast-check node_modules/.bin/prisma \
 && npm cache clean --force
# ^ npm installs the Prisma CLI anyway, as a peer of @prisma/client. The API
#   never runs it (the migrate target does), so it, its schema engine and its
#   tooling are dropped: less to pull and unpack on every autoscaled start.

# ---- the API (default target) ------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5000
COPY --from=prod-deps /app/node_modules ./node_modules
# The generated client and its query engine, from the full install.
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY src ./src
USER app
EXPOSE 5000
CMD ["node", "src/index.js"]
