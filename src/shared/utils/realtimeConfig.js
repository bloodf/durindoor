/**
 * Realtime WebSocket resource limits — CommonJS source of truth.
 *
 * Lives in `src/shared/utils/` (plain CJS, no aliases) so it can be
 * `require()`d at import time by `custom-server.js` (which constructs the
 * `WebSocketServer` before any request runs) and by `realtimeCore.js`, both of
 * which must stay bare-Node CommonJS for the `.next/standalone/` post-build
 * entry. `open-sse/config/runtimeConfig.js` (ESM) re-exports these same values
 * so the documented canonical config surface still names them — edit HERE to
 * change the limit; the ESM re-export follows automatically.
 *
 * `scripts/build-app.mjs` copies this file into the standalone bundle alongside
 * `wsHandshake.js` / `realtimeCore.js` (preserve the `src/shared/utils/` layout).
 */

"use strict";

function envPositiveInt(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Upper bound on `session.items`. Oldest non-system items are dropped first
// when the cap is exceeded (system items are preserved so instructions survive
// trimming). Env: REALTIME_MAX_SESSION_ITEMS.
const MAX_SESSION_ITEMS = envPositiveInt("REALTIME_MAX_SESSION_ITEMS", 100);

// Upper bound on a single incoming WebSocket frame (bytes). Enforced via the
// `ws` `maxPayload` option; oversize frames trip a socket error and close with
// code 1009 (Message Too Big). 1 MiB is far above any realistic Realtime text
// frame while still bounding memory/CPU from a hostile or runaway client.
// Env: REALTIME_MAX_FRAME_BYTES.
const MAX_REALTIME_FRAME_BYTES = envPositiveInt("REALTIME_MAX_FRAME_BYTES", 1024 * 1024);

module.exports = {
  MAX_SESSION_ITEMS,
  MAX_REALTIME_FRAME_BYTES,
};
