import { createRequire } from "module";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false }) }));
vi.mock("@/sse/services/auth.js", () => ({ resolveClientApiKey: mocks.resolve }));

const { GET } = await import("@/app/api/v1/realtime/auth/route.js");
const { probeApiKey } = createRequire(import.meta.url)("../../src/shared/utils/wsHandshake.js");

describe("realtime peer admission", () => {
  it.each([
    [true, null, null, false],
    [true, "valid", null, true],
    [true, "invalid", null, false],
    [true, null, "cli", true],
    [false, null, null, true],
  ])("applies the remote key rule (remote=%s, key=%s, cli=%s)", async (remotePeer, key, cliToken, allowed) => {
    const previous = process.env.NINEROUTER_PEER_TOKEN;
    process.env.NINEROUTER_PEER_TOKEN = "test-peer-token";
    mocks.resolve.mockImplementation(async (request, { required }) => ({
      auth: { ok: request.headers.get("authorization") === "Bearer valid" || request.headers.get("x-9r-cli-token") === "cli" || (!required && !request.headers.has("authorization")) },
    }));
    try {
      const result = await probeApiKey({ key, cliToken, remotePeer, authUrl: "http://127.0.0.1/api/v1/realtime/auth", fetchFn: async (url, options) => {
        // Simulate the HTTP wrapper's trusted peer stamp on the loopback hop.
        const headers = new Headers(options.headers);
        const forwarded = headers.get("x-forwarded-for");
        headers.delete("x-forwarded-for");
        headers.set("x-9r-peer-token", "test-peer-token");
        headers.set("x-9r-real-ip", forwarded || "127.0.0.1");
        if (forwarded) headers.set("x-9r-via-proxy", "1");
        return GET(new Request(url, { headers }));
      } });
      expect(result.ok).toBe(allowed);
      expect(mocks.resolve.mock.lastCall[1].required).toBe(remotePeer);
    } finally {
      if (previous === undefined) delete process.env.NINEROUTER_PEER_TOKEN;
      else process.env.NINEROUTER_PEER_TOKEN = previous;
    }
  });
});
