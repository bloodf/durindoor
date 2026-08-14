import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getClientIp } from "../../src/lib/auth/loginLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

describe("Next.js Server Process Title", () => {
  it("sets the process title to '9router next-server'", () => {
    // Save original title
    const originalTitle = process.title;

    // Resolve server.js relative to custom-server.js (which is at the root)
    const serverPath = path.resolve(__dirname, "../../server.js");

    // Write a dummy server.js so Node.js resolver finds it on disk
    fs.writeFileSync(serverPath, "module.exports = {};");

    // Populate require.cache to mock require("./server.js")
    require.cache[serverPath] = {
      id: serverPath,
      filename: serverPath,
      loaded: true,
      exports: {},
    };

    try {
      const { setProcessTitle } = require("../../custom-server.js");
      setProcessTitle();

      // Verify process.title is updated
      expect(process.title).toBe("9router next-server");

      // Try to set it to something else
      process.title = "next-server";
      expect(process.title).toBe("9router next-server");
    } finally {
      // Restore original title
      const originalSetTitle = Object.getOwnPropertyDescriptor(process, "title")?.set;
      if (originalSetTitle) {
        Object.defineProperty(process, "title", {
          value: originalTitle,
          writable: true,
          configurable: true
        });
      } else {
        process.title = originalTitle;
      }

      // Clean up require.cache
      delete require.cache[serverPath];
      delete require.cache[path.resolve(__dirname, "../../custom-server.js")];

      // Remove dummy server.js
      try {
        fs.unlinkSync(serverPath);
      } catch {}
    }
  });

  it("dispatches a mutating request once when proof lookup or the handler rejects", async () => {
    const fakeHttp = {
      createServer: vi.fn((handler) => ({ handler })),
    };
    const verifyPeerOwner = vi.fn(async () => { throw new Error("lookup failed"); });
    const handler = vi.fn(async () => { throw new Error("application failed"); });
    const { installRequestWrapper } = require("../../custom-server.js");
    installRequestWrapper({ httpModule: fakeHttp, secret: "a".repeat(64), verifyPeerOwner });
    const server = fakeHttp.createServer(handler);
    const response = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, writableEnded: false };
    server.handler({
      method: "POST",
      url: "/api/cli-tools/antigravity-mitm",
      headers: {},
      socket: { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", remotePort: 45000 },
    }, response);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledOnce();
    expect(response.end).toHaveBeenCalledWith("Internal Server Error");
  });

  it("marks forwarded loopback clients as proxied while replacing the peer token", async () => {
    const fakeHttp = {
      createServer: vi.fn((handler) => ({ handler })),
    };
    const handler = vi.fn();
    const { installRequestWrapper } = require("../../custom-server.js");
    installRequestWrapper({
      httpModule: fakeHttp,
      secret: "a".repeat(64),
      peerToken: "trusted-peer-token",
      verifyPeerOwner: vi.fn(async () => false),
    });
    const server = fakeHttp.createServer(handler);
    const request = {
      method: "GET",
      url: "/api/v1/models",
      headers: {
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "127.0.0.1",
        "x-9r-peer-token": "forged-token",
      },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const response = { setHeader: vi.fn() };

    server.handler(request, response);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledWith(request, response);
    expect(request.headers["x-9r-real-ip"]).toBe("127.0.0.1");
    expect(request.headers["x-9r-via-proxy"]).toBe("1");
    expect(request.headers["x-9r-peer-token"]).toBe("trusted-peer-token");
    expect(request.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("uses the nearest forwarded hop instead of spoofable forwarded values", async () => {
    const fakeHttp = { createServer: vi.fn((handler) => ({ handler })) };
    const handler = vi.fn();
    const { installRequestWrapper } = require("../../custom-server.js");
    installRequestWrapper({
      httpModule: fakeHttp,
      secret: "a".repeat(64),
      peerToken: "trusted-peer-token",
      verifyPeerOwner: vi.fn(async () => false),
    });
    const server = fakeHttp.createServer(handler);
    const ipFor = async (xRealIp, xff) => {
      const req = {
        method: "GET",
        url: "/api/auth/login",
        headers: { "x-real-ip": xRealIp, "x-forwarded-for": xff },
        socket: { remoteAddress: "127.0.0.1" },
      };
      server.handler(req, { setHeader: vi.fn() });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getClientIp({ headers: new Headers(req.headers) });
    };

    expect(await ipFor("198.51.100.1", "198.51.100.1, 203.0.113.9")).toBe("203.0.113.9");
    expect(await ipFor("198.51.100.2", "198.51.100.2, 203.0.113.9")).toBe("203.0.113.9");
  });
});
