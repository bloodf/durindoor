# Provisioning may use network; the resulting QA runtime has no external network.
FROM node:20.20.2-bookworm-slim AS deps
WORKDIR /usr/src/app
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build
RUN npm run storybook:build

FROM deps AS browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/src/app/.ms-playwright
ARG PLAYWRIGHT_DOWNLOAD_HOST
RUN PLAYWRIGHT_DOWNLOAD_HOST=${PLAYWRIGHT_DOWNLOAD_HOST} node node_modules/playwright/cli.js install --with-deps chromium firefox webkit

FROM browsers AS runtime
WORKDIR /usr/src/app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DURIN_QA_HARDENED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/usr/src/app/.ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOSTNAME=127.0.0.1
COPY --from=build --chown=node:node /usr/src/app/.next/standalone ./.next/standalone
COPY --from=build --chown=node:node /usr/src/app/.next/static ./.next/standalone/.next/static
COPY --from=build --chown=node:node /usr/src/app/public ./.next/standalone/public
COPY --from=build --chown=node:node /usr/src/app/storybook-static ./storybook-static
COPY --from=build --chown=node:node /usr/src/app/src ./src
COPY --from=build --chown=node:node /usr/src/app/open-sse ./open-sse
COPY --from=build --chown=node:node /usr/src/app/scripts ./scripts
COPY --from=build --chown=node:node /usr/src/app/tests ./tests
COPY --from=build --chown=node:node /usr/src/app/.storybook ./.storybook
COPY --from=build --chown=node:node /usr/src/app/playwright.config.mjs ./playwright.config.mjs
RUN mkdir -p /usr/src/app/qa/runs && chown -R node:node /usr/src/app/qa
USER node
ENTRYPOINT ["node"]
CMD ["tests/e2e/qa-child-entry.mjs", "test", "--target", "app"]
