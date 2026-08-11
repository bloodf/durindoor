import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));

const originalFetch = global.fetch;

describe("Kimi API-key connection health check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes Moonshot platform with a Bearer API key", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kimi",
      provider: "kimi",
      authType: "apikey",
      apiKey: "moonshot-key",
      providerSpecificData: {},
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://api.moonshot.cn/v1/chat/completions");
      expect(options.headers.Authorization).toBe("Bearer moonshot-key");
      expect(options.headers["x-api-key"]).toBeUndefined();
      return new Response("{}", { status: 200 });
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-kimi");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });
});
