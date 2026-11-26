/**
 * HTTP/2 client sessions, optionally tunneled through an HTTP CONNECT or SOCKS proxy.
 *
 * Node's http2.connect() is a direct TCP/TLS connection and ignores HTTP_PROXY.
 * Cursor's AgentService (GetUsableModels and Run) is HTTP/2-only, so we must
 * keep h2 and tunnel it: CONNECT (or SOCKS) → TLS(ALPN=h2) → http2 session.
 */

import net from "net";
import tls from "tls";
import http2 from "http2";
import { resolveProxyForRequest, stripIpv6Brackets } from "./proxyFetch.js";
import { isSocksDispatcherUrl } from "./socksDispatcher.js";
import { assertSocksProxyUrl } from "./socksCredential.js";

function waitForHttp2Session(client, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })); return; }
    if (client.destroyed) {
      reject(new Error("HTTP/2 session destroyed"));
      return;
    }
    if (!client.connecting) {
      resolve(client);
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("HTTP/2 session connect timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.off("connect", onConnect);
      client.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onConnect = () => {
      cleanup();
      if (client.socket?.alpnProtocol !== "h2") {
        reject(new Error("TLS peer did not negotiate h2 via ALPN"));
      } else resolve(client);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => onError(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    client.once("connect", onConnect);
    client.once("error", onError);
  });
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CONNECT_HEADER_BYTES = 64 * 1024;
export function buildHttpConnectRequest(targetHost, targetPort, proxyUrl) {
  const proxy = new URL(proxyUrl);
  const authorityHost = net.isIPv6(targetHost) ? `[${targetHost}]` : targetHost;
  let auth = "";
  if (proxy.username || proxy.password) {
    const user = decodeURIComponent(proxy.username || "");
    const pass = decodeURIComponent(proxy.password || "");
    auth = `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}\r\n`;
  }
  return (
    `CONNECT ${authorityHost}:${targetPort} HTTP/1.1\r\n` +
    `Host: ${authorityHost}:${targetPort}\r\n` +
    auth +
    `\r\n`
  );
}

async function connectViaHttpProxy(proxyUrl, targetHost, targetPort, timeoutMs, signal) {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
  }
  const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);

  return new Promise((resolve, reject) => {
    const proxyHost = stripIpv6Brackets(proxy.hostname);
    const options = { host: proxyHost, port: proxyPort };
    // IP literals have no SNI; keep host set so TLS verifies the certificate
    // against the IP. DNS names retain SNI and normal certificate verification.
    const proxyTlsOptions = { ...options, ALPNProtocols: ["http/1.1"] };
    if (!net.isIP(proxyHost)) proxyTlsOptions.servername = proxyHost;
    const socket = proxy.protocol === "https:"
      ? tls.connect(proxyTlsOptions)
      : net.connect(options);
    let settled = false;
    let buf = Buffer.alloc(0);

    const cleanup = () => {
      socket.setTimeout(0);
      socket.off("error", fail);
      socket.off("timeout", onTimeout);
      socket.off("close", onClose);
      socket.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => fail(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    const onTimeout = () => fail(new Error("Proxy CONNECT timed out"));
    const onClose = () => fail(new Error("Proxy CONNECT closed before response headers"));
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (buf.length > MAX_CONNECT_HEADER_BYTES) {
          fail(new Error("Proxy CONNECT response headers too large"));
        }
        return;
      }
      if (headerEnd + 4 > MAX_CONNECT_HEADER_BYTES) {
        fail(new Error("Proxy CONNECT response headers too large"));
        return;
      }
      const statusLineEnd = buf.indexOf("\r\n");
      const statusLine = buf.subarray(0, statusLineEnd).toString("latin1");
      const code = Number(statusLine.split(" ")[1]);
      if (code !== 200) {
        fail(new Error(`Proxy CONNECT failed: ${statusLine.trim()}`));
        return;
      }
      const leftover = buf.subarray(headerEnd + 4);
      if (leftover.length) socket.unshift(leftover);
      settled = true;
      cleanup();
      resolve(socket);
    };

    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("error", fail);
    socket.once("timeout", onTimeout);
    socket.once("close", onClose);
    socket.setTimeout(timeoutMs);
    socket.once(proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
      socket.setNoDelay(true);
      socket.write(buildHttpConnectRequest(targetHost, targetPort, proxyUrl));
    });
    socket.on("data", onData);
  });
}

async function connectViaSocks(proxyUrl, targetHost, targetPort, timeoutMs, signal) {
  // Validate RFC 1929 credential lengths before the agent can start its socket handler.
  assertSocksProxyUrl(proxyUrl);
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const agent = new SocksProxyAgent(proxyUrl, { timeout: timeoutMs });
  let socket;
  const req = {
    destroy() { socket?.destroy(); },
    emit() {},
    protocol: "http:",
    host: targetHost,
    port: Number(targetPort),
    path: `${targetHost}:${targetPort}`,
    method: "CONNECT",
  };
  const opts = {
    host: targetHost,
    port: Number(targetPort),
    secureEndpoint: false,
  };
  const pending = agent.connect(req, opts);
  if (signal) {
    socket = await new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      pending.then((connected) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) connected.destroy();
        else resolve(connected);
      }, (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  } else socket = await pending;
  // The agent's timeout is for setup, not an idle limit on the h2 tunnel.
  socket.setTimeout(0);
  return socket;
}

async function createProxiedTlsSocket(proxyUrl, targetHost, targetPort, timeoutMs, signal) {
  const plain = isSocksDispatcherUrl(proxyUrl)
    ? await connectViaSocks(proxyUrl, targetHost, targetPort, timeoutMs, signal)
    : await connectViaHttpProxy(proxyUrl, targetHost, targetPort, timeoutMs, signal);

  return new Promise((resolve, reject) => {
    let tlsSocket;
    try {
      const options = { socket: plain, host: targetHost, ALPNProtocols: ["h2"] };
      if (!net.isIP(targetHost)) options.servername = targetHost;
      tlsSocket = tls.connect(options);
    } catch (error) {
      plain.destroy();
      reject(error);
      return;
    }
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tlsSocket.off("error", onError);
      tlsSocket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        tlsSocket.destroy();
        reject(error);
      } else {
        tlsSocket.setNoDelay(true);
        resolve(tlsSocket);
      }
    };
    const onError = (error) => finish(error);
    const onAbort = () => finish(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    const onClose = () => finish(new Error("TLS connection through proxy closed during handshake"));
    const timer = setTimeout(
      () => finish(new Error("TLS handshake through proxy timed out")),
      timeoutMs,
    );
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    tlsSocket.once("secureConnect", () => {
      if (tlsSocket.alpnProtocol !== "h2") {
        finish(new Error(`TLS peer did not negotiate h2 via ALPN (got ${tlsSocket.alpnProtocol || "none"})`));
        return;
      }
      finish();
    });
    tlsSocket.once("error", onError);
    tlsSocket.once("close", onClose);
  });
}

/**
 * Open an HTTP/2 client session to `url`.
 * When `proxyUrl` is set (http://, https://, socks5://, …), tunnel via CONNECT/SOCKS.
 */
export async function connectHttp2(url, { proxyUrl, timeoutMs = DEFAULT_TIMEOUT_MS, http2Module = http2, signal } = {}) {
  const urlObj = new URL(url);
  const host = stripIpv6Brackets(urlObj.hostname);
  const port = Number(urlObj.port) || 443;
  const authority = `https://${urlObj.host}`;

  if (!proxyUrl) {
    const client = http2Module.connect(authority);
    try {
      return await waitForHttp2Session(client, timeoutMs, signal);
    } catch (error) {
      try { client.destroy(); } catch {}
      throw error;
    }
  }

  const tlsSocket = await createProxiedTlsSocket(proxyUrl, host, port, timeoutMs, signal);
  const client = http2Module.connect(authority, {
    createConnection: () => tlsSocket,
  });
  const destroySocket = () => {
    try { tlsSocket.destroy(); } catch {}
  };
  client.once("close", destroySocket);
  client.once("error", destroySocket);
  try {
    return await waitForHttp2Session(client, timeoutMs, signal);
  } catch (error) {
    try { client.close(); } catch {}
    destroySocket();
    throw error;
  }
}

/** Resolve an HTTP/2 route without bypassing a bound proxy or unsupported relay. */
export function cursorProxyUrl(url, options = null) {
  const route = resolveProxyForRequest(url, options);
  if (route.source === "relay") throw new Error("Cursor HTTP/2 cannot use an HTTP relay");
  if ((options?.proxyPoolId || options?.connectionProxyEnabled || options?.enabled) && route.source !== "connection") throw new Error("Cursor HTTP/2 bound proxy unavailable");
  if (options?.strictProxy && !route.proxyUrl) throw new Error("Cursor HTTP/2 proxy required but unavailable");
  return route.proxyUrl;
}
