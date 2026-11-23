import net from "node:net";
import { once } from "node:events";
import { fetch } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { createSocksDispatcher } from "../../open-sse/utils/socksDispatcher.js";
import { proxyAwareFetch, __clearProxyDispatchersForTesting } from "../../open-sse/utils/proxyFetch.js";

const servers = [];
const dispatchers = [];
afterEach(async () => {
  await Promise.all(dispatchers.splice(0).map((dispatcher) => dispatcher.destroy()));
  __clearProxyDispatchersForTesting();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function socksServer({ auth = false, reject = false } = {}) {
  const seen = {};
  const server = net.createServer((socket) => {
    let stage = 0;
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (stage === 0 && pending.length >= 2 && pending.length >= 2 + pending[1]) {
        pending = pending.subarray(2 + pending[1]);
        socket.write(Buffer.from([5, auth ? 2 : 0]));
        stage = auth ? 1 : 2;
      }
      if (stage === 1 && pending.length >= 2 && pending.length >= 3 + pending[1]) {
        const passLengthIndex = 2 + pending[1];
        if (pending.length < passLengthIndex + 1 + pending[passLengthIndex]) return;
        seen.user = pending.subarray(2, passLengthIndex).toString();
        seen.password = pending.subarray(passLengthIndex + 1, passLengthIndex + 1 + pending[passLengthIndex]).toString();
        pending = pending.subarray(passLengthIndex + 1 + pending[passLengthIndex]);
        socket.write(Buffer.from([1, 0]));
        stage = 2;
      }
      if (stage === 2 && pending.length >= 5) {
        const type = pending[3];
        const size = type === 3 ? 1 + pending[4] : type === 1 ? 4 : 16;
        if (pending.length < 4 + size + 2) return;
        seen.type = type;
        seen.host = type === 3 ? pending.subarray(5, 5 + pending[4]).toString() : [...pending.subarray(4, 8)].join(".");
        pending = pending.subarray(4 + size + 2);
        socket.write(Buffer.from([5, reject ? 5 : 0, 0, 1, 127, 0, 0, 1, 0, 80]));
        stage = reject ? 4 : 3;
      }
      if (stage === 3 && pending.includes(Buffer.from("\r\n\r\n"))) {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
        stage = 4;
      }
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { seen, url: `127.0.0.1:${server.address().port}` };
}

async function request(proxy, target = "http://example.test/") {
  const dispatcher = createSocksDispatcher(proxy, { connectTimeout: 1000 });
  dispatchers.push(dispatcher);
  return fetch(target, { dispatcher });
}

describe("SOCKS Undici dispatcher", () => {
  it("sends remote DNS through an unauthenticated SOCKS5 proxy", async () => {
    const proxy = await socksServer();
    expect(await (await request(`socks5h://${proxy.url}`)).text()).toBe("OK");
    expect(proxy.seen).toMatchObject({ type: 3, host: "example.test" });
  });
  it("routes gateway requests through the selected SOCKS proxy", async () => {
    const proxy = await socksServer();
    const response = await proxyAwareFetch("http://example.test/", {}, {
      enabled: true, connectionProxyUrl: `socks5h://${proxy.url}`, strictProxy: true,
    });
    expect(await response.text()).toBe("OK");
    expect(proxy.seen.host).toBe("example.test");
  });
  it("authenticates and resolves socks5 DNS locally", async () => {
    const proxy = await socksServer({ auth: true });
    expect(await (await request(`socks5://alice:secret@${proxy.url}`, "http://localhost/")).text()).toBe("OK");
    expect(proxy.seen).toMatchObject({ user: "alice", password: "secret" });
    expect(proxy.seen.type).not.toBe(3);
  });
  it("does not disclose credentials on connection failure", async () => {
    const proxy = await socksServer({ auth: true, reject: true });
    const error = await request(`socks5h://alice:secret@${proxy.url}`).catch((err) => err);
    expect(String(error.cause)).toContain("SOCKS connection failed");
    expect(String(error.cause)).not.toMatch(/alice|secret/);
  });
  it("rejects unsupported schemes and oversized credentials before dialing", () => {
    expect(() => createSocksDispatcher("ftp://example.test")).toThrow("Invalid SOCKS proxy URL");
    expect(() => createSocksDispatcher(`socks5://${"x".repeat(256)}:secret@127.0.0.1:1`)).toThrow("255-byte");
  });
});
