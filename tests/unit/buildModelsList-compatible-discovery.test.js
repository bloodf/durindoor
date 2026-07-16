import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";

function stubConnections(connections) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue([]);
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

describe("buildModelsList — compatible provider discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches live models for UUID-suffixed openai-compatible providers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "llama-3.1-8b" }, { id: "qwen2.5-7b" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const providerId = "openai-compatible-chat-deadbeef-1234-5678-90ab-cdef01234567";
    stubConnections([
      {
        id: "conn-mlx",
        provider: providerId,
        apiKey: "sk-local",
        isActive: true,
        providerSpecificData: {
          baseUrl: "http://127.0.0.1:11434",
          prefix: "local",
        },
      },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((m) => m.id === "local/llama-3.1-8b")).toBe(true);
    expect(models.some((m) => m.id === "local/qwen2.5-7b")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-local" }),
      }),
    );
  });

  it("fetches live models for UUID-suffixed anthropic-compatible providers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "claude-3-opus" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const providerId = "anthropic-compatible-gateway-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
    stubConnections([
      {
        id: "conn-anthropic-compat",
        provider: providerId,
        apiKey: "sk-anthropic-compat",
        isActive: true,
        providerSpecificData: {
          baseUrl: "http://anthropic-proxy/v1",
          prefix: "proxy",
        },
      },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((m) => m.id === "proxy/claude-3-opus")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://anthropic-proxy/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-anthropic-compat",
          "x-api-key": "sk-anthropic-compat",
        }),
      }),
    );
  });
});
