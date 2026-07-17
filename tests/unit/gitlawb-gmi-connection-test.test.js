import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gitlawb GMI validates with a minimal chat request rather than a GET-only
// catalog probe. The source `/v1/gmi-cloud` prefix must survive DurinDoor's
// full-endpoint registry convention.
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
      expect(String(url)).toBe("https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions");
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

  it("keeps runtime and model discovery on the source gmi-cloud prefix", async () => {
    const [{ PROVIDERS }, { APIKEY_PROVIDERS }, { DefaultExecutor }] = await Promise.all([
      import("../../open-sse/config/providers.js"),
      import("../../src/shared/constants/providers.js"),
      import("../../open-sse/executors/default.js"),
    ]);

    expect(PROVIDERS["gitlawb-gmi"].baseUrl).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
    );
    expect(PROVIDERS["gitlawb-gmi"].modelsUrl).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
    );
    expect(APIKEY_PROVIDERS["gitlawb-gmi"].modelsFetcher).toEqual({
      url: "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
      type: "openai",
    });
    expect(new DefaultExecutor("gitlawb-gmi").buildUrl("unused", true, 0, {})).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
    );
  });

  it.each([
    [200, true, null],
    [400, true, null],
    [422, true, null],
    [429, true, null],
    [401, false, "Invalid API key"],
    [403, false, "Invalid API key"],
    [404, false, "Provider validation endpoint not found"],
    [500, false, "Provider unavailable - try again later"],
  ])("classifies source chat-probe status %i as valid=%s", async (status, valid, error) => {
    const { probeRegistryProvider } = await import(
      "../../src/app/api/providers/providerProbe.js"
    );
    const result = await probeRegistryProvider(
      "gitlawb-gmi",
      "glb-test-key",
      async () => new Response("", { status }),
    );
    expect(result).toEqual({ valid, status, ...(error ? { error } : {}) });
    expect(JSON.stringify(result)).not.toContain("glb-test-key");
  });

  it("reports network failures as unavailable without leaking credentials", async () => {
    const { probeRegistryProvider } = await import(
      "../../src/app/api/providers/providerProbe.js"
    );
    const result = await probeRegistryProvider(
      "gitlawb-gmi",
      "glb-test-key",
      async () => {
        throw new Error("network failure for glb-test-key");
      },
    );

    expect(result).toEqual({
      valid: false,
      status: null,
      error: "Provider unavailable - network request failed",
    });
    expect(JSON.stringify(result)).not.toContain("glb-test-key");
  });

  it.each([
    [401, "Invalid API key"],
    [404, "Provider validation endpoint not found"],
    [500, "Provider unavailable - try again later"],
  ])("propagates status %i without mislabeling the failure", async (status, error) => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status }));

    const [{ testSingleConnection }, { POST }] = await Promise.all([
      import("../../src/app/api/providers/[id]/test/testUtils.js"),
      import("../../src/app/api/providers/validate/route.js"),
    ]);

    const connectionResult = await testSingleConnection("conn-glb");
    expect(connectionResult).toMatchObject({ valid: false, error });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-glb",
      expect.objectContaining({ testStatus: "error", lastError: error }),
    );

    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "gitlawb-gmi", apiKey: "glb-test-key" }),
    }));
    expect(await response.json()).toEqual({ valid: false, error });
  });
});
