const crypto = require("crypto");
const http = require("http");
const { createPeerOwnerVerifier } = require("./src/mitm/peerOwner");
const {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  CONTROL_SECRET_ENV,
  createControlProof,
} = require("./src/mitm/controlProof");

const MITM_CONTROL_PATH = "/api/cli-tools/antigravity-mitm";
const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";

function canonicalizeRuntimePaths() {
  // Resolve before Next's generated server can change cwd. Every bundled
  // subsystem then observes the same absolute data directory, and the MITM
  // manager receives an entrypoint root derived from this installed wrapper.
  const { DATA_DIR } = require("./src/mitm/paths");
  process.env.DATA_DIR = DATA_DIR;
  process.env[STANDALONE_ROOT_ENV] = require("fs").realpathSync(__dirname);
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
        // #6608 global HEAD body-suppression: Next 16 auto-derives HEAD from
        // GET for App Router routes and streams the full body, so SDK health
        // probes (and any HEAD request) hang ~6s then receive a non-empty body
        // — violating RFC 9110 §9.3.2 (HEAD carries the headers a GET would,
        // with zero body). Applied here inside installRequestWrapper so it
        // covers BOTH production standalone (`run()` → installRequestWrapper)
        // and the dev/start entry (`scripts/next-owner-server.cjs` →
        // createOwnerAwareHandler), and every route — including ones without an
        // explicit `HEAD` export. `res` is per-request, so the patched
        // `write`/`end` stay in place for the whole response lifetime (no
        // restore — a deferred stream write after the handler promise resolves
        // must still be dropped; there is no cross-request leak). Status +
        // headers set by the handler are preserved exactly; only body bytes are
        // dropped.
        const isHead = String(req.method || "GET").toUpperCase() === "HEAD";
        if (isHead) {
          const origEnd = res.end;
          res.write = function (_chunk, _enc, cb) {
            // Accept (chunk, cb) and (chunk, enc, cb) arities; signal success.
            const callback = typeof _enc === "function" ? _enc : cb;
            if (typeof callback === "function") callback();
            return true;
          };
          res.end = function (_chunk, _enc, cb) {
            // Normalize (cb), (chunk, cb), (chunk, enc, cb) into a single
            // callback and hand it to the REAL end so Node invokes it once,
            // after the stream fully closes — never swallow it (a swallowed
            // callback can hang async handlers awaiting `end`). Body chunks
            // are dropped; status + headers set by the handler are kept.
            const callback = typeof _chunk === "function"
              ? _chunk
              : (typeof _enc === "function" ? _enc : cb);
            return origEnd.call(res, callback);
          };
        }
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
    return origCreate(...rest, wrapped);
  };
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
  canonicalizeRuntimePaths,
  createOwnerAwareHandler,
  installRequestWrapper,
  isMitmMutation,
  run,
  setProcessTitle,
};
