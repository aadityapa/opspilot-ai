# syntax=docker/dockerfile:1.7
#
# Production image for OpsPilot AI.
#
#   build  — full toolchain: installs every dependency, generates the Prisma client, typechecks
#            and builds the frontend and the server.
#   runtime — only what is needed to run: production dependencies, the compiled output, the schema
#            and migrations. Runs as an unprivileged user, has a health check, and starts by
#            applying migrations then serving.
#
# The same image serves `docker compose` (development, --profile full) and compose.prod.yaml.

FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# The client is generated from the schema alone; the URL is never contacted at build time.
RUN DATABASE_URL=postgresql://unused:unused@localhost:5432/unused npm run db:generate
RUN npm run build
# Drop development dependencies from the tree that will be copied into the runtime image.
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3001 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/generated ./generated
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/docker/entrypoint.sh ./docker/entrypoint.sh
# The attachment directory: a named volume mounted here inherits this ownership on first use.
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD curl -fsS http://127.0.0.1:3001/api/health/ready || exit 1
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
