import { beforeEach, describe, expect, it, vi } from "vitest";

const routedFetch = vi.hoisted(() => vi.fn());
const resolveConnectionProxyConfig = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: routedFetch,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(),
}));

vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: vi.fn(),
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
}));

import { getProviderConnectionById } from "@/models";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";

describe("GET /api/providers/[id]/models — registry fetcher uses connection credential and proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authorizes with the connection's API key and routes through the connection proxy", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "alibaba-1",
      provider: "alibaba",
      apiKey: "account-key",
      providerSpecificData: {
        proxy: { mode: "strict", url: "http://proxy.internal:8080" }
      }
    });
    const proxyOptions = { connectionProxyEnabled: true, strictProxy: true, disableEnvProxy: true };
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    routedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "account-preview" }] })
    });

    const req = new Request("http://localhost/api/providers/alibaba-1/models?refresh=1", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "alibaba-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.models).toEqual([{ id: "account-preview" }]);
    expect(routedFetch).toHaveBeenCalledWith(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer account-key" })
      }),
      proxyOptions
    );
  });
});
