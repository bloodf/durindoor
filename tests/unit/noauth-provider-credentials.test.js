import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

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

const NO_AUTH_PROVIDERS = ["auggie", "chipotle", "duckduckgo-web", "mimocode", "opencode", "pollinations", "theoldllm"];
let restoreFetch;

function expectNoPublicAuthorization(headers) {
  expect(headers.Authorization).toBeUndefined();
  expect(headers.authorization).toBeUndefined();
  expect(JSON.stringify(headers).toLowerCase()).not.toContain("public");
}

describe("no-auth provider credential selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaReservationPressure.mockResolvedValue(null);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it.each(NO_AUTH_PROVIDERS)("returns an ephemeral no-auth credential without DB writes for %s", async (provider) => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials(provider);

    expect(credentials).toMatchObject({ id: "noauth", connectionId: "noauth", authType: "none" });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it.each(["auggie", "chipotle", "mimocode", "opencode", "pollinations", "theoldllm"])("does not send a synthetic credential as public authorization for %s", async (provider) => {
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const credentials = await getProviderCredentials(provider);

    expectNoPublicAuthorization(getExecutor(provider).buildHeaders(credentials));
  });

  it("keeps OpenCode no-auth headers anonymous and saved credentials authenticated", async () => {
    const executor = getExecutor("opencode");
    const noAuthHeaders = executor.buildHeaders({
      id: "noauth",
      connectionId: "noauth",
      accessToken: "public",
      authType: "none",
    });
    const savedHeaders = executor.buildHeaders({
      id: "opencode-saved",
      connectionId: "opencode-saved",
      apiKey: "sk-real-key",
    });

    expectNoPublicAuthorization(noAuthHeaders);
    expect(noAuthHeaders["User-Agent"]).toBe("opencode");
    expect(noAuthHeaders["x-opencode-session"]).toMatch(/^ses_[a-f0-9]{32}$/);
    expect(savedHeaders.Authorization).toBe("Bearer sk-real-key");
  });

  it("does not send authorization or public placeholders in either DuckDuckGo request", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const outboundFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { "x-vqd-4": "vqd" } }))
      .mockResolvedValueOnce(new Response("data: {\"message\":\"ok\"}\n\ndata: [DONE]\n\n"));
    restoreFetch = __setOriginalFetchForTesting(outboundFetch);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("duckduckgo-web");
    const result = await getExecutor("duckduckgo-web").execute({
      model: "gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
    });

    expect(credentials).toMatchObject({ id: "noauth", connectionId: "noauth", authType: "none" });
    expect(result.response.ok).toBe(true);
    expect(outboundFetch).toHaveBeenCalledTimes(2);
    for (const [, request] of outboundFetch.mock.calls) {
      expectNoPublicAuthorization(request.headers);
    }
  });

  it("keeps saved ordinary-provider credentials distinct from the no-auth fallback", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "openai-connection",
      provider: "openai",
      apiKey: "sk-real-key",
      isActive: true,
    }]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("openai");

    expect(credentials).toMatchObject({ connectionId: "openai-connection", apiKey: "sk-real-key" });
    expect(credentials.authType).not.toBe("none");
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not invent a no-auth credential for an ordinary provider with no saved key", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    await expect(getProviderCredentials("openai")).resolves.toBeNull();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
