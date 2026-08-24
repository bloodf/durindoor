import http from "http";
import { URL } from "url";
import { sanitizeErrorMessage } from "../../../../open-sse/utils/error.js";
import {
  cancelOAuthFlow,
  claimOAuthFlow,
  consumeOAuthFlow,
  getOAuthFlow,
} from "../flowStore.js";
import { CODEX_CONFIG, OAUTH_TIMEOUT } from "../constants/oauth.js";

/**
 * Loopback origin guard for local OAuth callback listeners.
 * Legit OAuth redirects are top-level navigations (no `Origin` header); cross-site
 * pages issuing `fetch(..., { mode: "no-cors" })` against 127.0.0.1 always send
 * `Origin: https://attacker`. Reject any non-loopback Origin to block login-CSRF.
 * @param {string|undefined|null} origin
 * @returns {boolean}
 */
export function isLoopbackOrigin(origin) {
  if (origin == null) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

/**
 * Start a local HTTP server to receive OAuth callback
 * @param {Function} onCallback - Called with query params when callback received
 * @param {number} fixedPort - Optional fixed port number (default: random)
 * @returns {Promise<{server: http.Server, port: number, close: Function}>}
 */
export function startLocalServer(onCallback, fixedPort = null) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        if (!isLoopbackOrigin(req.headers.origin)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Cross-origin callback rejected");
          return;
        }

        const params = Object.fromEntries(url.searchParams);

        // Send success response to browser with auto-close attempt
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`);

        // Call callback with params
        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Listen on fixed port or find available port
    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(new Error(`Port ${fixedPort} is already in use. Please close other applications using this port.`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Wait for callback with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} - Callback params
 */
export function waitForCallback(timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Authentication timeout"));
      }
    }, timeoutMs);

    const onCallback = (params) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(params);
      }
    };

    // Return the callback function
    resolve.__onCallback = onCallback;
  });
}

// Singleton proxy server for Codex OAuth callback on fixed port
let codexProxyServer = null;
let codexProxyTimeout = null;
let codexProxyGeneration = 0;

const CODEX_PROXY_TIMEOUT_MS = OAUTH_TIMEOUT;
const CODEX_PORT = CODEX_CONFIG.fixedPort;

// Pending exchange sessions keyed by state — used by server-side exchange mode
const pendingExchanges = new Map();

function armCodexProxyTimeout(server, generation) {
  if (codexProxyTimeout) clearTimeout(codexProxyTimeout);
  codexProxyTimeout = setTimeout(() => {
    for (const session of pendingExchanges.values()) {
      if (
        session.generation !== generation ||
        (session.status !== "pending" && session.status !== "processing")
      ) continue;
      cancelOAuthFlow({ flowId: session.flowId, provider: "codex" });
      session.status = "error";
      session.error = "Authentication timeout";
    }
    stopCodexProxy(server).catch(() => {});
  }, CODEX_PROXY_TIMEOUT_MS);
}

/**
 * Register a pending exchange session for server-side mode.
 * Modal client calls this before opening popup.
 */
export function registerCodexSession({ state, flowId }) {
  const flow = getOAuthFlow({ state, flowId, provider: "codex" });
  if (!flow || flow.kind !== "authorization" || !codexProxyServer) return false;
  for (const oldSession of pendingExchanges.values()) {
    cancelOAuthFlow({ flowId: oldSession.flowId, provider: "codex" });
  }
  pendingExchanges.clear();
  pendingExchanges.set(state, {
    flowId,
    generation: codexProxyGeneration,
    status: "pending",
    createdAt: Date.now(),
  });
  // A reused fixed-port listener belongs to the newest registered attempt.
  // Restart its deadline so an earlier attempt cannot expire the successor.
  armCodexProxyTimeout(codexProxyServer, codexProxyGeneration);
  return true;
}

/**
 * Read session status (modal polls this).
 */
export function getCodexSessionStatus(state) {
  const session = pendingExchanges.get(state);
  if (!session) return null;
  if (Date.now() - session.createdAt >= OAUTH_TIMEOUT) {
    pendingExchanges.delete(state);
    return null;
  }
  return {
    flowId: session.flowId,
    status: session.status,
    connectionId: session.connectionId,
    email: session.email,
    error: session.error,
  };
}

/**
 * Clear a session (called after modal consumes status).
 */
export function clearCodexSession(state) {
  pendingExchanges.delete(state);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCodexResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${safeMessage}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

/**
 * Start Codex proxy on fixed port 1455.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port for legacy channel-based flow.
 */
export function startCodexProxy(appPort) {
  return new Promise((resolve) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

    const generation = ++codexProxyGeneration;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const candidateSession = state ? pendingExchanges.get(state) : null;
      const session = candidateSession?.generation === generation ? candidateSession : null;

      // Mode A: server-side exchange (session registered)
      if (session) {
        let claim = null;
        try {
          if (session.status !== "pending") {
            throw new Error("OAuth callback was already processed");
          }
          session.status = "processing";
          claim = claimOAuthFlow({
            flowId: session.flowId,
            state,
            provider: "codex",
          });
          if (!claim) throw new Error("OAuth session expired or was already used");
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          // Lazy load the provider graph only inside an actual callback. This
          // keeps importing generic OAuth services from patching global fetch.
          const { exchangeAndSaveAuthorizationCode } = await import("../flowCompletion.js");
          const { connection } = await exchangeAndSaveAuthorizationCode(
            "codex",
            code,
            state,
            claim,
          );

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = sanitizeErrorMessage(err?.message || "Authentication failed");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, session.error));
        } finally {
          if (claim) consumeOAuthFlow(claim);
          // A newer attempt may have registered while this exchange was in
          // flight. Only the session still owned by this callback may stop the
          // shared listener.
          if (pendingExchanges.get(state) === session) {
            await stopCodexProxy(server);
          }
        }
        return;
      }

      const hasServerSideSession = [...pendingExchanges.values()].some(
        (item) => item.generation === generation &&
          (item.status === "pending" || item.status === "processing"),
      );
      if (hasServerSideSession) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "OAuth session was not recognized."));
        return;
      }

      // Mode B: legacy channel fallback — 302 redirect to app /callback
      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      await stopCodexProxy(server);
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      armCodexProxyTimeout(server, generation);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

/**
 * Stop the Codex proxy server and cleanup
 */
export async function stopCodexProxy(expectedServer = null) {
  if (expectedServer && codexProxyServer !== expectedServer) return false;
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    const server = codexProxyServer;
    codexProxyServer = null;
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// xAI fixed-port proxy on 127.0.0.1:56121
// Same shape as the Codex proxy. Kept as a parallel implementation rather than
// generalizing the Codex one to keep the codex hot-path byte-equivalent.
// ───────────────────────────────────────────────────────────────────────────

let xaiProxyServer = null;
let xaiProxyTimeout = null;
let xaiProxyGeneration = 0;
const XAI_PROXY_TIMEOUT_MS = OAUTH_TIMEOUT;
const XAI_PROXY_PORT = 56121;
const xaiPendingExchanges = new Map();

function armXaiProxyTimeout(server, generation) {
  if (xaiProxyTimeout) clearTimeout(xaiProxyTimeout);
  xaiProxyTimeout = setTimeout(() => {
    for (const session of xaiPendingExchanges.values()) {
      if (
        session.generation !== generation ||
        (session.status !== "pending" && session.status !== "processing")
      ) continue;
      cancelOAuthFlow({ flowId: session.flowId, provider: "xai" });
      session.status = "error";
      session.error = "Authentication timeout";
    }
    stopXaiProxy(server).catch(() => {});
  }, XAI_PROXY_TIMEOUT_MS);
}

export function registerXaiSession({ state, flowId }) {
  const flow = getOAuthFlow({ state, flowId, provider: "xai" });
  if (!flow || flow.kind !== "authorization" || !xaiProxyServer) return false;
  for (const oldSession of xaiPendingExchanges.values()) {
    cancelOAuthFlow({ flowId: oldSession.flowId, provider: "xai" });
  }
  xaiPendingExchanges.clear();
  xaiPendingExchanges.set(state, {
    flowId,
    generation: xaiProxyGeneration,
    status: "pending",
    createdAt: Date.now(),
  });
  armXaiProxyTimeout(xaiProxyServer, xaiProxyGeneration);
  return true;
}

export function getXaiSessionStatus(state) {
  const session = xaiPendingExchanges.get(state);
  if (!session) return null;
  if (Date.now() - session.createdAt >= OAUTH_TIMEOUT) {
    xaiPendingExchanges.delete(state);
    return null;
  }
  return {
    flowId: session.flowId,
    status: session.status,
    connectionId: session.connectionId,
    email: session.email,
    error: session.error,
  };
}

export function clearXaiSession(state) {
  xaiPendingExchanges.delete(state);
}

function renderXaiResultPage(success, message) {
  return renderCodexResultPage(success, message);
}

/**
 * Start xAI proxy on fixed port 56121.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port.
 */
export function startXaiProxy(appPort) {
  return new Promise((resolve) => {
    if (xaiProxyServer) {
      resolve({ success: true });
      return;
    }

    const generation = ++xaiProxyGeneration;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXaiResultPage(false, "Cross-origin callback rejected"));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const candidateSession = state ? xaiPendingExchanges.get(state) : null;
      const session = candidateSession?.generation === generation ? candidateSession : null;

      // Mode A: server-side exchange
      if (session) {
        let claim = null;
        try {
          if (session.status !== "pending") {
            throw new Error("OAuth callback was already processed");
          }
          session.status = "processing";
          claim = claimOAuthFlow({
            flowId: session.flowId,
            state,
            provider: "xai",
          });
          if (!claim) throw new Error("OAuth session expired or was already used");
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          // Lazy load the provider graph only inside an actual callback. This
          // keeps importing generic OAuth services from patching global fetch.
          const { exchangeAndSaveAuthorizationCode } = await import("../flowCompletion.js");
          const { connection } = await exchangeAndSaveAuthorizationCode(
            "xai",
            code,
            state,
            claim,
          );

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = sanitizeErrorMessage(err?.message || "Authentication failed");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, session.error));
        } finally {
          if (claim) consumeOAuthFlow(claim);
          if (xaiPendingExchanges.get(state) === session) {
            await stopXaiProxy(server);
          }
        }
        return;
      }

      const hasServerSideSession = [...xaiPendingExchanges.values()].some(
        (item) => item.generation === generation &&
          (item.status === "pending" || item.status === "processing"),
      );
      if (hasServerSideSession) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderXaiResultPage(false, "OAuth session was not recognized."));
        return;
      }

      // Mode B: legacy fallback redirect
      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      await stopXaiProxy(server);
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      armXaiProxyTimeout(server, generation);
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export async function stopXaiProxy(expectedServer = null) {
  if (expectedServer && xaiProxyServer !== expectedServer) return false;
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyServer) {
    const server = xaiProxyServer;
    xaiProxyServer = null;
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// MCP gateway OAuth pending sessions (server-side exchange + dashboard poll).
// Keyed by instanceId + state; used by /api/mcp-gateway/oauth/[id]/[action].
// ───────────────────────────────────────────────────────────────────────────

const mcpPendingExchanges = new Map();

function mcpSessionKey(instanceId, state) {
  return `${instanceId}::${state}`;
}

export function registerMcpSession({ instanceId, state, codeVerifier, redirectUri, resource, clientId }) {
  if (!instanceId || !state || !codeVerifier || !redirectUri || !clientId) return false;
  mcpPendingExchanges.set(mcpSessionKey(instanceId, state), {
    codeVerifier,
    clientId,
    redirectUri,
    resource,
    scope: undefined,
    status: "pending",
    error: undefined,
    tokens: undefined,
    createdAt: Date.now(),
  });
  return true;
}

export function getMcpSessionStatus(instanceId, state) {
  return mcpPendingExchanges.get(mcpSessionKey(instanceId, state)) || null;
}

export function completeMcpSession(instanceId, state, result) {
  const key = mcpSessionKey(instanceId, state);
  const session = mcpPendingExchanges.get(key);
  if (!session) return false;
  if (result.status !== undefined) session.status = result.status;
  if (result.error !== undefined) session.error = result.error;
  if (result.tokens !== undefined) session.tokens = result.tokens;
  return true;
}

export function clearMcpSession(instanceId, state) {
  mcpPendingExchanges.delete(mcpSessionKey(instanceId, state));
}
