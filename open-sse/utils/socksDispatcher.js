import tls from "node:tls";
import net from "node:net";
import { Agent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import { assertSocksProxyUrl } from "./socksCredential.js";

const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

export function isSocksDispatcherUrl(url) {
  try { return SOCKS_PROTOCOLS.has(new URL(url).protocol); } catch { return false; }
}

/** Adapt the installed SOCKS socket connector to Undici's dispatcher API. */
export function createSocksDispatcher(url, options = {}) {
  if (!isSocksDispatcherUrl(url)) throw new Error("Invalid SOCKS proxy URL");
  assertSocksProxyUrl(url);
  const timeout = options.connectTimeout || 30000;
  const socks = new SocksProxyAgent(url, { timeout });
  return new Agent({
    ...options,
    connect({ hostname, host, port, protocol, servername }, callback) {
      let settled = false;
      let socket;
      const timer = setTimeout(() => finish(new Error("SOCKS connection timed out")), timeout);
      function finish(error, connected) {
        if (settled) { connected?.destroy(); return; }
        settled = true;
        clearTimeout(timer);
        if (error) socket?.destroy();
        callback(error, connected);
      }
      const request = { emit() {}, destroy() { socket?.destroy(); } };
      socks.connect(request, { host: hostname || host, port: Number(port || (protocol === "https:" ? 443 : 80)), secureEndpoint: false })
        .then((connected) => {
          socket = connected;
          socket.setTimeout(0);
          if (settled) { socket.destroy(); return; }
          if (protocol !== "https:") { finish(null, socket); return; }
          const serverName = options.targetServername || servername || hostname;
          const tlsOptions = { socket };
          if (serverName && !net.isIP(serverName)) tlsOptions.servername = serverName;
          if (serverName && net.isIP(serverName)) {
            tlsOptions.checkServerIdentity = (_host, cert) => tls.checkServerIdentity(serverName, cert);
          }
          const tlsSocket = tls.connect(tlsOptions);
          socket = tlsSocket;
          tlsSocket.once("secureConnect", () => finish(null, tlsSocket));
          tlsSocket.once("error", () => finish(new Error("SOCKS TLS connection failed")));
        }).catch(() => finish(new Error("SOCKS connection failed")));
    },
  });
}
