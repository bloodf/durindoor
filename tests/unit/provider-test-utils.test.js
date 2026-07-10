import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the generic config-driven fallback and explicit
// cases added to testApiKeyConnection in src/app/api/providers/[id]/test/testUtils.js.
// Ensures new batch providers don't fall through to "Provider test not supported".

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

function makeConnection(provider, apiKey = "sk-test") {
  return {
    id: `conn-${provider}`,
    provider,
    authType: "apikey",
    apiKey,
    providerSpecificData: {},
  };
}

async function runTest(provider, fetchImpl) {
  mocks.getProviderConnectionById.mockResolvedValue(makeConnection(provider));
  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(fetchImpl);
  const { testSingleConnection } = await import(
    "../../src/app/api/providers/[id]/test/testUtils.js"
  );
  const result = await testSingleConnection(`conn-${provider}`);
  return { result, fetchSpy };
}

describe("testApiKeyConnection generic fallback (new batch providers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes ai21 via provider config-derived /models endpoint", async () => {
    const { result, fetchSpy } = await runTest("ai21", async (url, options) => {
      expect(String(url)).toBe("https://api.ai21.com/studio/v1/models");
      expect(options.headers.Authorization).toBe("Bearer sk-test");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("binds Codex OAuth validation to the selected account", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-codex",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      providerSpecificData: { workspaceId: " account-probe " },
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (_url, options) => {
      expect(options.headers["ChatGPT-Account-ID"]).toBe("account-probe");
      return new Response("{}", { status: 200 });
    });
    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );

    const result = await testSingleConnection("conn-codex");

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("probes api-airforce via registry validateUrl", async () => {
    const { result, fetchSpy } = await runTest("api-airforce", async (url, options) => {
      expect(String(url)).toBe("https://api.airforce/v1/models");
      expect(options.headers.Authorization).toBe("Bearer sk-test");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns invalid key when a fallback probe returns 401", async () => {
    const { result } = await runTest("aimlapi", async () =>
      new Response("", { status: 401 })
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("probes agentrouter with Claude Messages format and x-api-key auth", async () => {
    const { result, fetchSpy } = await runTest("agentrouter", async (url, options) => {
      expect(String(url)).toBe("https://agentrouter.org/v1/messages");
      expect(options.headers["x-api-key"]).toBe("sk-test");
      expect(options.headers["anthropic-version"]).toBe("2023-06-01");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("probes bailian-coding-plan with bearer auth and Claude Messages format", async () => {
    const { result, fetchSpy } = await runTest("bailian-coding-plan", async (url, options) => {
      expect(String(url)).toBe("https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1/messages");
      expect(options.headers.Authorization).toBe("Bearer sk-test");
      expect(options.headers["anthropic-version"]).toBe("2023-06-01");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("still reports unsupported for providers with no probe config and no api key", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-unknown",
      provider: "totally-unknown-provider",
      authType: "apikey",
      apiKey: "",
      providerSpecificData: {},
    });
    global.fetch = vi.fn(async () => new Response("", { status: 404 }));

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-unknown");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider test not supported");
  });
});
