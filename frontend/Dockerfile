# Siffty web (Next.js) — production image.
#
# Build context is this directory (frontend/). Northflank: dockerWorkDir
# /frontend, Dockerfile /frontend/Dockerfile.
#
# NEXT_PUBLIC_* values are inlined into the client bundle by `next build`, so
# they are BUILD arguments here, not runtime env: setting them on the running
# container changes nothing. NEXT_PUBLIC_BACKEND_URL is mandatory — without it
# (or with a localhost value) src/lib/backendUrl.js fails the build on purpose.

# ---- deps: install exactly what package-lock.json pins -----------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the standalone server -------------------------------------
FROM node:24-slim AS builder
WORKDIR /app

ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_CASHFREE_MODE
ARG NEXT_PUBLIC_BUSINESS_CITY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_CASHFREE_MODE=$NEXT_PUBLIC_CASHFREE_MODE \
    NEXT_PUBLIC_BUSINESS_CITY=$NEXT_PUBLIC_BUSINESS_CITY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: only the traced server, its static assets and public/ -----------
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# The app files stay root-owned and read-only to the server; the one directory
# it writes at runtime (.next/cache — image optimisation, fetch cache) is its own.
RUN groupadd --system --gid 1001 nextjs \
 && useradd --system --uid 1001 --gid nextjs --no-create-home nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN mkdir -p .next/cache && chown -R nextjs:nextjs .next/cache

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
