import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectHttp2 } from "../../open-sse/utils/http2Connect.js";

class FixtureSocket extends EventEmitter {
  setTimeout() {}
  setNoDelay() {}
  destroy() {}
  unshift() {}
  write(request) {
    this.request = request;
    queueMicrotask(() => this.emit("data", Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n")));
  }
}
const h2 = { connect: vi.fn(() => Object.assign(new EventEmitter(), { connecting: false })) };
afterEach(() => vi.restoreAllMocks());

describe("Cursor HTTP/2 CONNECT IP handling", () => {
  it("rejects an untrusted HTTPS proxy certificate", async () => {
    const server = tls.createServer({
      key: readFileSync(new URL("../fixtures/tls/antigravity-probe-fixture.key", import.meta.url)),
      cert: readFileSync(new URL("../fixtures/tls/antigravity-probe-fixture.crt", import.meta.url)),
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await expect(connectHttp2("https://origin.example/", {
        proxyUrl: `https://127.0.0.1:${server.address().port}`,
        http2Module: h2,
      })).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it.each([
    ["https://127.0.0.1:8443", "127.0.0.1", undefined],
    ["https://[::1]:8443", "::1", undefined],
    ["https://proxy.example:8443", "proxy.example", "proxy.example"],
  ])("uses the correct proxy TLS identity for %s", async (proxyUrl, host, servername) => {
    const sockets = [];
    const dial = vi.spyOn(tls, "connect").mockImplementation((options) => {
      const socket = new FixtureSocket();
      sockets.push({ socket, options });
      socket.alpnProtocol = options.socket ? "h2" : "http/1.1";
      queueMicrotask(() => socket.emit("secureConnect"));
      return socket;
    });
    await connectHttp2("https://origin.example/", { proxyUrl, http2Module: h2 });
    expect(dial).toHaveBeenCalledTimes(2);
    expect(sockets[0].options).toMatchObject({ host, port: 8443, ALPNProtocols: ["http/1.1"] });
    expect(sockets[0].options.servername).toBe(servername);
    expect(sockets[0].options.rejectUnauthorized).not.toBe(false);
    expect(sockets[1].options).toMatchObject({ host: "origin.example", servername: "origin.example" });
    expect(sockets[1].options.rejectUnauthorized).not.toBe(false);
  });

  it.each([
    ["https://127.0.0.1:443/", "127.0.0.1", "127.0.0.1:443"],
    ["https://[::1]:444/", "::1", "[::1]:444"],
  ])("keeps IP target identity and CONNECT authority for %s", async (url, host, authority) => {
    const proxy = new FixtureSocket();
    vi.spyOn(net, "connect").mockImplementation(() => {
      queueMicrotask(() => proxy.emit("connect"));
      return proxy;
    });
    const dial = vi.spyOn(tls, "connect").mockImplementation(() => {
      const socket = new FixtureSocket();
      socket.alpnProtocol = "h2";
      queueMicrotask(() => socket.emit("secureConnect"));
      return socket;
    });
    await connectHttp2(url, { proxyUrl: "http://[::1]:8080", http2Module: h2 });
    expect(net.connect).toHaveBeenCalledWith({ host: "::1", port: 8080 });
    expect(proxy.request).toContain(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n`);
    expect(dial.mock.calls[0][0]).toMatchObject({ host, socket: proxy });
    expect(dial.mock.calls[0][0].servername).toBeUndefined();
    expect(dial.mock.calls[0][0].rejectUnauthorized).not.toBe(false);
  });
});
