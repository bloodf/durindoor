import { afterEach, describe, expect, it, vi } from "vitest";
import freeRegistry from "../../open-sse/providers/registry/zenmux-free.js";
import paidRegistry from "../../open-sse/providers/registry/zenmux.js";
import { getExecutor } from "../../open-sse/executors/index.js";

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []), getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []), getProxyPoolById: vi.fn(), getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "fake-id", ...data })),
  updateProviderConnection: vi.fn(), deleteProviderConnection: vi.fn(),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

const { POST } = await import("@/app/api/providers/route.js");
const models = await import("@/lib/localDb");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; vi.clearAllMocks(); });

const request = (provider, apiKey) => new Request("http://localhost/api/providers", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider, name: provider, apiKey }),
});

describe("ZenMux supplied-session compatibility", () => {
  it("stores a supplied free session separately from an API key without outbound sign-in", async () => {
    global.fetch = vi.fn(() => { throw new Error("unexpected outbound request"); });
    expect((await POST(request("zenmux-free", "ctoken=fake-session; other=fake"))).status).toBe(201);
    expect((await POST(request("zenmux", "fake-api-key"))).status).toBe(201);
    expect(models.createProviderConnection.mock.calls[0][0]).toMatchObject({ provider: "zenmux-free", authType: "cookie", apiKey: "ctoken=fake-session; other=fake" });
    expect(models.createProviderConnection.mock.calls[1][0]).toMatchObject({ provider: "zenmux", authType: "apikey", apiKey: "fake-api-key" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the pinned free catalog separate from the API-key catalog", () => {
    expect(freeRegistry.models.map(({ id }) => id)).toEqual([
      "deepseek/deepseek-chat", "deepseek/deepseek-reasoner", "deepseek/deepseek-v4-pro",
      "kuaishou/kat-coder-pro-v1-free", "z-ai/glm-4.7-flash-free", "stepfun/step-3.5-flash-free",
      "inclusionai/ling-1t", "inclusionai/ling-mini-2.0", "inclusionai/ring-1t",
      "sapiens-ai/agnes-1.5-lite", "sapiens-ai/agnes-1.5-pro",
    ]);
    expect(paidRegistry.transport.baseUrl).toBe("https://zenmux.ai/api/v1/chat/completions");
    expect(getExecutor("zenmux")).not.toBe(getExecutor("zenmux-free"));
  });

  it.each([[401, 401], [403, 401], [402, 402], [429, 429]])("makes one session request and preserves expiry/quota status %i", async (upstream, expected) => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("refused", { status: upstream }));
    const result = await getExecutor("zenmux-free").execute({
      credentials: { apiKey: "other=fake; ctoken=fake-session" },
      body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hello" }] }, stream: false,
    });
    expect(result.response.status).toBe(expected);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(new URL(url).searchParams.get("ctoken")).toBe("fake-session");
    expect(options.headers.Cookie).toBe("other=fake; ctoken=fake-session");
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).toMatchObject({ model: "deepseek/deepseek-chat", stream: true });
    expect(JSON.stringify(result)).not.toContain("fake-session");
  });
});
