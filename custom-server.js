// OmniRoute #6828: strip empty-string env vars (Docker `-e KEY=`) before any
// module below can snapshot them; "" must behave like "not set".
require("./src/shared/utils/normalizeEnv").normalizeProcessEnv();

// Suppress undici's SOCKS5 ExperimentalWarning: the proxy-fetch path handles
// SOCKS5 dispatcher failures gracefully, so the noise is not actionable.
// Matches the inline filter shape used by nodeSqliteAdapter.js for its own
// ExperimentalWarning. Other process warnings (e.g. the SQLite one) stay visible.
const emitProcessWarning = process.emit;
process.emit = function (name, warning, ...args) {
  if (name === "warning" && warning?.name === "ExperimentalWarning" && /SOCKS5/i.test(warning.message || "")) {
    return false;
  }
  return emitProcessWarning.call(process, name, warning, ...args);
};



const { isFunction, isObject, isString } = require("./src/shared/utils/typeChecks.cjs");

const crypto = require("crypto");
const http = require("http");
const { createPeerOwnerVerifier } = require("./src/mitm/peerOwner");
const {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  CONTROL_SECRET_ENV,
  createControlProof,
  createRealtimeOperatorProof
} = require("./src/mitm/controlProof");
// Sidecar copied into the CLI bundle by cli/scripts/standaloneSidecars.js.
const { applyHeadResponseGuard } = require("./head-response-guard.cjs");
const { denyIsolatedHttpRequest } = require("./web-login-host-boundary.cjs");

const MITM_CONTROL_PATH = "/api/cli-tools/antigravity-mitm";
const REALTIME_NATIVE_CONTROL_PATH = "/api/v1/realtime/native";
const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";
const { REALTIME_DISPATCHER, handleRealtimeUpgrade, installRealtimeUpgradeDispatcher, isHttpServer } = require("./realtime-upgrade.cjs");
const SINGLE_PROCESS_RUNTIME_ENV = "DURINDOOR_SINGLE_PROCESS_RUNTIME";

/** Baseline security headers (#2251). Mirrored in next.config.mjs headers(). */
const BASELINE_SECURITY_HEADERS = Object.freeze([
  ["X-Frame-Options", "DENY"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "same-origin"],
  ["Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"],
]);

function applyBaselineSecurityHeaders(res) {
  if (!res || !isFunction(res.setHeader)) return;
  for (const [key, value] of BASELINE_SECURITY_HEADERS) {
    res.setHeader(key, value);
  }
}

const INBOUND_KEEP_ALIVE_TIMEOUT_MS = 72_000;
const INBOUND_HEADERS_TIMEOUT_MS = 76_000;

const { resolveListenConfig } = require("./src/lib/startup/listenConfig.cjs");

/** Create the common HTTP server, applying the gateway request and upgrade boundaries. */
function createGatewayServer(handler, { httpModule = http, serverArgs = [], dashboardPort, upgradeHandler, alreadyWrapped = false, wrapperOptions = {} } = {}) {
  const requestHandler = alreadyWrapped ? handler : createOwnerAwareHandler(handler, { ...wrapperOptions, httpModule });
  const server = httpModule.createServer(...serverArgs, requestHandler);
  if (!isHttpServer(server)) return server;
  server.keepAliveTimeout = INBOUND_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = INBOUND_HEADERS_TIMEOUT_MS;
  if (isFunction(upgradeHandler)) server.on("upgrade", upgradeHandler);
  installRealtimeUpgradeDispatcher(server, { dashboardPort: dashboardPort || Number(process.env.PORT || 20128) });
  return server;
}

function canonicalizeRuntimePaths() {
  // Resolve before Next's generated server can change cwd. Every bundled
  // subsystem then observes the same absolute data directory, and the MITM
  // manager receives an entrypoint root derived from this installed wrapper.
  const { DATA_DIR } = require("./src/mitm/paths");
  process.env.DATA_DIR = DATA_DIR;
  process.env[STANDALONE_ROOT_ENV] = require("fs").realpathSync(__dirname);
  process.env[SINGLE_PROCESS_RUNTIME_ENV] = "1";
  // Security: the dashboard exposes privileged endpoints (tunnel install, daemon
  // start) that run system commands, so bind to loopback by default. Next's
  // standalone server reads HOSTNAME (defaulting to 0.0.0.0); pin it to 127.0.0.1
  // unless an operator deliberately overrode it. Expose it publicly only behind
  // your own auth/proxy by setting HOSTNAME=0.0.0.0 (#2725).
  if (!process.env.HOSTNAME) process.env.HOSTNAME = resolveListenConfig().host;
  return DATA_DIR;
}

function isMitmMutation(req) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  } catch {
    return false;
  }
  const basePath = process.env.DURINDOOR_BASE_PATH || "";
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) pathname = pathname.slice(basePath.length) || "/";
  const method = String(req.method || "GET").toUpperCase();
  return ((pathname === MITM_CONTROL_PATH || pathname.startsWith(`${MITM_CONTROL_PATH}/`)) && method !== "GET") ||
  (pathname === REALTIME_NATIVE_CONTROL_PATH && method === "POST");
}

/**
 * Install the standalone-server request wrapper. Besides deriving the real
 * socket IP, it stamps mutating MITM requests only after proving that the
 * loopback client socket belongs to the same OS user as the dashboard.
 */
function installRequestWrapper({ httpModule = http, secret, peerToken, verifyPeerOwner } = {}) {
  const controlSecret = secret || crypto.randomBytes(32).toString("hex");
  process.env[CONTROL_SECRET_ENV] = controlSecret;
  const trustedPeerToken = peerToken || crypto.randomBytes(24).toString("hex");
  process.env.NINEROUTER_PEER_TOKEN = trustedPeerToken;
  const dashboardPort = Number(process.env.PORT || 20128);
  const verifyOwner = verifyPeerOwner || createPeerOwnerVerifier({ targetPorts: [dashboardPort] });
  const origCreate = httpModule.createServer.bind(httpModule);

  httpModule.createServer = (...args) => {
    const handler = args.find((a) => isFunction(a));
    const rest = args.filter((a) => !isFunction(a));
    if (!handler) return origCreate(...args);
    const wrapped = (req, res) => {
      // Stamp before any early return (login-host deny, handler errors) so
      // responses that never reach Next still carry the #2251 baseline.
      applyBaselineSecurityHeaders(res);
      if (denyIsolatedHttpRequest(req, res)) return;
      const socketIp = req.socket?.remoteAddress || "";
      const xff = req.headers["x-forwarded-for"];
      const xRealIp = req.headers["x-real-ip"];
      const viaProxy = Boolean(xff || xRealIp);
      const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
      // Trust only the nearest proxy hop added by the loopback reverse proxy itself.
      // x-real-ip / leftmost x-forwarded-for are pass-through headers the client
      // can forge; the rightmost x-forwarded-for entry is the value the edge proxy
      // overwrote with the true client IP. Fall back to the socket when the edge
      // proxy did not stamp XFF.
      const lastXff = xff ? String(xff).split(",").map((s) => s.trim()).filter(Boolean).pop() : "";
      const ip = isLoopbackProxy && lastXff ? lastXff : socketIp;
      delete req.headers["x-9r-real-ip"];
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-9r-via-proxy"];
      delete req.headers[CONTROL_PROOF_HEADER];
      delete req.headers[CONTROL_PORT_HEADER];
      delete req.headers["x-9r-peer-token"];
      // Forwarded origin headers are request-controlled even on loopback: a
      // local process can send them directly instead of using a proxy. OIDC
      // reverse-proxy deployments configure BASE_URL, so remove them at the
      // boundary for every request.
      delete req.headers["x-forwarded-host"];
      delete req.headers["x-forwarded-proto"];
      req.headers["x-9r-real-ip"] = ip;
      if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
      req.headers["x-9r-peer-token"] = trustedPeerToken;
      if (/^[a-f0-9]{48}$/.test(process.env.DURINDOOR_WORKER_NONCE || "")) {
        res.setHeader?.("x-durindoor-worker-nonce", process.env.DURINDOOR_WORKER_NONCE);
      }

      const stampOwnerProof = async () => {
        if (isMitmMutation(req) && (await verifyOwner(req.socket))) {
          const remotePort = req.socket?.remotePort;
          const proof = createControlProof({
            method: req.method,
            pathname: (() => {
              const url = new URL(req.url, "http://localhost");
              const basePath = process.env.DURINDOOR_BASE_PATH || "";
              if (basePath && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))) url.pathname = url.pathname.slice(basePath.length) || "/";
              return url.pathname;
            })(),
            remotePort,
            secret: controlSecret
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
          if (result && isFunction(result.catch)) {
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
        dispatch
      );
    };
    const server = createGatewayServer(wrapped, { httpModule: { createServer: origCreate }, serverArgs: rest, dashboardPort, alreadyWrapped: true });
    // createOwnerAwareHandler's shim only returns the wrapped handler function;
    // gate on real Server API so we never schedule .listeners() on a function.
    return server;
  };
}

function createOwnerAwareHandler(handler, options = {}) {
  const shim = { createServer: (...args) => args.find((value) => isFunction(value)) };
  installRequestWrapper({ ...options, httpModule: shim });
  return shim.createServer(handler);
}

function setProcessTitle(processImpl = process) {
  // Keep "next-server" in the title for backwards-compatible process matching.
  processImpl.title = "9router next-server";
  Object.defineProperty(processImpl, "title", {
    get: () => "9router next-server",
    set: () => {},
    configurable: true
  });
}

function run() {
  canonicalizeRuntimePaths();
  setProcessTitle();
  const { port, host } = resolveListenConfig({ dev: false });
  process.env.PORT = String(port);
  process.env.HOSTNAME = host;
  installRequestWrapper();
  require("./server.js");
}

if (require.main === module) run();

module.exports = {
  BASELINE_SECURITY_HEADERS,
  REALTIME_DISPATCHER,
  applyBaselineSecurityHeaders,
  canonicalizeRuntimePaths,
  createOwnerAwareHandler,
  createGatewayServer,
  handleRealtimeUpgrade,
  installRealtimeUpgradeDispatcher,
  installRequestWrapper,
  isHttpServer,
  isMitmMutation,
  run,
  resolveListenConfig,
  setProcessTitle
};
