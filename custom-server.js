// OmniRoute #6828: strip empty-string env vars (Docker `-e KEY=`) before any
// module below can snapshot them; "" must behave like "not set".
require("./src/shared/utils/normalizeEnv").normalizeProcessEnv();

const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");
const { createPeerOwnerVerifier } = require("./src/mitm/peerOwner");
const {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  CONTROL_SECRET_ENV,
  createControlProof,
} = require("./src/mitm/controlProof");
const {
  extractRealtimeKey,
  isRealtimePath,
  loopbackAuthUrl,
  loopbackChatUrl,
  modelFromUrl,
  probeApiKey,
  selectProtocol,
} = require("./src/shared/utils/wsHandshake");
const { createRealtimeSession, publicSession: publicRealtimeSession } = require("./open-sse/handlers/realtimeCore");
const { MAX_REALTIME_FRAME_BYTES } = require("./src/shared/utils/realtimeConfig");
// Sidecar copied into the CLI bundle by cli/scripts/standaloneSidecars.js.
const { applyHeadResponseGuard } = require("./head-response-guard.cjs");

const MITM_CONTROL_PATH = "/api/cli-tools/antigravity-mitm";
const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";
const REALTIME_DISPATCHER = Symbol.for("durindoor.realtimeDispatcher");
const SINGLE_PROCESS_RUNTIME_ENV = "DURINDOOR_SINGLE_PROCESS_RUNTIME";

// One WS server shared across every http server we wrap (noServer so we own the
// upgrade handshake). `handleProtocols` selects a safe subprotocol and never
// echoes the key-bearing `openai-insecure-api-key.<key>` token back to the
// client. `verifyClient` is deliberately NOT used — auth is enforced after the
// upgrade via probeApiKey so a 401 maps cleanly to ws close code 4001.
const realtimeWss = new WebSocketServer({ noServer: true, maxPayload: MAX_REALTIME_FRAME_BYTES, handleProtocols: selectProtocol });

function canonicalizeRuntimePaths() {
  // Resolve before Next's generated server can change cwd. Every bundled
  // subsystem then observes the same absolute data directory, and the MITM
  // manager receives an entrypoint root derived from this installed wrapper.
  const { DATA_DIR } = require("./src/mitm/paths");
  process.env.DATA_DIR = DATA_DIR;
  process.env[STANDALONE_ROOT_ENV] = require("fs").realpathSync(__dirname);
  process.env[SINGLE_PROCESS_RUNTIME_ENV] = "1";
  return DATA_DIR;
}

function isMitmMutation(req) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return (pathname === MITM_CONTROL_PATH || pathname.startsWith(`${MITM_CONTROL_PATH}/`))
    && String(req.method || "GET").toUpperCase() !== "GET";
}

/**
 * Install the standalone-server request wrapper. Besides deriving the real
 * socket IP, it stamps mutating MITM requests only after proving that the
 * loopback client socket belongs to the same OS user as the dashboard.
 */
function installRequestWrapper({ httpModule = http, secret, verifyPeerOwner } = {}) {
  const controlSecret = secret || crypto.randomBytes(32).toString("hex");
  process.env[CONTROL_SECRET_ENV] = controlSecret;
  const dashboardPort = Number(process.env.PORT || 20128);
  const verifyOwner = verifyPeerOwner || createPeerOwnerVerifier({ targetPorts: [dashboardPort] });
  const origCreate = httpModule.createServer.bind(httpModule);

  httpModule.createServer = (...args) => {
    const handler = args.find((a) => typeof a === "function");
    const rest = args.filter((a) => typeof a !== "function");
    if (!handler) return origCreate(...args);
    const wrapped = (req, res) => {
      const socketIp = req.socket?.remoteAddress || "";
      const xff = req.headers["x-forwarded-for"];
      const xRealIp = req.headers["x-real-ip"];
      const viaProxy = Boolean(xff || xRealIp);
      const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
      const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
      const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
      delete req.headers["x-9r-real-ip"];
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-9r-via-proxy"];
      delete req.headers[CONTROL_PROOF_HEADER];
      delete req.headers[CONTROL_PORT_HEADER];
      req.headers["x-9r-real-ip"] = ip;
      if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
      if (/^[a-f0-9]{48}$/.test(process.env.DURINDOOR_WORKER_NONCE || "")) {
        res.setHeader?.("x-durindoor-worker-nonce", process.env.DURINDOOR_WORKER_NONCE);
      }

      const stampOwnerProof = async () => {
        if (isMitmMutation(req) && await verifyOwner(req.socket)) {
          const remotePort = req.socket?.remotePort;
          const proof = createControlProof({
            method: req.method,
            pathname: req.url,
            remotePort,
            secret: controlSecret,
          });
          if (proof) {
            req.headers[CONTROL_PORT_HEADER] = String(remotePort);
            req.headers[CONTROL_PROOF_HEADER] = proof;
          }
        }
      };
      const dispatch = () => {
        // #6608 global HEAD body-suppression, extracted to
        // ./head-response-guard.cjs (see its module doc for the RFC 9110
        // §9.3.2 rationale). Called inside installRequestWrapper so it covers
        // BOTH the production standalone and dev/start entries and every
        // route, with per-request `res` patches kept for the response life.
        applyHeadResponseGuard(req, res);
        try {
          const result = handler(req, res);
          if (result && typeof result.catch === "function") {
            void result.catch((error) => {
              if (!res.headersSent) res.writeHead?.(500, { "content-type": "text/plain" });
              if (!res.writableEnded) res.end?.("Internal Server Error");
              process.stderr.write(`[custom-server] request handler failed: ${error.message}\n`);
            });
          }
        } catch (error) {
          if (!res.headersSent) res.writeHead?.(500, { "content-type": "text/plain" });
          if (!res.writableEnded) res.end?.("Internal Server Error");
        }
      };
      // Proof lookup is fail-closed, but the application handler must be
      // dispatched exactly once even when lookup fails. In particular, never
      // interpret a rejected application promise as a reason to replay a host
      // mutation.
      void stampOwnerProof().then(
        dispatch,
        dispatch,
      );
    };
    const server = origCreate(...rest, wrapped);
    // createOwnerAwareHandler's shim only returns the wrapped handler function;
    // gate on real Server API so we never schedule .listeners() on a function.
    if (isHttpServer(server)) installRealtimeUpgradeDispatcher(server, { dashboardPort });
    return server;
  };
}

/**
 * Duck-type check: does `value` look like a real `http.Server`? We gate the
 * realtime dispatcher on this so a handler-shaped object returned by a wrapper
 * shim (e.g. the standalone owner-aware handler path) never has `.listeners()`
 * scheduled on it.
 */
function isHttpServer(value) {
  return !!value
    && typeof value.on === "function"
    && typeof value.listeners === "function"
    && typeof value.removeAllListeners === "function";
}

/**
 * Make a freshly-created `http.Server` own the realtime WebSocket upgrade path.
 *
 * Next 16 always installs its own `server.on('upgrade', ...)` listener during
 * standalone boot (node_modules/next/dist/server/lib/start-server.js:~252).
 * Rather than racing that listener — which would double-handle upgrades and
 * risk dropping either realtime sockets or Next-internal ones — we:
 *
 *   1. Defer one tick so Next's listener has registered (sync IIFE + tick).
 *   2. Snapshot every currently-registered `upgrade` listener (Next's, in order).
 *   3. `removeAllListeners('upgrade')` so none of them fire directly.
 *   4. Install exactly ONE dispatcher:
 *        - `/v1/realtime`   → {@link handleRealtimeUpgrade} (handled once).
 *        - every other path → the snapshotted Next listener(s), called in
 *          registration order, each with the ORIGINAL `(req, socket, head)`
 *          arguments so identity-bound handlers stay intact.
 *
 * Guards: runs at most once per server (Symbol marker); on dispatcher throw the
 * socket is destroyed so a half-open connection never lingers.
 *
 * @param {import("http").Server} server
 * @param {{ dashboardPort?: number }} [opts]
 */
function installRealtimeUpgradeDispatcher(server, { dashboardPort } = {}) {
  // Duck-type guard BEFORE stamping the marker: a handler-shaped object (the
  // createOwnerAwareHandler shim returns a function, and tests pass bare
  // `{ handler }` objects) must be a no-op rather than scheduling `.listeners()`
  // on a value that cannot speak the Server API.
  if (!isHttpServer(server) || server[REALTIME_DISPATCHER]) return server;
  server[REALTIME_DISPATCHER] = true;
  const port = Number(dashboardPort) || Number(process.env.PORT || 20128);

  const rewire = () => {
    if (!server[REALTIME_DISPATCHER]) return; // unwound (e.g. test teardown)
    const nextListeners = server.listeners("upgrade").slice();
    server.removeAllListeners("upgrade");
    server.on("upgrade", (req, socket, head) => {
      try {
        if (isRealtimePath(req.url)) {
          handleRealtimeUpgrade(req, socket, head, { port });
          return;
        }
        for (const listener of nextListeners) {
          listener.call(server, req, socket, head);
        }
      } catch (error) {
        try { socket.destroy(); } catch { /* already closed */ }
        process.stderr.write(`[custom-server] upgrade dispatcher failed: ${error?.message || error}\n`);
      }
    });
  };

  // Defer so Next (which registers its upgrade listener synchronously during
  // startServer, immediately after createServer returns) is in the snapshot.
  if (typeof queueMicrotask === "function") queueMicrotask(rewire);
  else process.nextTick(rewire);
  return server;
}

/**
 * Handle one realtime upgrade: handshake, auth probe, then event loop.
 * Auth is finalized AFTER upgrade so a rejected key maps to ws close 4001.
 */
function handleRealtimeUpgrade(req, socket, head, { port } = {}) {
  realtimeWss.handleUpgrade(req, socket, head, async (ws) => {
    // Clients frequently fire `session.update` / `conversation.item.create`
    // immediately on `open` — well before our async auth probe resolves.
    // Attach a message listener RIGHT NOW and queue frames so nothing is
    // dropped during the handshake window; drain in order once setup is done.
    const queue = [];
    let ready = false;
    let rt = null;
    let closed = false;
    // Single promise chain serializes EVERY frame — queued (pre-auth) and live
    // (post-auth) — so `conversation.item.create` always resolves before a
    // following `response.create`, and two `response.create`s can never both
    // pass the `inFlight` gate. This is the only place that dispatches frames.
    let processing = Promise.resolve();
    const enqueue = (data) => {
      processing = processing.then(() => {
        // Drop frames that were already chained before close/error fired — the
        // `queue` array only holds not-yet-enqueued frames, so without this
        // guard a queued `response.create` could still start upstream work
        // after dispose() ran.
        if (closed || !rt) return undefined;
        return rt.handleClientEvent(data);
      }).catch((error) => {
        process.stderr.write(`[custom-server] realtime event failed: ${error?.message || error}\n`);
      });
    };

    ws.on("message", (data, isBinary) => {
      if (closed || isBinary) return;
      if (!ready || !rt) {
        queue.push(data); // hold until session.created + ready; drained below
        return;
      }
      // Drain anything that arrived during the auth window FIRST (preserving
      // arrival order), then this frame — all through the same chain.
      if (queue.length) {
        const held = queue.splice(0);
        for (const d of held) enqueue(d);
      }
      enqueue(data);
    });
    ws.on("close", () => {
      closed = true;
      queue.length = 0;
      // Abort any upstream chat still streaming for this session so provider
      // connections / tokens aren't stranded after the client goes away.
      // Idempotent and abort-only (owner clears its controller), so it is safe
      // to run from both `close` and `error`.
      if (rt) rt.dispose();
    });
    ws.on("error", (error) => {
      // Covers frame-oversize (ws emits error then closes 1009), protocol
      // violations, and socket errors. `maxPayload` oversize trips here first;
      // the subsequent `close` also runs the same cleanup — both are safe /
      // idempotent. Mark closed + drain the queue HERE too: if the close event
      // is delayed or absent, this stops setup/session creation from continuing
      // on a dead socket and drops frames held across the auth window. Never
      // close or send from here: the ws stack already initiates the close with
      // the correct code (e.g. 1009), and a duplicate close/send can throw.
      closed = true;
      queue.length = 0;
      process.stderr.write(`[custom-server] realtime socket error: ${error?.message || error}\n`);
      if (rt) rt.dispose();
    });

    try {
      const { key } = extractRealtimeKey(req);
      const cliToken = typeof req.headers?.["x-9r-cli-token"] === "string"
        ? req.headers["x-9r-cli-token"]
        : null;
      const auth = await probeApiKey({ key, cliToken, authUrl: loopbackAuthUrl(port) });
      if (closed) return;
      if (!auth.ok) {
        queue.length = 0; // discard anything the optimistic client already sent
        const credentialFailure = auth.status === 401;
        const code = credentialFailure ? 4001 : 1011;
        const errType = credentialFailure ? "invalid_request_error" : "server_error";
        const errCode = credentialFailure ? "invalid_api_key" : "auth_probe_failed";
        const errMsg = credentialFailure
          ? (auth.reason || "Unauthorized")
          : "Realtime auth probe unavailable; retry shortly";
        try {
          ws.send(JSON.stringify({
            type: "error",
            event_id: `evt_${crypto.randomUUID()}`,
            error: { type: errType, code: errCode, message: errMsg },
          }));
        } catch { /* socket may already be gone */ }
        ws.close(code, credentialFailure ? (auth.reason || "Unauthorized") : "auth probe failed");
        return;
      }

      const model = modelFromUrl(req.url);
      const session = {
        id: `sess_${crypto.randomUUID()}`,
        model: model || "openai/gpt-4o-mini",
        instructions: "",
        modalities: ["text"],
        temperature: undefined,
        maxOutputTokens: undefined,
        items: [],
      };
      const headers = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      if (cliToken) headers["x-9r-cli-token"] = cliToken;
      const chat = async ({ body, headers: h, signal }) => fetch(loopbackChatUrl(port), {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify(body),
        signal,
      });
      rt = createRealtimeSession({ ws, session, chat, headers });

      ws.send(JSON.stringify({
        type: "session.created",
        event_id: `evt_${crypto.randomUUID()}`,
        session: publicRealtimeSession(session),
      }));
      ready = true;
      if (queue.length) {
        const held = queue.splice(0);
        for (const d of held) enqueue(d);
      }
    } catch (error) {
      try { ws.close(1011, "internal error"); } catch { /* ignore */ }
      process.stderr.write(`[custom-server] realtime setup failed: ${error?.message || error}\n`);
    }
  });
}

function createOwnerAwareHandler(handler, options = {}) {
  const shim = { createServer: (...args) => args.find((value) => typeof value === "function") };
  installRequestWrapper({ ...options, httpModule: shim });
  return shim.createServer(handler);
}

function setProcessTitle(processImpl = process) {
  // Keep "next-server" in the title for backwards-compatible process matching.
  processImpl.title = "9router next-server";
  Object.defineProperty(processImpl, "title", {
    get: () => "9router next-server",
    set: () => {},
    configurable: true,
  });
}

function run() {
  canonicalizeRuntimePaths();
  setProcessTitle();
  installRequestWrapper();
  require("./server.js");
}

if (require.main === module) run();

module.exports = {
  REALTIME_DISPATCHER,
  canonicalizeRuntimePaths,
  createOwnerAwareHandler,
  handleRealtimeUpgrade,
  installRealtimeUpgradeDispatcher,
  installRequestWrapper,
  isHttpServer,
  isMitmMutation,
  run,
  setProcessTitle,
};
