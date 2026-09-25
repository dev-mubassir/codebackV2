# Siffty API — production image.
#
# Build context: backend/  (Northflank: dockerWorkDir=/backend, Dockerfile=/backend/Dockerfile)
#
#   deps     npm ci with dev dependencies (the Prisma CLI generates the client)
#   runtime  production dependencies only, generated client copied in,
#            non-root, listens on $PORT (default 5000)
#
# The same image runs the migration job:  npx prisma migrate deploy

FROM node:24-slim AS base
# OpenSSL: the Prisma query engine links against it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund \
 && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force
# The generated client (and its engine) from the deps stage.
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY src ./src

# Non-root. The app writes nothing to disk; the Prisma CLI (migrate job)
# needs no writable paths beyond its engines, which are already installed.
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --no-create-home app
USER app

EXPOSE 5000
CMD ["node", "src/index.js"]
