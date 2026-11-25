import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProxyPool: vi.fn(async (input) => ({ id: "pool-1", ...input })),
  getProxyPoolById: vi.fn(),
  isOperatorRequest: vi.fn(async () => true),
}));

vi.mock("@/lib/localDb", () => ({
  createProxyPool: mocks.createProxyPool,
  getProxyPoolById: mocks.getProxyPoolById,
  getProxyPools: vi.fn(),
  getProviderConnections: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

import { POST } from "../../src/app/api/proxy-pools/route.js";
import { isRelayProxyType, RELAY_PROXY_TYPES } from "../../src/app/api/proxy-pools/relayUrlGuard.js";
import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("upstream #1801 Netlify relay and TPS probe", () => {
  it("does not add a Netlify relay deployer", () => {
    expect(existsSync(new URL("../../src/app/api/proxy-pools/netlify-deploy/route.js", import.meta.url))).toBe(false);
    expect(RELAY_PROXY_TYPES.has("netlify")).toBe(false);
    expect(isRelayProxyType("netlify")).toBe(false);
    expect([...RELAY_PROXY_TYPES].sort()).toEqual(["cloudflare", "vercel"]);
  });

  it("stores a netlify pool type as a plain HTTP proxy, not an edge relay", async () => {
    const response = await POST(new Request("http://127.0.0.1/api/proxy-pools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "edge",
        proxyUrl: "https://site.example.test/.netlify/functions/relay",
        type: "netlify",
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createProxyPool).toHaveBeenCalledWith(expect.objectContaining({
      type: "http",
      proxyUrl: "https://site.example.test/.netlify/functions/relay",
    }));

    mocks.getProxyPoolById.mockResolvedValue({
      id: "netlify-1",
      isActive: true,
      type: "netlify",
      proxyUrl: "https://site.example.test/.netlify/functions/relay",
      relaySecret: "a".repeat(64),
    });
    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "netlify-1" });
    expect(resolved.source).toBe("pool");
    expect(resolved.connectionProxyEnabled).toBe(true);
    expect(resolved.connectionProxyUrl).toBe("https://site.example.test/.netlify/functions/relay");
    expect(resolved.vercelRelayUrl || "").toBe("");
    expect(resolved.relaySecret).toBe("");
  });

  it("reports model latency without a TPS or estimated-token field", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "hello world from the probe" }, finish_reason: "stop" }],
      usage: {
        completion_tokens: 0,
        completion_tokens_details: { reasoning_tokens: 40 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await pingModelByKind("openai/gpt-test", "llm", "http://127.0.0.1:9");

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(Object.keys(result).sort()).toEqual(["error", "latencyMs", "ok", "status"]);
    expect(result).not.toHaveProperty("tps");
    expect(result).not.toHaveProperty("tokensPerSecond");
  });
});
