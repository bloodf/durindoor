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

  it("rewrites anthropic-compatible message endpoints before discovery", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "claude-live" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const providerId = "anthropic-compatible-messages-55555555-5555-4555-8555-555555555555";
    stubConnections([{
      id: "conn-anthropic-messages",
      provider: providerId,
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "http://anthropic-proxy/v1/messages", prefix: "anth" },
    }]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((model) => model.id === "anth/claude-live")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("http://anthropic-proxy/v1/models", expect.any(Object));
  });
  it("treats configured custom models on a compatible node as an explicit whitelist", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "upstream-model" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const providerId = "openai-compatible-chat-deadbeef-1234-5678-90ab-cdef01234567";
    stubConnections([
      {
        id: "conn-dex",
        provider: providerId,
        apiKey: "sk-local",
        isActive: true,
        providerSpecificData: {
          baseUrl: "http://127.0.0.1:11434",
          prefix: "dex",
        },
      },
    ]);
    localDb.getCustomModels.mockResolvedValue([
      { id: "custom-one", providerAlias: "dex", kind: "llm" },
      { id: "custom-two", providerAlias: providerId, kind: "llm" },
    ]);

    const models = await buildModelsList([LLM_KIND]);

    expect(fetchSpy).not.toHaveBeenCalled();
    const dexIds = models.map((model) => model.id).filter((id) => id.startsWith("dex/"));
    expect(dexIds).toEqual(["dex/custom-one", "dex/custom-two"]);
    expect(models.some((model) => model.id === "dex/upstream-model")).toBe(false);
  });
  it("prefers cached live context limits over static catalog limits", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o", context_length: 262_144 }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const providerId = "openai-compatible-live-limits-11111111-1111-4111-8111-111111111111";
    stubConnections([{
      id: "conn-live-limits",
      provider: providerId,
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "http://live-limits/v1", prefix: "live" , enabledModels: ["gpt-4o"] },
    }]);

    const first = await buildModelsList([LLM_KIND]);
    const second = await buildModelsList([LLM_KIND]);
    const model = first.find((entry) => entry.id === "live/gpt-4o");

    expect(model.capabilities.contextWindow).toBe(262_144);
    expect(model.context_length).toBe(262_144);
    expect(second.find((entry) => entry.id === "live/gpt-4o").capabilities.contextWindow).toBe(262_144);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the static limit when live metadata exposes no limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o", object: "model", owned_by: "upstream" }] }),
    }));
    const providerId = "openai-compatible-bare-models-22222222-2222-4222-8222-222222222222";
    stubConnections([{
      id: "conn-bare-models",
      provider: providerId,
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "http://bare-models/v1", prefix: "bare", enabledModels: ["gpt-4o"] },
    }]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.find((entry) => entry.id === "bare/gpt-4o").capabilities.contextWindow).toBe(128_000);
  });

  it("rejects an absurd live limit instead of storing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o", context_window: 99_000_000 }] }),
    }));
    const providerId = "openai-compatible-bad-limits-33333333-3333-4333-8333-333333333333";
    stubConnections([{
      id: "conn-bad-limits",
      provider: providerId,
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "http://bad-limits/v1", prefix: "bad", enabledModels: ["gpt-4o"] },
    }]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.find((entry) => entry.id === "bad/gpt-4o").capabilities.contextWindow).toBe(128_000);
  });

  it("falls back to the static limit when live discovery errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("upstream unavailable"));
    vi.stubGlobal("fetch", fetchSpy);
    const providerId = "openai-compatible-error-limits-44444444-4444-4444-8444-444444444444";
    stubConnections([{
      id: "conn-error-limits",
      provider: providerId,
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: { baseUrl: "http://error-limits/v1", prefix: "err", enabledModels: ["gpt-4o"] },
    }]);

    const models = await buildModelsList([LLM_KIND]);
    await buildModelsList([LLM_KIND]);
    expect(models.find((entry) => entry.id === "err/gpt-4o").capabilities.contextWindow).toBe(128_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("merges live Kimi Code limits into canonical static model IDs", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: "k3", display_name: "K3", context_length: 999_999 },
        { id: "kimi-for-coding", display_name: "K2.7 Coding", context_length: 262_144 },
      ] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([{
      id: "conn-kimi-live",
      provider: "kimi",
      apiKey: "test-key",
      isActive: true,
      providerSpecificData: {},
    }]);

    const models = await buildModelsList([LLM_KIND]);

    expect(models.find((entry) => entry.id === "kimi/k3").capabilities.contextWindow).toBe(999_999);
    expect(models.some((entry) => entry.id === "kimi/kimi-for-coding")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });
});
