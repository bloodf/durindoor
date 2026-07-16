const https = require("https");
const http2 = require("http2");
const tls = require("tls");
const fs = require("fs");
const dns = require("dns");
const crypto = require("crypto");
const forge = require("node-forge");
const { promisify } = require("util");
const { log, err, dumpRequest, createResponseDumper, clearDumpDir } = require("./logger");
const { IS_DEV, MITM_ENTRY_ARG, MITM_NODE_PORT, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, MODEL_NO_MAP, getToolForHost } = require("./config");
const { getCertForDomain } = require("./cert/generate");
const { loadRootCATls } = require("./serverBootstrap");
const { getMitmAlias } = require("./dbReader");
const { applyAntigravityIdeVersionOverride } = require("./antigravityIdeVersion");
const { createPeerOwnerVerifier } = require("./peerOwner");
const { waitForLaunchAuthorization } = require("./launchGate");
const LOCAL_PORT = (() => {
  const configured = Number(process.env.MITM_LISTEN_PORT || MITM_NODE_PORT);
  const minimumExclusive = process.platform === "win32" ? 0 : 1024;
  return Number.isInteger(configured) && configured > minimumExclusive && configured <= 65535
    ? configured
    : MITM_NODE_PORT;
})();
const ENABLE_FILE_LOG = IS_DEV;

const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Host rewrite for upstream forward: PROD cloudcode-pa is rate-limited (429),
// daily-cloudcode-pa (dev endpoint) accepts same body+token. Same trick as open-sse.
const HOST_REWRITE = {
  "cloudcode-pa.googleapis.com": "daily-cloudcode-pa.googleapis.com",
};

const handlers = {
  antigravity: require("./handlers/antigravity"),
  copilot: require("./handlers/copilot"),
  kiro: require("./handlers/kiro"),
  cursor: require("./handlers/cursor"),
};

// ── SSL / SNI ─────────────────────────────────────────────────

const certCache = new Map();
let rootCAPem;
let rootCAForLeaves;

function isAllowedTargetHost(host) {
  return TARGET_HOSTS.includes(String(host || "").split(":")[0].toLowerCase());
}

function createHealthProof(req) {
  const nonce = process.env.MITM_INSTANCE_NONCE || "";
  const challenge = String(req.headers["x-durindoor-mitm-challenge"] || "");
  if (!/^[a-f0-9]{48}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(challenge)) return null;
  return crypto.createHmac("sha256", nonce).update(challenge).digest("hex");
}

function sniCallback(servername, cb) {
  try {
    if (!isAllowedTargetHost(servername)) return cb(new Error("Unsupported MITM SNI hostname"));
    if (certCache.has(servername)) return cb(null, certCache.get(servername));
    const certData = getCertForDomain(servername, rootCAForLeaves);
    if (!certData) return cb(new Error(`Failed to generate cert for ${servername}`));
    const ctx = require("tls").createSecureContext({
      key: certData.key,
      cert: `${certData.cert}\n${rootCAPem}`
    });
    certCache.set(servername, ctx);
    cb(null, ctx);
  } catch (e) {
    err(`SNI error for ${servername}: ${e.message}`);
    cb(e);
  }
}

// ── Helpers ───────────────────────────────────────────────────

const cachedTargetIPs = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTargetIP(hostname) {
  const cached = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses = await resolve4(hostname);
  cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
  return cachedTargetIPs[hostname].ip;
}

function collectBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Extract model from URL path (Gemini), body (OpenAI/Anthropic), or Kiro conversationState
function extractModel(url, body) {
  const urlMatch = url.match(/\/models\/([^/:]+)/);
  if (urlMatch) return urlMatch[1];
  
  // Skip parsing if body is binary (AWS EventStream, Protocol Buffers, etc.)
  if (isBinaryData(body)) return null;
  
  try {
    const parsed = JSON.parse(body.toString());
    if (parsed.conversationState) {
      return parsed.conversationState.currentMessage?.userInputMessage?.modelId || null;
    }
    return parsed.model || null;
  } catch { return null; }
}

// Detect binary data vs JSON text
function isBinaryData(buffer) {
  if (!buffer || buffer.length === 0) return false;
  // AWS EventStream signature: first 4 bytes = frame length (big-endian uint32)
  // Check for non-printable chars in first 100 bytes (common in binary protocols)
  const sample = buffer.slice(0, Math.min(100, buffer.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    // Count non-ASCII printable chars (excluding whitespace)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
      nonPrintable++;
    }
    if (byte > 0x7E) nonPrintable++;
  }
  // If >30% non-printable, treat as binary
  return (nonPrintable / sample.length) > 0.3;
}

function getMappedOverride(tool, model, aliases) {
  if (!model) return null;
  try {
    if (aliases === undefined) aliases = getMitmAlias(tool);
    if (!aliases) return null;
    // Normalize via synonym map (e.g., public AG names -> backend model ids)
    const normalizedModel = String(model).replace(/^models\//, "");
    let lookup = MODEL_SYNONYMS?.[tool]?.[normalizedModel] || normalizedModel;
    // Kiro GPT-5.6 (#2596): the MITM path reads the native userInputMessage
    // modelId, which may arrive in digit-dash form (`gpt-5-6-sol`) while picker
    // aliases are saved dotted (`gpt-5.6-sol`). Unlike provider routing there
    // is no digit-dash-digit normalization here, so normalize before lookup or
    // dash-form ids fall through to AWS instead of the configured provider.
    if (tool === "kiro") lookup = lookup.replace(/^(gpt-)(\d+)-(\d+)(?=-|$)/, "$1$2.$3");
    if (aliases[lookup]) return aliases[lookup];
    // Prefix match fallback: longest configured alias that prefixes the
    // lookup wins (deterministic specificity — a short alias like `gpt-5`
    // must not hijack `gpt-5.6-sol` by object key order). One-directional:
    // raw id must start with the configured key, never the reverse.
    const prefixKey = Object.keys(aliases).filter((k) => k && aliases[k] && lookup.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (prefixKey) return aliases[prefixKey];
    // Pattern fallback: catches AG renamed variants (e.g. deprecated pro IDs → gemini-pro-agent)
    const patterns = MODEL_PATTERNS?.[tool] || [];
    for (const { match, alias } of patterns) {
      if (match.test(lookup) && aliases[alias]) return aliases[alias];
    }
    return null;
  } catch { return null; }
}

/**
 * Forward request to real upstream.
 * Optional onResponse(rawBuffer) callback — if provided, tees the response
 * so it's both forwarded to client AND passed to the callback for inspection.
 * Also tees full stream into a dump file when ENABLE_FILE_LOG is on.
 */
async function passthrough(req, res, bodyBuffer, onResponse) {
  const originalHost = (req.headers.host || TARGET_HOSTS[0]).split(":")[0];
  // Only rewrite host for chat endpoints — daily-cloudcode-pa rejects auth/login requests
  const isChatEndpoint = req.url.includes(":generateContent") || req.url.includes(":streamGenerateContent");
  const targetHost = isChatEndpoint ? (HOST_REWRITE[originalHost] || originalHost) : originalHost;
  const dumper = ENABLE_FILE_LOG ? createResponseDumper(req, "passthrough") : null;

  const tool = getToolForHost(req.headers.host);
  const versionOverride = tool === "antigravity"
    ? applyAntigravityIdeVersionOverride(bodyBuffer, req.headers)
    : { bodyBuffer, headers: req.headers };
  const bodyForForwarding = versionOverride.bodyBuffer;
  const headersForForwarding = { ...versionOverride.headers, host: targetHost };
  if (bodyForForwarding !== bodyBuffer) {
    headersForForwarding["content-length"] = String(bodyForForwarding.length);
  }

  // ALPN negotiate: try HTTP/2 first (like browsers/mitmweb), fallback HTTP/1.1
  try {
    const proto = await negotiateAlpn(targetHost);
    if (proto === "h2") {
      return await passthroughHttp2(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
    }
  } catch (e) {
    err(`[mitm] ALPN negotiate failed: ${e.message}, fallback to HTTP/1.1`);
  }

  return passthroughHttps(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
}

// ── ALPN negotiation cache ────────────────────────────────────
const alpnCache = new Map(); // host → "h2" | "http/1.1"
async function negotiateAlpn(host) {
  if (alpnCache.has(host)) return alpnCache.get(host);
  const ip = await resolveTargetIP(host);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: ip, port: 443, servername: host,
      ALPNProtocols: ["h2", "http/1.1"], rejectUnauthorized: true,
    }, () => {
      const proto = socket.alpnProtocol || "http/1.1";
      alpnCache.set(host, proto);
      log(`🔗 [mitm] ALPN ${host} → ${proto}`);
      socket.end();
      resolve(proto);
    });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(new Error("ALPN timeout")); });
  });
}

// HTTP/2 passthrough using node:http2 native
async function passthroughHttp2(req, res, bodyBuffer, headers, targetHost, onResponse, dumper) {
  const targetIP = await resolveTargetIP(targetHost);
  // HTTP/2 pseudo-headers required; strip HTTP/1.1-only headers
  const h2Headers = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "host" || lk === "connection" || lk === "keep-alive" ||
        lk === "transfer-encoding" || lk === "upgrade" || lk === "proxy-connection") continue;
    h2Headers[lk] = v;
  }
  h2Headers[":method"] = req.method;
  h2Headers[":path"] = req.url;
  h2Headers[":scheme"] = "https";
  h2Headers[":authority"] = targetHost;

  return new Promise((resolve) => {
    const client = http2.connect(`https://${targetHost}`, {
      createConnection: () => tls.connect({
        host: targetIP, port: 443, servername: targetHost,
        ALPNProtocols: ["h2"], rejectUnauthorized: true,
      }),
    });
    client.once("error", (e) => {
      err(`[mitm] http2 client error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
      try { client.close(); } catch {}
      resolve();
    });

    const stream = client.request(h2Headers, { endStream: bodyBuffer.length === 0 });
    if (bodyBuffer.length > 0) stream.end(bodyBuffer);

    stream.once("response", (responseHeaders) => {
      const status = responseHeaders[":status"];
      // Filter pseudo-headers + connection-specific
      const outHeaders = {};
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (k.startsWith(":")) continue;
        if (k === "connection" || k === "keep-alive" || k === "transfer-encoding") continue;
        outHeaders[k] = v;
      }
      res.writeHead(status, outHeaders);
      if (dumper) dumper.writeHeader(status, outHeaders);

      const chunks = [];
      stream.on("data", chunk => {
        if (dumper) dumper.writeChunk(chunk);
        if (onResponse) chunks.push(chunk);
        res.write(chunk);
      });
      stream.on("end", () => {
        if (dumper) dumper.end();
        if (!res.writableEnded) res.end();
        if (onResponse) try { onResponse(Buffer.concat(chunks), outHeaders); } catch {}
        try { client.close(); } catch {}
        resolve();
      });
    });
    stream.once("error", (e) => {
      err(`[mitm] http2 stream error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2-stream] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end();
      try { client.close(); } catch {}
      resolve();
    });
  });
}

// Fallback: raw https.request HTTP/1.1 with custom DNS (bypasses /etc/hosts MITM loop)
async function passthroughHttps(req, res, bodyBuffer, headers, targetHost, onResponse, dumper) {
  const targetIP = await resolveTargetIP(targetHost);
  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
    servername: targetHost,
    rejectUnauthorized: true
  }, (forwardRes) => {
    res.writeHead(forwardRes.statusCode, forwardRes.headers);
    if (dumper) dumper.writeHeader(forwardRes.statusCode, forwardRes.headers);

    if (!onResponse && !dumper) {
      forwardRes.pipe(res);
      return;
    }

    const chunks = [];
    forwardRes.on("data", chunk => {
      if (dumper) dumper.writeChunk(chunk);
      if (onResponse) chunks.push(chunk);
      res.write(chunk);
    });
    forwardRes.on("end", () => {
      if (dumper) dumper.end();
      res.end();
      if (onResponse) try { onResponse(Buffer.concat(chunks), forwardRes.headers); } catch { /* ignore */ }
    });
  });

  forwardReq.on("error", (e) => {
    err(`Passthrough error: ${e.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${e.message}\n`); dumper.end(); }
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ── Request handler ───────────────────────────────────────────

async function handleRequest(req, res, {
  verifyPeerOwner = createPeerOwnerVerifier({ targetPorts: [...new Set([443, LOCAL_PORT])] }),
} = {}) {
  try {
    if (!(await verifyPeerOwner(req.socket))) {
      res.writeHead(403, { "Content-Type": "application/json", "Connection": "close" });
      res.end(JSON.stringify({ error: "mitm_peer_owner_mismatch" }));
      return;
    }

    if (req.url === "/_mitm_health") {
      const proof = createHealthProof(req);
      if (!proof) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid, proof }));
      return;
    }

    if (!isAllowedTargetHost(req.headers.host)) {
      res.writeHead(421, { "Content-Type": "application/json", "Connection": "close" });
      res.end(JSON.stringify({ error: "unsupported_mitm_host" }));
      return;
    }

    const bodyBuffer = await collectBodyRaw(req);
    if (ENABLE_FILE_LOG) dumpRequest(req, bodyBuffer, "raw");

    // Anti-loop: skip requests from 9Router
    if (req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
      return passthrough(req, res, bodyBuffer);
    }

    const tool = getToolForHost(req.headers.host);
    if (!tool) return passthrough(req, res, bodyBuffer);

    const patterns = URL_PATTERNS[tool] || [];
    const isChat = patterns.some(p => req.url.includes(p));
    if (!isChat) return passthrough(req, res, bodyBuffer);

    // Cursor uses binary proto — model extraction not possible at this layer.
    // Delegate directly to handler which decodes proto internally.
    if (tool === "cursor") {
      return handlers[tool].intercept(req, res, bodyBuffer, null, passthrough);
    }

    const model = extractModel(req.url, bodyBuffer);

    // Intentional passthrough: some models must never be re-routed (e.g. Antigravity
    // tab-autocomplete) so latency-critical inline completion stays native. Silent — this
    // is by design, not a leak, and fires per keystroke. See MODEL_NO_MAP in config.js.
    if (model && (MODEL_NO_MAP[tool] || []).some((re) => re.test(model))) {
      return passthrough(req, res, bodyBuffer);
    }

    const mappedOverride = getMappedOverride(tool, model);
    if (!mappedOverride) {
      return passthrough(req, res, bodyBuffer);
    }

    if (tool === "antigravity") {
      return handlers[tool].intercept(req, res, bodyBuffer, mappedOverride, passthrough);
    }
    if (!mappedOverride.model) return passthrough(req, res, bodyBuffer);
    return handlers[tool].intercept(req, res, bodyBuffer, mappedOverride.model, passthrough);
  } catch (e) {
    err(`Unhandled error: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "mitm_error" } }));
  }
}

function createMitmServer({
  httpsModule = https,
  tlsOptions,
  peerVerifier = createPeerOwnerVerifier({ targetPorts: [...new Set([443, LOCAL_PORT])] }),
}) {
  const { key, cert, rootCAPem: loadedRootCAPem } = tlsOptions;
  certCache.clear();
  rootCAPem = loadedRootCAPem;
  rootCAForLeaves = {
    key: forge.pki.privateKeyFromPem(key.toString("utf8")),
    cert: forge.pki.certificateFromPem(cert.toString("utf8")),
  };
  return httpsModule.createServer(
    { key, cert, SNICallback: sniCallback },
    (req, res) => handleRequest(req, res, { verifyPeerOwner: peerVerifier }),
  );
}

function registerShutdownHandlers(server, {
  processImpl = process,
} = {}) {
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    // The child is intentionally unprivileged. Its owning manager serializes
    // hosts/redirect cleanup and must remain alive until that cleanup succeeds.
    const forceExit = setTimeout(() => processImpl.exit(0), 1500);
    server.close(() => {
      clearTimeout(forceExit);
      processImpl.exit(0);
    });
  };

  processImpl.on("SIGTERM", shutdown);
  processImpl.on("SIGINT", shutdown);
  if (processImpl.platform === "win32") processImpl.on("SIGBREAK", shutdown);
  return shutdown;
}

async function startMitmServer({
  port = LOCAL_PORT,
  httpsModule = https,
  loadTls = loadRootCATls,
  clearDumpDirFn = clearDumpDir,
  processImpl = process,
  peerVerifier = createPeerOwnerVerifier({ targetPorts: [...new Set([443, port])] }),
  waitForAuthorization = waitForLaunchAuthorization,
} = {}) {
  await waitForAuthorization();
  if (ENABLE_FILE_LOG) clearDumpDirFn();
  const tlsOptions = await loadTls();
  const server = createMitmServer({ httpsModule, tlsOptions, peerVerifier });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") err(`Port ${port} already in use`);
    else if (error.code === "EACCES") err(`Permission denied for port ${port}`);
    else err(error.message);
    processImpl.exit(1);
  });
  server.listen(port, "127.0.0.1", () => log(`🚀 Server ready on 127.0.0.1:${port}`));
  const shutdown = registerShutdownHandlers(server, { processImpl });
  return { server, shutdown };
}

async function runMain() {
  try {
    await startMitmServer();
  } catch (error) {
    err(`Failed to start MITM server: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module || process.argv.includes(MITM_ENTRY_ARG)) void runMain();

module.exports = {
  createMitmServer,
  getMappedOverride,
  handleRequest,
  registerShutdownHandlers,
  runMain,
  sniCallback,
  startMitmServer,
};
