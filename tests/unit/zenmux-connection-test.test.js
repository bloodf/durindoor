/**
 * Unit tests for saved ZenMux Free connection health checks.
 *
 * The dashboard `/api/providers/[id]/test` path must probe cookie-backed
 * ZenMux connections with the same proxy-aware request path used by chat.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(() => Promise.resolve(new Response("", { status: 400 }))),
}));

describe("zenmux-free saved connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-zmf",
      provider: "zenmux-free",
      authType: "cookie",
      apiKey: "foo=1; ctoken=tok123; bar=2",
      defaultModel: "deepseek/deepseek-chat",
      providerSpecificData: { connectionProxyEnabled: true },
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.local:8080",
      connectionNoProxy: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  it("probes ZenMux cookies through the configured connection proxy", async () => {
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    const result = await testSingleConnection("conn-zmf");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://zenmux.ai/api/anthropic/v1/messages?ctoken=tok123"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Cookie: "foo=1; ctoken=tok123; bar=2",
          "anthropic-version": "2023-06-01",
        }),
      }),
      expect.objectContaining({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.local:8080",
      }),
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-zmf", expect.objectContaining({
      testStatus: "active",
      lastError: null,
    }));
  });

  it("redacts proxy validation errors before returning or persisting them", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://alice:proxy-secret@proxy.local:8080",
      connectionNoProxy: "",
    });
    mocks.testProxyUrl.mockResolvedValue({
      ok: false,
      status: 500,
      error: "connect http://alice:proxy-secret@proxy.local:8080?token=query-secret",
    });
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    const result = await testSingleConnection("conn-zmf");

    expect(result.error).toContain("[redacted]");
    expect(result.error).not.toContain("proxy-secret");
    expect(result.error).not.toContain("query-secret");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-zmf", expect.objectContaining({
      testStatus: "error",
      lastError: result.error,
    }));
  });
});
