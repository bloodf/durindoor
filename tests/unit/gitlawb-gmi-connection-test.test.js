import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gitlawb GMI is a baseUrl-only registry apikey provider (no validateUrl). Before this
// fix the generic default branch in testApiKeyConnection required validateUrl and
// returned "Provider test not supported", so the per-connection Test button failed.
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

describe("baseUrl-only API-key provider connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-glb",
      provider: "gitlawb-gmi",
      apiKey: "glb-test-key",
      authType: "apikey",
      priority: 1,
      providerSpecificData: {},
    });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes gitlawb-gmi baseUrl when no validateUrl exists", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://opengateway.gitlawb.com/v1/chat/completions");
      expect(options.headers.Authorization).toBe("Bearer glb-test-key");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body).model).toBe("XiaomiMiMo/MiMo-V2.5-Pro");
      return new Response("", { status: 200 });
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-glb");

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
