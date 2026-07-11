import { beforeEach, describe, it, expect, vi } from "vitest";

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

vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: vi.fn(),
}));

vi.mock("open-sse/services/kimchiModels.js", () => ({
  resolveKimchiModels: vi.fn(),
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
}));

import { getProviderConnectionById } from "@/models";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { refreshGoogleToken } from "@/sse/services/tokenRefresh";
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds Codex model discovery to the selected account", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "codex-1", provider: "codex", accessToken: "token",
      providerSpecificData: { workspaceId: " account-1 " },
    });
    const proxyOptions = { disableEnvProxy: true, strictProxy: false };
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    routedFetch.mockResolvedValue({
      ok: true, json: async () => ({ models: [] }),
    });

    const res = await GET(getRequest("codex-1"), { params: getParams("codex-1") });

    expect(res.status).toBe(200);
    expect(routedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/backend-api/codex/models"),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "account-1" }),
      }),
      proxyOptions,
    );
  });

  it("fetches dynamic models for providers with a registry modelsFetcher", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "qiniu",
      apiKey: "qk",
    });

    const proxyOptions = { disableEnvProxy: false, strictProxy: false };
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    routedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qiniu-live", name: "Qiniu Live" }] }),
    });

    const res = await GET(getRequest("conn-1"), { params: getParams("conn-1") });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.provider).toBe("qiniu");
    expect(data.connectionId).toBe("conn-1");
    expect(data.models).toEqual([{ id: "qiniu-live", name: "Qiniu Live" }]);
    expect(routedFetch).toHaveBeenCalledWith(
      "https://api.qnaigc.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer qk" }),
      }),
      proxyOptions,
    );
  });

  it("passes the resolved strict route into Kiro catalog discovery", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.internal:8080",
      strictProxy: true,
      disableEnvProxy: true,
    };
    getProviderConnectionById.mockResolvedValue({
      id: "kiro-1",
      provider: "kiro",
      accessToken: "kiro-token",
      providerSpecificData: {
        oauthProxy: { mode: "strict-pool", poolId: "pool-1" },
      },
    });
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    resolveKiroModels.mockResolvedValue({
      models: [{ id: "claude-test", name: "Claude Test" }],
    });

    const res = await GET(getRequest("kiro-1"), { params: getParams("kiro-1") });

    expect(res.status).toBe(200);
    expect(resolveKiroModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "kiro-token" }),
      expect.objectContaining({ proxyOptions })
    );
  });

  it("passes the resolved direct route into Copilot catalog discovery", async () => {
    const proxyOptions = {
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      strictProxy: false,
      disableEnvProxy: true,
    };
    getProviderConnectionById.mockResolvedValue({
      id: "github-1",
      provider: "github",
      accessToken: "github-token",
      providerSpecificData: {
        oauthProxy: { mode: "direct" },
        copilotToken: "copilot-token",
      },
    });
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    resolveCopilotModels.mockResolvedValue({
      models: [{ id: "gpt-test", name: "GPT Test" }],
    });

    const res = await GET(getRequest("github-1"), { params: getParams("github-1") });

    expect(res.status).toBe(200);
    expect(resolveCopilotModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "github-token" }),
      expect.objectContaining({ proxyOptions, forceRefresh: true })
    );
  });

  it("keeps OAuth config resolver fetch, refresh, and retry on one route", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.internal:8080",
      strictProxy: true,
      disableEnvProxy: true,
    };
    getProviderConnectionById.mockResolvedValue({
      id: "gemini-cli-1",
      provider: "gemini-cli",
      accessToken: "google-old",
      refreshToken: "google-refresh",
      providerSpecificData: {
        oauthProxy: { mode: "strict-pool", poolId: "pool-1" },
      },
    });
    resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
    routedFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ id: "gemini-test" }] }),
      });
    refreshGoogleToken.mockResolvedValue({ accessToken: "google-new" });

    const res = await GET(getRequest("gemini-cli-1"), {
      params: getParams("gemini-cli-1"),
    });

    expect(res.status).toBe(200);
    expect(refreshGoogleToken).toHaveBeenCalledWith(
      "google-refresh",
      process.env.GEMINI_CLIENT_ID,
      process.env.GEMINI_CLIENT_SECRET,
      proxyOptions
    );
    expect(routedFetch).toHaveBeenCalledTimes(2);
    expect(routedFetch.mock.calls[0][2]).toBe(proxyOptions);
    expect(routedFetch.mock.calls[1][2]).toBe(proxyOptions);
    expect(routedFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer google-new");
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
