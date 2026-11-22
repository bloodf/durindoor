// Port of decolua/9router#5297 (inbound keep-alive part): Node's 5s default
// keepAliveTimeout resets idle pooled client sockets (ECONNRESET). The wrapped
// http.createServer must raise keepAliveTimeout, with headersTimeout above it.
import { createRequire } from "module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

function fakeServer() {
  return { on: vi.fn(), listeners: vi.fn(() => []), removeAllListeners: vi.fn() };
}

describe("custom-server inbound keep-alive (#5297)", () => {
  it("raises keepAliveTimeout and keeps headersTimeout above it on real http servers", () => {
    const server = fakeServer();
    const fakeHttp = { createServer: vi.fn(() => server) };
    const { installRequestWrapper } = require("../../custom-server.js");
    installRequestWrapper({ httpModule: fakeHttp, secret: "a".repeat(64), verifyPeerOwner: vi.fn(async () => false) });
    const created = fakeHttp.createServer(vi.fn());
    expect(created).toBe(server);
    expect(server.keepAliveTimeout).toBe(72000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it("leaves handler-shaped shims untouched", () => {
    const fakeHttp = { createServer: vi.fn((handler) => ({ handler })) };
    const { installRequestWrapper } = require("../../custom-server.js");
    installRequestWrapper({ httpModule: fakeHttp, secret: "a".repeat(64), verifyPeerOwner: vi.fn(async () => false) });
    const shim = fakeHttp.createServer(vi.fn());
    expect(shim).not.toHaveProperty("keepAliveTimeout");
  });
});
