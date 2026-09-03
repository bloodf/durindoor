import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));
vi.mock("@/models", () => ({ getProviderNodeById: mocks.getProviderNodeById }));

const endpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const originalFetch = global.fetch;

function connection() {
  return {
    id: "bigmodel-connection",
    provider: "bigmodel",
    authType: "apikey",
    apiKey: "bigmodel-key",
    providerSpecificData: {},
  };
}

describe("standard BigModel provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    mocks.getProviderConnectionById.mockResolvedValue(connection());
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  afterEach(() => { global.fetch = originalFetch; });

  it("is a distinct default OpenAI Bearer registry provider with its static catalog", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    const { getProviderModels } = await import("../../open-sse/config/providerModels.js");
    const { default: bigmodelLeaf } = await import("../../open-sse/providers/registry/bigmodel.js");
    const { hasSpecializedExecutor } = await import("../../open-sse/executors/index.js");
    const bigmodel = PROVIDERS.bigmodel;

    expect(bigmodel).toBeDefined();
    expect(bigmodel).not.toBe(PROVIDERS["glm-cn"]);
    expect(bigmodel).not.toBe(PROVIDERS.zai);
    expect(bigmodel.format).toBe("openai");
    expect(bigmodel.baseUrl).toBe(endpoint);
    expect(bigmodel.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });

    // No custom executor, resolver, live catalog fetcher, or icon asset.
    expect(bigmodelLeaf.transport.executor).toBeUndefined();
    expect(bigmodelLeaf.transport.resolver).toBeUndefined();
    expect(bigmodelLeaf.modelsFetcher).toBeUndefined();
    expect(bigmodelLeaf.display.iconUrl).toBeUndefined();
    expect(hasSpecializedExecutor("bigmodel")).toBe(false);

    expect(getProviderModels("bigmodel").map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "glm-5.3", name: "GLM 5.3" },
      { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    ]);
  });

  it("exposes documented BigModel capabilities with published 131072-token output on both models", async () => {
    const { getCapabilitiesForModel, resolveModelLimits } = await import("../../open-sse/providers/capabilities.js");

    expect(getCapabilitiesForModel("bigmodel", "glm-5.3")).toMatchObject({
      vision: false,
      reasoning: true,
      thinkingFormat: "openai-low-high-max",
      thinkingCanDisable: false,
      contextWindow: 1_000_000,
      maxOutput: 131_072,
    });
    expect(getCapabilitiesForModel("bigmodel", "glm-5.3-flash")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai-low-high-max",
      thinkingCanDisable: false,
      contextWindow: 1_000_000,
      maxOutput: 131_072,
    });
    // Published limit, not the generic 64000 default floor.
    expect(resolveModelLimits("bigmodel", "glm-5.3", null, null, null, true).maxOutput).toBe(131_072);
    expect(resolveModelLimits("bigmodel", "glm-5.3-flash", null, null, null, true).maxOutput).toBe(131_072);
  });

  it("exposes the always-on low/high/max thinking levels for both BigModel models", async () => {
    const { getThinkingLevels } = await import("../../open-sse/providers/thinkingLevels.js");
    expect(getThinkingLevels("bigmodel", "glm-5.3")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("bigmodel", "glm-5.3-flash")).toEqual(["low", "high", "max"]);
  });

  it("maps thinking effort onto BigModel's low/high/max wire enum and clamps invalid levels", async () => {
    const { applyThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
    const apply = (model, body) => {
      const b = JSON.parse(JSON.stringify(body));
      applyThinking("openai-low-high-max", model, b, "bigmodel");
      return b;
    };

    expect(apply("glm-5.3", { reasoning_effort: "max" }).reasoning_effort).toBe("max");
    expect(apply("glm-5.3", { reasoning_effort: "xhigh" }).reasoning_effort).toBe("max");
    expect(apply("glm-5.3", { reasoning_effort: "ultra" }).reasoning_effort).toBe("max");
    expect(apply("glm-5.3", { reasoning_effort: "low" }).reasoning_effort).toBe("low");
    expect(apply("glm-5.3", { reasoning_effort: "minimal" }).reasoning_effort).toBe("low");
    expect(apply("glm-5.3", { reasoning_effort: "medium" }).reasoning_effort).toBe("high");
    // Flash keeps its reasoning field — not stripped as a vision-only model.
    expect(apply("glm-5.3-flash", { reasoning_effort: "high" }).reasoning_effort).toBe("high");
  });

  it("uses registry standard endpoint and Bearer auth for validation", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const result = await (await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "bigmodel", apiKey: "bigmodel-key" }),
    }))).json();

    expect(result).toEqual({ valid: true, error: null });
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(String(url)).not.toContain("/api/coding/");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer bigmodel-key");
    const body = JSON.parse(options.body);
    expect(body.messages).toEqual([{ role: "user", content: "test" }]);
    expect(["glm-5.3", "glm-5.3-flash"]).toContain(body.model);
  });

  it("uses registry standard endpoint and Bearer auth for dashboard connection testing", async () => {
    proxyAwareFetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe(endpoint);
      expect(String(url)).not.toContain("/api/coding/");
      expect(String(url)).not.toContain("/models");
      expect(options.headers.Authorization).toBe("Bearer bigmodel-key");
      expect(options.method).toBe("POST");
      return new Response("{}", { status: 200 });
    });
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    const result = await testSingleConnection("bigmodel-connection");
    expect(result.valid).toBe(true);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
