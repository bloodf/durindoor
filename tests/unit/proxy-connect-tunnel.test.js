import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "http";
import net from "net";

/**
 * Regression guard for OmniRoute #6620 (force CONNECT tunnel for plain-HTTP
 * proxied requests). undici 8.6+ stopped tunneling plain-HTTP targets through
 * ProxyAgent unless `proxyTunnel: true` is set; CONNECT-only proxies then
 * reject the forwarded origin request with 501. On undici 7.x (our pinned
 * major) ProxyAgent already tunnels by default and `proxyTunnel` is an ignored
 * unknown option, so this test locks two things at once:
 *   1. proxyAwareFetch routes a plain-HTTP target through the connection proxy
 *      via CONNECT (not a direct origin request), and
 *   2. the proxyTunnel option does not regress behavior on the pinned major.
 * When the chore/undici-8 follow-up lands, this same test becomes the guard
 * that proves the fix actually matters.
 */

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("proxyAwareFetch CONNECT tunneling (connection proxy)", () => {
  let proxy;
  let origin;
  let connectCount = 0;
  let originHits = 0;
  // CONNECT upgrades hijack the socket off the server, so server.close() and
  // even closeAllConnections() may not reap them. Track every raw socket from
  // both servers and destroy them in teardown to keep Vitest from hanging on
  // an open handle.
  const sockets = new Set();
  const savedEnv = {};
  let savedFetch;

  beforeEach(async () => {
    vi.resetModules();
    connectCount = 0;
    originHits = 0;
    sockets.clear();

    // proxyFetch.js patches globalThis.fetch on import (idempotently); save
    // and restore so we don't leak the patched fetch into other tests sharing
    // this Vitest worker during the full suite.
    savedFetch = globalThis.fetch;

    // Developer machines often have HTTP_PROXY/HTTPS_PROXY set; isolate the
    // test from the environment so the explicit connection proxy is the only
    // route proxyAwareFetch can take.
    for (const key of PROXY_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    // CONNECT-only HTTP proxy: counts CONNECT requests, then pipes the
    // client socket to the requested host:port. A plain (non-CONNECT) request
    // is answered with 501 so a broken forwarder is visibly distinguishable.
    proxy = http.createServer((req, res) => {
      res.writeHead(501, { "Content-Type": "text/plain" });
      res.end("CONNECT only");
    });
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    proxy.on("connect", (req, clientSocket, head) => {
      connectCount += 1;
      sockets.add(clientSocket);
      clientSocket.on("close", () => sockets.delete(clientSocket));
      const [, portRaw] = req.url.split(":");
      const port = Number(portRaw) || 80;
      // Synthetic public target resolves inside this fixture only; loopback targets must bypass proxies.
      const upstream = net.connect(port, "127.0.0.1", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    });
    const proxyPort = await listen(proxy);

    // Plain-HTTP origin reached through the proxy's fixture-only hostname mapping.
    origin = http.createServer((req, res) => {
      originHits += 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("origin-ok");
    });
    origin.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    const originPort = await listen(origin);
    origin.__port = originPort;
    proxy.__port = proxyPort;
  });

  afterEach(async () => {
    globalThis.fetch = savedFetch;
    for (const key of PROXY_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    // Destroy every hijacked/lingering socket before closing the servers so
    // server.close() is not blocked waiting on tunnel/keepalive sockets.
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
    }
    sockets.clear();
    await Promise.all([proxy ? close(proxy) : null, origin ? close(origin) : null]);
  });

  it("tunnels a plain-HTTP target through the connection proxy via CONNECT", async () => {
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const res = await proxyAwareFetch(
      `http://origin.example.test:${origin.__port}/hello`,
      { method: "GET" },
      {
        enabled: true,
        url: `http://127.0.0.1:${proxy.__port}`,
        strictProxy: true,
      },
    );

    // Consume the body before teardown so the underlying socket is released.
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("origin-ok");
    // CONNECT fired (proxied, not direct) and the origin was actually hit.
    expect(connectCount).toBe(1);
    expect(originHits).toBe(1);
  });
});
