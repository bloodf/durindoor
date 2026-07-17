import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Puter saved API-key connections hit the per-connection "Test" button, which
// routes through testApiKeyConnection's provider switch in testUtils.js. Prior
// to this fix there was no `case "puter"`, so every Puter connection test
// failed with "Provider test not supported" even for a valid key.
// See open-sse/providers/registry/puter.js (category: "apikey").
const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    vercelRelayUrl: "",
  }),
}));

const originalFetch = global.fetch;

describe("Puter connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-puter",
      provider: "puter",
      authType: "apikey",
      apiKey: "puter-token",
      providerSpecificData: {},
    });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes the Puter /models endpoint with bearer auth instead of failing as unsupported", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://api.puter.com/puterai/openai/v1/models");
      expect(options.headers.Authorization).toBe("Bearer puter-token");
      return new Response("{}", { status: 200 });
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-puter");

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports an invalid key when Puter rejects the probe", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 401 }));

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-puter");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });
});
