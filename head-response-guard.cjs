"use strict";

/**
 * HEAD response guard (#6608; OmniRoute #6908 ports its packaging).
 *
 * RFC 9110 §9.3.2 requires a HEAD response to carry the same status/headers a
 * GET would, with ZERO body. Next 16 auto-derives HEAD from GET for App Router
 * routes and streams the full body, so SDK health probes (and any HEAD
 * request) hang ~6s then receive a non-empty body. Applied inside
 * custom-server.js's request wrapper so it covers BOTH the production
 * standalone entry and the dev/start entry, and every route — including ones
 * without an explicit `HEAD` export.
 *
 * `res` is per-request, so the patched `write`/`end` stay in place for the
 * whole response lifetime (no restore — a deferred stream write after the
 * handler promise resolves must still be dropped; there is no cross-request
 * leak). Status + headers set by the handler are preserved exactly; only body
 * bytes are dropped.
 *
 * This module is a standalone sidecar: `custom-server.js` requires it at
 * `./head-response-guard.cjs`, and the CLI build
 * (`cli/scripts/standaloneSidecars.js`) copies it next to `custom-server.js`
 * in the shipped `cli/app` bundle — a missing copy crashes the standalone
 * server at boot with MODULE_NOT_FOUND.
 */

/**
 * @param {import("http").IncomingMessage} req
 * @returns {boolean} true when the request method is HEAD (case-insensitive).
 */const { isFunction } = require("./src/shared/utils/typeChecks.cjs");
function isHeadRequest(req) {
  return String(req?.method || "GET").toUpperCase() === "HEAD";
}

/**
 * Mutate `res` in place so body writes are discarded while the real `end`
 * still runs (status + headers flush, connection lifecycle stays intact).
 * No-op for non-HEAD requests.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function applyHeadResponseGuard(req, res) {
  if (!isHeadRequest(req)) return;
  const origEnd = res.end;
  res.write = function (_chunk, _enc, cb) {
    // Accept (chunk, cb) and (chunk, enc, cb) arities; signal success.
    const callback = isFunction(_enc) ? _enc : cb;
    if (isFunction(callback)) callback();
    return true;
  };
  res.end = function (_chunk, _enc, cb) {
    // Normalize (cb), (chunk, cb), (chunk, enc, cb) into a single
    // callback and hand it to the REAL end so Node invokes it once,
    // after the stream fully closes — never swallow it (a swallowed
    // callback can hang async handlers awaiting `end`). Body chunks
    // are dropped; status + headers set by the handler are kept.
    const callback = isFunction(_chunk) ?
    _chunk :
    isFunction(_enc) ? _enc : cb;
    return origEnd.call(res, callback);
  };
}

module.exports = { applyHeadResponseGuard, isHeadRequest };