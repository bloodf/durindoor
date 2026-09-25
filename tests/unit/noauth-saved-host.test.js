import { beforeEach, describe, expect, it, vi } from "vitest";



const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeyByKey: mocks.getApiKeyByKey,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

/**
 * Local Whisper and self-hosted Firecrawl keep what a request needs on the
 * connection row (server URL; Firecrawl key and headers), so an unrestricted handler request must use the saved row
 * instead of the provider's default host.
 */
const { getNoAuthProviderCredentials } = await import("../../src/sse/services/auth.js");

describe("keyless providers with a saved server URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaReservationPressure.mockResolvedValue(null);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it.each([
    ["local-whisper", "http://192.168.1.20:11500"]
  ])("%s uses the saved connection's host for an unrestricted request", async (provider, baseUrl) => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", provider, isActive: true, providerSpecificData: { baseUrl } }]);
    const credentials = await getNoAuthProviderCredentials(provider);
    expect(credentials.connectionId).toBe("c1");
    expect(credentials.providerSpecificData.baseUrl).toBe(baseUrl);
  });

  it("never falls back to the default host when the saved row is unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "c1",
      provider: "local-whisper",
      isActive: true,
      providerSpecificData: { baseUrl: "http://192.168.1.20:11500" }
    }]);
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("local-whisper", new Set(["c1"]), null, { noAuthPath: true });
    expect(credentials).toBeNull();
  });

  it("keeps the default host when no connection is saved", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    expect(await getNoAuthProviderCredentials("local-whisper")).toEqual({});
  });

  it("sends a saved self-hosted Firecrawl row's key and headers for an unrestricted request", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "c1",
      provider: "firecrawl_custom",
      isActive: true,
      apiKey: "fc-secret",
      firecrawlHeaders: { "CF-Access-Client-Id": "abc" },
      providerSpecificData: { baseUrl: "http://192.168.1.30:3002" }
    }]);
    const credentials = await getNoAuthProviderCredentials("firecrawl_custom");
    expect(credentials.connectionId).toBe("c1");
    expect(credentials.apiKey).toBe("fc-secret");
    expect(credentials.firecrawlHeaders).toEqual({ "CF-Access-Client-Id": "abc" });
  });

  it("still ignores saved rows for other keyless providers", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", provider: "edge-tts", isActive: true, providerSpecificData: {} }]);
    expect(await getNoAuthProviderCredentials("edge-tts")).toEqual({});
  });
});
