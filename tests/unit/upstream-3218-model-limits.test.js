import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
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
    // Upstream #3267: static catalogs require an active connection when DB
    // reads succeed; use the saved Claude route whose fields this test owns.
    stubConnections([{ id: "conn-claude", provider: "claude", isActive: true, providerSpecificData: { enabledModels: ["claude-opus-4-7"] } }]);

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

  it("does not infer local runtime limits from a cloud model name", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      json: async () => ({ models: String(url).endsWith("/api/tags") ? [
        { name: "gpt-5.6", capabilities: ["completion", "tools"] },
        { name: "unknown-live-model", capabilities: ["completion", "tools"] },
      ] : [] }),
    }));
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
    expect(known.context_length).toBeUndefined();
    expect(known.max_completion_tokens).toBeUndefined();
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
