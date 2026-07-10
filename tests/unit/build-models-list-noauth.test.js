import { beforeEach, describe, expect, it, vi } from "vitest";

// /v1/models previously included the static no-auth catalogs (Pollinations,
// The Old LLM, …) only when connections.length === 0. Once a user saved any
// active connection for another provider, keyless providers vanished from
// model discovery even though they need no connection at all.
// See src/app/api/v1/models/buildModelsList.js.
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

describe("buildModelsList no-auth provider visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("includes no-auth providers when only unrelated connections exist", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: true, apiKey: "sk-test" },
    ]);

    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(ids.some((id) => id.startsWith("pol/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("tllm/"))).toBe(true);
    expect(ids).toContain("pol/openai");
    expect(ids).not.toContain("pol/claude");
    expect(ids).not.toContain("pol/gemini");
  });

  it("still includes no-auth providers with zero connections (unchanged behavior)", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(ids.some((id) => id.startsWith("pol/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("tllm/"))).toBe(true);
    expect(ids).not.toContain("pol/claude");
  });

  it("does not duplicate a no-auth provider that also has its own active connection", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "pollinations", isActive: true, apiKey: "premium-key" },
    ]);

    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("pol/"))).toBe(true);
    expect(ids).toContain("pol/claude");
    expect(ids).toContain("pol/gemini");
  });

  it("does not expose premium Pollinations models for a saved keyless connection", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "pollinations-public", provider: "pollinations", isActive: true },
    ]);

    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const ids = (await buildModelsList(["llm"])).map((model) => model.id);

    expect(ids).toContain("pol/openai");
    expect(ids).not.toContain("pol/claude");
    expect(ids).not.toContain("pol/gemini");
  });
});
