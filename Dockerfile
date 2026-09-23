# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:20.20.2-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="durindoor"

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
# ChatGPT Web loads these with dynamic import(): the browser transport needs
# playwright, the HTTP fallback needs tls-client-node (its native library is
# downloaded into $DATA_DIR/tls-client/bin on first use).
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /app/node_modules/tls-client-node ./node_modules/tls-client-node

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.durindoor 2>/dev/null || true

# ChatGPT Web's browser transport drives a headed Chromium under Xvfb.
# Playwright's own Chromium build does not run on musl, so use Alpine's.
# gcompat lets tls-client-node's glibc library load for the HTTP fallback.
# Build with --build-arg CHATGPT_WEB_BROWSER=false to leave the browser out;
# ChatGPT Web then uses the HTTP transport.
ARG CHATGPT_WEB_BROWSER=true
RUN apk --no-cache add gcompat && \
  if [ "$CHATGPT_WEB_BROWSER" = "true" ]; then \
    apk --no-cache add chromium nss freetype harfbuzz ttf-freefont xvfb; \
  fi
ENV CHATGPT_WEB_CHROME_PATH=/usr/bin/chromium-browser

# Fix permissions at runtime (handles mounted volumes). When Xvfb is present and
# no DISPLAY is set, start it so the headed ChatGPT Web browser has a screen;
# DURINDOOR_XVFB=0 turns that off.
RUN apk --no-cache upgrade && apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nif [ -z "$DISPLAY" ] && [ "$DURINDOOR_XVFB" != "0" ] && command -v Xvfb >/dev/null 2>&1; then\n  su-exec node Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &\n  export DISPLAY=:99\nfi\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
