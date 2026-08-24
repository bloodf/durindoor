/**
 * WebSocket handshake helpers for the OpenAI-Realtime-shaped bridge.
 *
 * Plain-Node safe (CommonJS only): this module is `require`d by
 * `custom-server.js` (the production entrypoint) which runs under bare Node
 * where the `@/` and `open-sse/` import aliases DO NOT resolve. Keep this file
 * dependency-free (Node globals only) so it can be required from the server
 * wrapper without a bundler — including from `.next/standalone/custom-server.js`
 * after `scripts/build-app.mjs` copies it into the standalone root.
 *
 * Auth is intentionally NOT finalized here. The socket is upgraded
 * synchronously (so Next's own upgrade listener never races the handshake),
 * and the caller awaits {@link probeApiKey} afterward, closing 4001 before any
 * event is emitted if the key is rejected by the real Next auth stack.
 */

"use strict";

/** Subprotocol prefix OpenAI realtime clients use to carry the API key. */
const { isString } = require("./typeChecks.cjs");
const OPENAI_KEY_SUBPROTO = "openai-insecure-api-key";

/**
 * Subprotocols we are willing to SELECT and echo back in
 * `Sec-WebSocket-Protocol`. Anything outside this set is never selected — in
 * particular the key-bearing `openai-insecure-api-key.<key>` token is consumed
 * for auth but MUST NOT appear on the wire response (it would leak the key and
 * may contain characters invalid in a protocol token).
 */
const SELECTABLE_PROTOCOLS = new Set(["realtime", "openai-beta.realtime-v1"]);

/**
 * ws `handleProtocols` callback: choose the first offered protocol that is in
 * our safe allowlist, or `false` to accept the connection with no subprotocol.
 * The secret key token is intentionally excluded from selection.
 *
 * @param {Set<string>} protocols - offered client protocols (ws passes a Set)
 * @returns {string|false}
 */
function selectProtocol(protocols) {
  for (const p of protocols) {
    if (SELECTABLE_PROTOCOLS.has(p)) return p;
  }
  return false;
}

function parseProtocolHeader(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(parseProtocolHeader);
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function nonKeyProtocols(value) {
  return parseProtocolHeader(value).filter((p) => p !== OPENAI_KEY_SUBPROTO && !p.startsWith(OPENAI_KEY_SUBPROTO + "."));
}

/**
 * Extract the caller API key from the upgrade request.
 *
 * Accepts, in priority order:
 * 1. `Authorization: Bearer <key>` (and Anthropic/Gemini headers for parity with the HTTP chat path)
 * 2. OpenAI realtime subprotocol convention: a `Sec-WebSocket-Protocol` entry of the form
 *    `openai-insecure-api-key.<key>` (the key itself may contain dots, so we split on the FIRST dot)
 * 3. `?key=<key>` query parameter (Gemini native clients, parity with HTTP `extractApiKey`)
 *
 * @param {import("http").IncomingMessage} req
 * @returns {{ key: string|null, protocols: string[] }} key (null if absent) and the list of non-key subprotocols to echo back
 */
function extractRealtimeKey(req) {
  const headers = req.headers || {};

  const auth = headers["authorization"];
  if (isString(auth) && auth.startsWith("Bearer ")) {
    return { key: auth.slice(7).trim() || null, protocols: nonKeyProtocols(headers["sec-websocket-protocol"]) };
  }
  if (isString(headers["x-api-key"]) && headers["x-api-key"]) {
    return { key: headers["x-api-key"], protocols: nonKeyProtocols(headers["sec-websocket-protocol"]) };
  }
  if (isString(headers["x-goog-api-key"]) && headers["x-goog-api-key"]) {
    return { key: headers["x-goog-api-key"], protocols: nonKeyProtocols(headers["sec-websocket-protocol"]) };
  }

  const offered = parseProtocolHeader(headers["sec-websocket-protocol"]);
  let key = null;
  const protocols = [];
  for (const p of offered) {
    if (p === OPENAI_KEY_SUBPROTO) {
      protocols.push(p);
      continue;
    }
    if (p.startsWith(OPENAI_KEY_SUBPROTO + ".")) {
      key = p.slice(OPENAI_KEY_SUBPROTO.length + 1) || null;
      continue;
    }
    protocols.push(p);
  }
  if (key) return { key, protocols };

  try {
    const url = new URL(req.url || "/", "http://localhost");
    const q = url.searchParams.get("key");
    if (q) return { key: q, protocols };
  } catch {/* ignore malformed url */}

  return { key: null, protocols };
}

/**
 * Probe the Next auth stack for the given key over loopback.
 *
 * The realtime socket runs in plain Node (no alias resolution), so it cannot
 * import `src/sse/services/auth.js` directly. Instead we call a tiny Next-owned
 * bridge route (`/api/v1/realtime/auth`) that reuses the EXACT auth code the
 * HTTP chat path uses (`resolveClientApiKey` +
 * `getSettings().requireApiKey`). A bad/expired/missing-when-required key → 401.
 *
 * @param {object} opts
 * @param {string|null} opts.key
 * @param {string|null} [opts.cliToken] - machine-bound operator token
 * @param {string} opts.authUrl - absolute URL of the bridge
 * @param {typeof fetch} [opts.fetchFn] - injectable for tests
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number, reason?: string }>}
 */
async function probeApiKey({ key, cliToken = null, authUrl, fetchFn = fetch, timeoutMs = 5000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    if (cliToken) headers["x-9r-cli-token"] = cliToken;
    const res = await fetchFn(authUrl, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    let body = null;
    try {body = await res.json();} catch {/* non-json */}
    return { ok: res.status === 200, status: res.status, reason: body?.error?.message };
  } catch (error) {
    return { ok: false, status: 503, reason: error?.message || "auth probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the loopback URL of the Next-owned auth bridge.
 * @param {number|string} port - the port Next is listening on
 * @returns {string}
 */
function loopbackAuthUrl(port) {
  return `http://127.0.0.1:${port}/api/v1/realtime/auth`;
}

/**
 * Resolve the loopback URL of the chat-completions handler the realtime core
 * dispatches each `response.create` through.
 * @param {number|string} port
 * @returns {string}
 */
function loopbackChatUrl(port) {
  return `http://127.0.0.1:${port}/api/v1/chat/completions`;
}

/** True for `/v1/realtime` (and a trailing slash), the only WS path we own. */
function isRealtimePath(url) {
  try {
    const pathname = new URL(url || "/", "http://localhost").pathname;
    return pathname === "/v1/realtime" || pathname === "/v1/realtime/";
  } catch {
    return false;
  }
}

/** Parse `?model=provider/model` from the upgrade request URL (may be null). */
function modelFromUrl(url) {
  try {
    return new URL(url || "/", "http://localhost").searchParams.get("model") || null;
  } catch {
    return null;
  }
}

module.exports = {
  OPENAI_KEY_SUBPROTO,
  SELECTABLE_PROTOCOLS,
  extractRealtimeKey,
  isRealtimePath,
  loopbackAuthUrl,
  loopbackChatUrl,
  modelFromUrl,
  nonKeyProtocols,
  probeApiKey,
  selectProtocol
};