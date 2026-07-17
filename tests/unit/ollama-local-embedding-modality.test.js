import { describe, expect, it, vi, afterEach } from "vitest";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

const originalFetch = global.fetch;

vi.mock("@/lib/localDb", async () => {
  return {
    getProviderConnections: vi.fn(),
    getCombos: vi.fn(() => Promise.resolve([])),
    getCustomModels: vi.fn(() => Promise.resolve([])),
    getModelAliases: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(() => Promise.resolve({ hidePaidModels: false })),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));

import { getProviderConnections } from "@/lib/localDb";

describe("ollama-local embedding model discovery (#media-ollama-embeddings)", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("includes ollama-local live embedding models and excludes cloud ollama", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-ollama-local",
        provider: "ollama-local",
        isActive: true,
        apiKey: "",
        providerSpecificData: { baseUrl: "http://localhost:11434" },
      },
      {
        id: "conn-ollama-cloud",
        provider: "ollama",
        isActive: true,
        apiKey: "sk-test",
        providerSpecificData: {},
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: "nomic-embed-text", name: "nomic-embed-text" },
          { id: "llama3.2", name: "llama3.2" },
        ],
      }),
    });

    const models = await buildModelsList(["embedding"], "block-metadata");

    const localModel = models.find((m) => m.id === "ollama-local/nomic-embed-text");
    expect(localModel).toBeDefined();
    expect(localModel.owned_by).toBe("ollama-local");
    expect(models.some((m) => m.id === "ollama-local/llama3.2")).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ method: "GET", redirect: "manual" })
    );
    expect(models.some((m) => m.owned_by === "ollama")).toBe(false);
  });

  it("classifies bge-m3 and all-minilm as embedding models", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-ollama-local",
        provider: "ollama-local",
        isActive: true,
        apiKey: "",
        providerSpecificData: { baseUrl: "http://localhost:11434" },
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: "bge-m3", name: "bge-m3", details: { family: "bert" } },
          { id: "all-minilm", name: "all-minilm" },
          { id: "snowflake-arctic-embed-s", name: "snowflake-arctic-embed-s" },
          { id: "snowflake-arctic-instruct", name: "snowflake-arctic-instruct" },
          { id: "opaque-model", name: "bge-m3" },
          { id: "general-purpose", name: "all-minilm" },
          { id: "phi4", name: "phi4" },
        ],
      }),
    });

    const models = await buildModelsList(["embedding"], "block-metadata");

    expect(models.some((m) => m.id === "ollama-local/bge-m3")).toBe(true);
    expect(models.some((m) => m.id === "ollama-local/all-minilm")).toBe(true);
    expect(models.some((m) => m.id === "ollama-local/snowflake-arctic-embed-s")).toBe(true);
    expect(models.some((m) => m.id === "ollama-local/opaque-model")).toBe(true);
    expect(models.some((m) => m.id === "ollama-local/general-purpose")).toBe(true);
    expect(models.some((m) => m.id === "ollama-local/snowflake-arctic-instruct")).toBe(false);
    expect(models.some((m) => m.id === "ollama-local/phi4")).toBe(false);
  });
});
