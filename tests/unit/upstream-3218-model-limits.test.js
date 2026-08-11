import { describe, expect, it, vi } from "vitest";

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
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

function stubConnections(connections) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue([]);
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

describe("buildModelsList — top-level context_length / max_completion_tokens (#3218)", () => {
  it("emits snake_case top-level fields for static models and keeps nested capabilities", async () => {
    stubConnections([]);

    const models = await buildModelsList(["llm"]);
    const claude = models.find((m) => m.id === "cc/claude-opus-4-7");
    expect(claude).toBeDefined();
    expect(claude.context_length).toBe(1_000_000);
    expect(claude.max_completion_tokens).toBe(128_000);
    // nested capabilities object is still present and unchanged
    expect(claude.capabilities).toBeDefined();
    expect(claude.capabilities.contextWindow).toBe(1_000_000);
    expect(claude.capabilities.maxOutput).toBe(128_000);
  });

  it("uses static limits for partial live caps and omits unknown-model defaults", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [
        { id: "gpt-5.6", capabilities: { tools: true } },
        { id: "unknown-live-model", capabilities: { tools: true } },
      ] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    stubConnections([
      {
        id: "conn-ollama",
        provider: "ollama-local",
        apiKey: "local",
        isActive: true,
        providerSpecificData: { baseUrl: "http://127.0.0.1:11434" },
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const known = models.find((x) => x.id === "ollama-local/gpt-5.6");
    expect(known).toBeDefined();
    expect(known.context_length).toBe(400_000);
    expect(known.max_completion_tokens).toBe(128_000);
    expect(known.capabilities.tools).toBe(true);

    const unknown = models.find((x) => x.id === "ollama-local/unknown-live-model");
    expect(unknown).toBeDefined();
    expect(unknown.context_length).toBeUndefined();
    expect(unknown.max_completion_tokens).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("publishes explicit custom limits for an otherwise unknown model", async () => {
    stubConnections([]);
    localDb.getCustomModels.mockResolvedValue([
      {
        id: "unknown-custom-model",
        providerAlias: "ollama-local",
        capabilities: { contextWindow: 32_768, maxOutput: 4_096 },
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const custom = models.find((x) => x.id === "ollama-local/unknown-custom-model");
    expect(custom).toBeDefined();
    expect(custom.context_length).toBe(32_768);
    expect(custom.max_completion_tokens).toBe(4_096);
  });
});
