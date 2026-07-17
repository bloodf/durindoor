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
});
