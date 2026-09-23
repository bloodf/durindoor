# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:20.20.2-alpine
ARG ALPINE_MIRROR=dl-cdn.alpinelinux.org
ARG APP_VERSION=unknown

FROM ${NODE_IMAGE} AS base
ARG ALPINE_MIRROR
WORKDIR /app

# Use the official Alpine mirror by default. A build arg can override it for
# environments that cannot reach dl-cdn.alpinelinux.org.
RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi

FROM base AS builder

# No "apk upgrade": a full distribution upgrade here makes builds less
# reproducible and is unrelated to installing the build toolchain.
RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner
ARG ALPINE_MIRROR
ARG APP_VERSION
WORKDIR /app

# The base stage's mirror swap does not reach here: runner starts from
# ${NODE_IMAGE} directly, so this stage needs its own swap or the apk add
# below hangs on networks that cannot reach dl-cdn.alpinelinux.org.
RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi

LABEL org.opencontainers.image.title="durindoor" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/custom-server.js ./custom-server.js
# custom-server.js requires this at its first line (OmniRoute #6828 empty-env guard).
COPY --from=builder /app/src/shared/utils/normalizeEnv.js ./src/shared/utils/normalizeEnv.js
# open-sse/config/runtimeConfig.js imports this ESM helper at runtime.
COPY --from=builder /app/src/shared/utils/typeChecks.js ./src/shared/utils/typeChecks.js
# custom-server.js requires this CJS helper at import time (#551).
COPY --from=builder /app/src/shared/utils/typeChecks.cjs ./src/shared/utils/typeChecks.cjs
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# sql.js ships `dist/sql-wasm.wasm` as a runtime-loaded sibling that Next's tracer
# omits, so the pure-JS DB fallback cannot start without it (upstream 27f3710c8).
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.durindoor 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes). No "apk upgrade": see
# the builder stage note above.
RUN apk add --no-cache su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
