import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { __setProviderTestFetchForTesting } from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = global.fetch;

describe("testApiKeyConnection /v1 normalization for Anthropic-compatible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    __setProviderTestFetchForTesting(null);
  });

  it("strips trailing /v1 before appending /v1/messages", async () => {
    const calls = [];
    const restore = __setProviderTestFetchForTesting(async (url) => {
      calls.push(String(url));
      return { status: 200 };
    });

    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-ac-norm",
      provider: "anthropic-compatible-norm",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "https://api.example.com/v1" },
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-ac-norm");

    expect(result.valid).toBe(true);
    expect(calls[0]).toBe("https://api.example.com/v1/messages");
    restore();
  });

  it("strips /messages then /v1 to avoid double path", async () => {
    const calls = [];
    const restore = __setProviderTestFetchForTesting(async (url) => {
      calls.push(String(url));
      return { status: 200 };
    });

    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-ac-msg",
      provider: "anthropic-compatible-msg",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "https://api.example.com/v1/messages" },
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    await testSingleConnection("conn-ac-msg");

    expect(calls[0]).toBe("https://api.example.com/v1/messages");
    restore();
  });
});

export {};
