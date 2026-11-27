// Staged GapGPT fixed-port loopback callback (#2034).
//
// Source: decolua/9router PR #3350, head 1f45c0e7b29bede1693ca0df613da957d67826bf
// (MIT), `src/lib/oauth/utils/gapgptProxy.js` and the GapGPT block in
// `src/lib/oauth/utils/server.js`. The source keeps module-global server and
// session state, stores the PKCE verifier and redirect URI sent by the browser,
// answers "successful" before the exchange runs, writes the connection directly
// and falls back to a 302 that forwards the code to an app port.
//
// This adaptation keeps none of that:
// - every secret (verifier, redirect, proxy selection, reconnect target) stays
//   in the existing server-side flow store; a session only maps `state` to its
//   opaque `flowId`;
// - the callback claims the flow once (`claimOAuthFlow`), checks it still
//   belongs to this provider and its fixed redirect, and hands the claim to the
//   injected completion — in production `exchangeAndSaveAuthorizationCode`,
//   which re-resolves the flow's own proxy and commits only while the claim is
//   active;
// - the browser sees success only after the completion returned a persisted
//   connection id;
// - unknown, replayed, cancelled, expired and mismatched callbacks never reach
//   the completion; no 302 fallback exists;
// - concurrent sign-ins (different owners) share the one fixed-port listener
//   and are told apart by state; a new attempt by the same owner replaces only
//   that owner's earlier session;
// - state lives in the instance returned by `createGapgptLoopback`, so tests
//   and callers never share a module singleton.

import {
  cancelOAuthFlow,
  claimOAuthFlow,
  consumeOAuthFlow,
  getOAuthFlow
} from "../../flowStore.js";
import { OAUTH_TIMEOUT } from "../../constants/oauth.js";
import { isFunction, isString } from "../../../../shared/utils/typeChecks.js";
import {
  GAPGPT_CALLBACK_HOST_HEADERS,
  GAPGPT_CALLBACK_PATH,
  GAPGPT_FIXED_PORT,
  GAPGPT_LISTEN_HOST,
  GAPGPT_LOOPBACK_REDIRECT_URI,
  GAPGPT_OAUTH_CONFIG,
  GAPGPT_PROVIDER_ID
} from "./config.js";

const SAFE_ERROR_CODE = /^[a-z][a-z0-9_.-]{0,63}$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

// Messages the browser and the status poll may show. Upstream text never
// reaches either; only these fixed strings and a validated OAuth error code.
export const GAPGPT_LOOPBACK_MESSAGES = Object.freeze({
  success: "GapGPT is connected. You can close this window.",
  unknown: "This sign-in link is not recognized. Start again from the dashboard.",
  replayed: "This sign-in was already processed.",
  gone: "This sign-in expired or was cancelled. Start again from the dashboard.",
  mismatch: "This sign-in does not match its original request.",
  noCode: "No authorization code was received.",
  saveFailed: "GapGPT sign-in could not be saved.",
  exchangeFailed: "GapGPT sign-in failed.",
  timeout: "GapGPT sign-in timed out.",
  cancelled: "GapGPT sign-in was cancelled.",
  crossOrigin: "Cross-origin callback rejected.",
  badHost: "Callback host rejected."
});

function escapeHtml(value) {
  return String(value).
  replace(/&/g, "&amp;").
  replace(/</g, "&lt;").
  replace(/>/g, "&gt;").
  replace(/"/g, "&quot;").
  replace(/'/g, "&#39;");
}

export function renderGapgptResultPage(success, message) {
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body><h1>${title}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function page(status, success, message) {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    },
    body: renderGapgptResultPage(success, message)
  };
}

function providerErrorMessage(errorParam) {
  return isString(errorParam) && SAFE_ERROR_CODE.test(errorParam) ?
  `GapGPT sign-in was not authorized (${errorParam}).` :
  GAPGPT_LOOPBACK_MESSAGES.exchangeFailed;
}

/** Map a listen failure to the stable reasons the route understands. */
export function classifyGapgptListenError(error) {
  return error?.code === "EADDRINUSE" ? "port_busy" : "listen_failed";
}

/**
 * Production listener adapter. Tests inject their own `listen`; nothing here
 * runs at import time.
 */
export function createNodeLoopbackListener(createServer) {
  if (!isFunction(createServer)) throw new TypeError("createServer is required");
  return ({ host, port, handle }) => new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      let result;
      try {
        result = await handle({ method: req.method, url: req.url, headers: req.headers });
      } catch {
        result = page(500, false, GAPGPT_LOOPBACK_MESSAGES.exchangeFailed);
      }
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    });
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off?.("error", reject);
      resolve({
        close: () => new Promise((done) => {
          if (!server.listening) return done();
          server.close(() => done());
        })
      });
    });
  });
}

/**
 * Create one owned GapGPT loopback instance.
 *
 * @param {object} deps
 * @param {Function} deps.listen    ({ host, port, handle }) => Promise<{ close }>
 * @param {Function} deps.complete  (provider, code, state, claim) => Promise<{ connection }>
 * @param {Function} [deps.setTimer]   defaults to setTimeout
 * @param {Function} [deps.clearTimer] defaults to clearTimeout
 * @param {Function} [deps.now]        defaults to Date.now
 * @param {number}   [deps.timeoutMs]  listener lifetime, capped at OAUTH_TIMEOUT
 */
export function createGapgptLoopback({
  listen,
  complete,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  timeoutMs = OAUTH_TIMEOUT
} = {}) {
  if (!isFunction(listen)) throw new TypeError("listen is required");
  if (!isFunction(complete)) throw new TypeError("complete is required");

  const lifetime = Math.min(
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : OAUTH_TIMEOUT,
    OAUTH_TIMEOUT
  );
  const sessions = new Map(); // state -> session
  let listener = null;
  let starting = null;
  let timer = null;

  function activeSessions() {
    return [...sessions.values()].filter((s) => s.status === "pending" || s.status === "processing");
  }

  function armTimer() {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      for (const session of activeSessions()) {
        if (session.status === "pending") {
          cancelOAuthFlow({ flowId: session.flowId, provider: GAPGPT_PROVIDER_ID });
          session.status = "error";
          session.error = GAPGPT_LOOPBACK_MESSAGES.timeout;
        }
      }
      if (activeSessions().length === 0) stop().catch(() => {});
    }, lifetime);
  }

  async function stop() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    const current = listener;
    listener = null;
    if (current) await current.close();
    return Boolean(current);
  }

  async function stopIfIdle() {
    if (activeSessions().length === 0) await stop();
  }

  async function handle(request) {
    let url;
    try {
      url = new URL(request?.url || "/", "http://localhost");
    } catch {
      return page(400, false, GAPGPT_LOOPBACK_MESSAGES.unknown);
    }
    if (url.pathname !== GAPGPT_CALLBACK_PATH) {
      return { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Not found" };
    }
    if (request.method && request.method !== "GET") {
      return { status: 405, headers: { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" }, body: "Method not allowed" };
    }
    const headers = request.headers || {};
    if (headers.origin != null && !LOOPBACK_ORIGIN.test(headers.origin)) {
      return page(403, false, GAPGPT_LOOPBACK_MESSAGES.crossOrigin);
    }
    if (!GAPGPT_CALLBACK_HOST_HEADERS.includes(String(headers.host || "").toLowerCase())) {
      return page(403, false, GAPGPT_LOOPBACK_MESSAGES.badHost);
    }

    const state = url.searchParams.get("state");
    const session = state ? sessions.get(state) : null;
    if (!session) return page(400, false, GAPGPT_LOOPBACK_MESSAGES.unknown);
    if (session.status !== "pending") {
      return page(409, false, session.status === "cancelled" ?
      GAPGPT_LOOPBACK_MESSAGES.cancelled :
      GAPGPT_LOOPBACK_MESSAGES.replayed);
    }

    session.status = "processing";
    let claim = null;
    try {
      claim = claimOAuthFlow({ flowId: session.flowId, state, provider: GAPGPT_PROVIDER_ID });
      if (!claim) {
        session.status = "error";
        session.error = GAPGPT_LOOPBACK_MESSAGES.gone;
        return page(410, false, session.error);
      }
      if (
      claim.kind !== "authorization" ||
      claim.payload?.redirectUri !== GAPGPT_LOOPBACK_REDIRECT_URI ||
      claim.payload?.meta?.clientId !== GAPGPT_OAUTH_CONFIG.clientId ||
      !isString(claim.payload?.codeVerifier) || !claim.payload.codeVerifier)
      {
        session.status = "error";
        session.error = GAPGPT_LOOPBACK_MESSAGES.mismatch;
        return page(400, false, session.error);
      }
      const errorParam = url.searchParams.get("error");
      if (errorParam) {
        session.status = "error";
        session.error = providerErrorMessage(errorParam);
        return page(400, false, session.error);
      }
      const code = url.searchParams.get("code");
      if (!code) {
        session.status = "error";
        session.error = GAPGPT_LOOPBACK_MESSAGES.noCode;
        return page(400, false, session.error);
      }

      let result;
      try {
        result = await complete(GAPGPT_PROVIDER_ID, code, state, claim);
      } catch {
        // The completion error may quote upstream text; the browser and the
        // poll only get the fixed message.
        session.status = "error";
        session.error = GAPGPT_LOOPBACK_MESSAGES.exchangeFailed;
        return page(502, false, session.error);
      }
      // A cancel that raced the exchange wins: nothing is reported as saved.
      if (session.status !== "processing") {
        return page(409, false, GAPGPT_LOOPBACK_MESSAGES.cancelled);
      }
      const connectionId = result?.connection?.id;
      if (!connectionId) {
        session.status = "error";
        session.error = GAPGPT_LOOPBACK_MESSAGES.saveFailed;
        return page(500, false, session.error);
      }
      session.status = "done";
      session.connectionId = connectionId;
      return page(200, true, GAPGPT_LOOPBACK_MESSAGES.success);
    } finally {
      if (claim) consumeOAuthFlow(claim);
      await stopIfIdle();
    }
  }

  /** Bind the fixed port once; later sign-ins reuse the same listener. */
  async function start() {
    if (listener) return { success: true, reused: true };
    if (starting) return starting;
    starting = (async () => {
      try {
        listener = await listen({ host: GAPGPT_LISTEN_HOST, port: GAPGPT_FIXED_PORT, handle });
        armTimer();
        return { success: true, reused: false };
      } catch (error) {
        return { success: false, reason: classifyGapgptListenError(error) };
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  /**
   * Bind a flow created by the shared authorize route to this listener.
   * Returns false unless the flow exists, is a GapGPT authorization flow, uses
   * the fixed redirect and the listener is up.
   */
  function register({ flowId, state, ownerId = null }) {
    if (!listener || !isString(flowId) || !isString(state)) return false;
    const flow = getOAuthFlow({ flowId, state, provider: GAPGPT_PROVIDER_ID });
    if (!flow || flow.kind !== "authorization" || flow.state !== state) return false;
    if (sessions.has(state)) return false;
    if (ownerId) {
      for (const [otherState, other] of sessions) {
        if (other.ownerId === ownerId && other.status === "pending") {
          cancelOAuthFlow({ flowId: other.flowId, provider: GAPGPT_PROVIDER_ID });
          sessions.delete(otherState);
        }
      }
    }
    sessions.set(state, {
      flowId,
      ownerId: ownerId || null,
      status: "pending",
      createdAt: now(),
      expiresAt: Math.min(flow.expiresAt, now() + lifetime)
    });
    armTimer();
    return true;
  }

  function owned(session, flowId, ownerId) {
    return Boolean(session && session.flowId === flowId && (!session.ownerId || session.ownerId === ownerId));
  }

  /** Non-secret status for the polling dashboard. Requires flow id and owner. */
  function status({ flowId, state, ownerId = null }) {
    const session = isString(state) ? sessions.get(state) : null;
    if (!owned(session, flowId, ownerId)) return { status: "unknown" };
    if (session.status === "pending" && now() >= session.expiresAt) {
      cancelOAuthFlow({ flowId: session.flowId, provider: GAPGPT_PROVIDER_ID });
      session.status = "error";
      session.error = GAPGPT_LOOPBACK_MESSAGES.timeout;
    }
    const response = { status: session.status };
    if (session.connectionId) response.connectionId = session.connectionId;
    if (session.error) response.error = session.error;
    if (session.status === "done" || session.status === "error" || session.status === "cancelled") {
      sessions.delete(state);
    }
    return response;
  }

  /** Cancel one owned sign-in; stops the listener when nothing else waits. */
  async function cancel({ flowId, state, ownerId = null }) {
    const session = isString(state) ? sessions.get(state) : null;
    if (!owned(session, flowId, ownerId)) return { success: true, cancelled: false };
    cancelOAuthFlow({ flowId, provider: GAPGPT_PROVIDER_ID });
    session.status = "cancelled";
    session.error = GAPGPT_LOOPBACK_MESSAGES.cancelled;
    await stopIfIdle();
    return { success: true, cancelled: true };
  }

  return Object.freeze({
    start,
    register,
    status,
    cancel,
    stop,
    handle,
    get listening() {
      return Boolean(listener);
    },
    get sessionCount() {
      return sessions.size;
    }
  });
}
