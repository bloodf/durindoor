import { describe, it, expect, vi } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/shared/constants/providers", async () => {
  const actual = await vi.importActual("@/shared/constants/providers");
  return {
    ...actual,
  };
});

vi.mock("@/lib/oauth/constants/oauth", () => ({
  GEMINI_CONFIG: {},
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(),
}));

vi.mock("open-sse/services/kimchiModels.js", () => ({
  resolveKimchiModels: vi.fn(),
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
}));

import { getProviderConnectionById } from "@/models";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";

function getRequest(connectionId) {
  return new Request(`http://localhost/api/providers/${connectionId}/models`, {
    method: "GET",
  });
}

function getParams(connectionId) {
  return Promise.resolve({ id: connectionId });
}

describe("GET /api/providers/[id]/models - registry modelsFetcher fallback", () => {
  it("fetches dynamic models for providers with a registry modelsFetcher", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "qiniu",
      apiKey: "qk",
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qiniu-live", name: "Qiniu Live" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("conn-1"), { params: getParams("conn-1") });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.provider).toBe("qiniu");
    expect(data.connectionId).toBe("conn-1");
    expect(data.models).toEqual([{ id: "qiniu-live", name: "Qiniu Live" }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.qnaigc.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer qk" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("returns 400 when provider has no config and no modelsFetcher", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-2",
      provider: "unknown-provider",
      apiKey: "k",
    });

    const res = await GET(getRequest("conn-2"), { params: getParams("conn-2") });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("does not support models listing");
  });
});
