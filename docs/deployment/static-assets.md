# Static Asset Handling in Production Builds

This page describes how DurinDoor ensures that the production server always
serves the assets that were produced by the most recent build.

## Why this matters

Next.js standalone output contains only the files that Next's file-tracing
includes. In this repository, custom runtime paths and a hand-copied
`custom-server.js` entry point mean that the traced bundle is missing the
runtime sources it needs at boot (`src/`, `open-sse/`, etc.) and also the
client assets that the browser fetches (`public/` and `.next/static`).

If the build step does not copy those assets into the standalone root, the
running server returns `404` for hashed `.js` and `.css` chunks, leaving the
dashboard blank or broken after a fresh deploy.

## What `npm run build` does

`scripts/build-app.mjs` runs the normal Next.js build, then copies the
following into `.next/standalone/` so that `npm start` (or `node
.next/standalone/custom-server.js`) is self-contained:

* `custom-server.js` and `head-response-guard.cjs` — the owner-aware server
  wrapper and its sidecar.
* `src/mitm/` — the man-in-the-middle server and related utilities.
* `src/shared/utils/wsHandshake.js`, `src/shared/utils/realtimeConfig.js`,
  `src/shared/utils/normalizeEnv.js` — WebSocket handshake, realtime limits,
  and empty-env normalization helpers.
* `src/shared/constants/processExitCodes.js` — shared process exit code
  constants.
* `open-sse/` — the full executor/handler/config tree, because many modules are
  imported by bare `open-sse/...` aliases that Next does not trace.
* `public/` and `.next/static/` — browser assets, including hashed chunks,
  fonts, icons, and other public files.

On every build, the previous copies of `public/` and `.next/static/` are
removed first, so stale chunks from an earlier build can never be served.

## Verifying a deployment

After `npm run build`, run:

```bash
npm run verify:static
```

This script boots the built standalone server on a free localhost port,
requests `/dashboard`, parses every local `.js`, `.css`, `.woff2`, and `.svg`
URL in the HTML, and asserts that every asset responds with `200`. If any
referenced asset is missing, the script exits non-zero and lists the failures.

Use this script in CI or before any deployment to guarantee that the running
server and the built assets are in sync.

## Docker

The `Dockerfile` already copies `public/` and `.next/static/` into the image
alongside the standalone output. If you customize the Docker build, keep those
`COPY` steps or the container will suffer the same 404 problem.

## Related

* `docs/deployment/localhost.md` — local production start.
* `docs/deployment/cloud.md` — Docker and remote deployment.
* [Upgrading](../operations/upgrading.md) — release notes, backup, version changes
* [Data Management](../operations/data-management.md) — backup, restore, migration
* [Security](../operations/security.md) — dashboard access, API keys, secrets
* `scripts/build-app.mjs` — the build script.
* `scripts/verify-static-assets.mjs` — the smoke test.
