import { beforeEach, describe, expect, it, vi } from "vitest";

// PR #139 review (Codex): static OpenRouter rerank rows carry `kind: "rerank"`.
// Without `buildModelsList` mapping that kind, the LLM filter would advertise
// rerank-only models as chat models. This test pins both halves of the fix:
//   - /v1/models (LLM filter) MUST NOT surface openrouter rerank models
//   - /v1/models/rerank (rerank filter) MUST surface them
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

describe("buildModelsList rerank kind handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "openrouter", isActive: true, apiKey: "sk-test" },
    ]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("excludes rerank-only models from the chat-completions (llm) list", async () => {
    const { buildModelsList, LLM_KIND } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList([LLM_KIND]);
    const ids = new Set(models.map((m) => m.id));

    expect(ids.has("openrouter/cohere/rerank-4-pro")).toBe(false);
    expect(ids.has("openrouter/cohere/rerank-4-fast")).toBe(false);
    expect(ids.has("openrouter/cohere/rerank-v3.5")).toBe(false);
    expect(ids.has("openrouter/nvidia/llama-nemotron-rerank-vl-1b-v2:free")).toBe(false);
  });

  it("surfaces rerank-only models under the rerank kind filter", async () => {
    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["rerank"]);
    const ids = new Set(models.map((m) => m.id));

    expect(ids.has("openrouter/cohere/rerank-4-pro")).toBe(true);
    expect(ids.has("openrouter/nvidia/llama-nemotron-rerank-vl-1b-v2:free")).toBe(true);
  });
});
