import net from "node:net";
import { describe, it, expect, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]) }));
const { testProxyUrl } = await import("../../src/lib/network/proxyTest.js");

describe("proxy test connection", () => {
  it("sends the checked IP as the HTTP CONNECT target", async () => {
    let target = "";
    const server = net.createServer((socket) => {
      socket.once("data", (data) => {
        target = data.toString().split("\r\n")[0];
        socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await testProxyUrl({ proxyUrl: `http://127.0.0.1:${server.address().port}`, testUrl: "https://example.com/path" });
      expect(target).toBe("CONNECT 93.184.216.34:443 HTTP/1.1");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it("sends the checked IP to a remote-DNS SOCKS proxy", async () => {
    let address = "";
    const server = net.createServer((socket) => {
      let stage = 0;
      socket.on("data", (data) => {
        if (stage++ === 0) socket.write(Buffer.from([5, 0]));
        else {
          address = data[3] === 1 ? [...data.subarray(4, 8)].join(".") : "not an IPv4 address";
          socket.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await testProxyUrl({ proxyUrl: `socks5h://127.0.0.1:${server.address().port}`, testUrl: "https://example.com/path" });
      expect(address).toBe("93.184.216.34");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

});
