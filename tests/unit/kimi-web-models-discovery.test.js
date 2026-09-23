import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/shared/constants/providers", async () => {
  const actual = await vi.importActual("@/shared/constants/providers");
  return { ...actual };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function getRequest(connectionId, search = "") {
  return new Request(
    `http://localhost/api/providers/${connectionId}/models${search}`,
    { method: "GET" }
  );
}

function getParams(connectionId) {
  return Promise.resolve({ id: connectionId });
}

describe("GET /api/providers/[id]/models - kimi-web discovery", () => {
  it("POSTs to Kimi with bearer + connect-protocol-version and filters to supported models", async () => {
    const jwt = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

    getProviderConnectionById.mockResolvedValue({
      id: "conn-kimi-web",
      provider: "kimi-web",
      apiKey: `_ga=ignored; theme=dark; kimi-auth=${jwt}; __cf_bm=ignored`,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        availableModels: [
          { key: "k3", displayName: "K3", reasoningEffortOptions: [{ effort: "REASONING_EFFORT_LOW" }] },
          { key: "k3-agent-ultra", displayName: "K3 Swarm" },
          { key: "k2d6", displayName: "K2.6 Instant" },
          { key: "k2d6-thinking", displayName: "K2.6 Thinking", thinking: true },
          { key: "k2d6-agent", displayName: "K2.6 Agent" },
          { key: "k2d6-agent-ultra", displayName: "K2.6 Agent Swarm" },
          { key: "kimi-default", displayName: "Kimi Default" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("conn-kimi-web", "?refresh=true"), {
      params: getParams("conn-kimi-web"),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.models.map((m) => m.id)).toEqual(["k3", "k2d6", "k2d6-thinking"]);
    expect(data.models.find((m) => m.id === "k3")?.supportsReasoning).toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.kimi.com/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          Authorization: `Bearer ${jwt}`,
          "connect-protocol-version": "1",
        }),
      })
    );
  });

  it("discovers against www.kimi.ai for a session copied there", async () => {
    const access = "eyJhbGciOiJIUzUxMiJ9.eyJhaSI6MX0.signature";
    getProviderConnectionById.mockResolvedValue({
      id: "conn-kimi-ai",
      provider: "kimi-web",
      apiKey: JSON.stringify({ access_token: access, refresh_token: "eyJ.r.t", origin: "https://www.kimi.ai" }),
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ availableModels: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("conn-kimi-ai", "?refresh=true"), { params: getParams("conn-kimi-ai") });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.kimi.ai/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${access}`, Origin: "https://www.kimi.ai" }),
      })
    );
  });
});
