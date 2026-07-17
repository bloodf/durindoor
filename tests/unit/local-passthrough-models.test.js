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

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));

import { getProviderConnections } from "@/lib/localDb";

describe("local passthrough live model discovery", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("fetches /models for passthrough local providers with empty static models", async () => {
    const providerId = "lm-studio";
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: providerId,
        isActive: true,
        apiKey: "",
        providerSpecificData: { baseUrl: "http://localhost:1234/v1" },
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "lmstudio-model-a" }, { id: "lmstudio-model-b" }],
      }),
    });

    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(ids).toContain("lmstudio/lmstudio-model-a");
    expect(ids).toContain("lmstudio/lmstudio-model-b");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:1234/v1/models",
      expect.anything()
    );
  });

  it("does not fetch live models when static models exist", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "openai",
        isActive: true,
        apiKey: "sk-test",
        providerSpecificData: {},
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await buildModelsList(["llm"]);

    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/openai.*\/models/),
      expect.anything()
    );
  });

  it("includes Authorization header when local connection has an API key", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "lm-studio",
        isActive: true,
        apiKey: "local-key",
        providerSpecificData: { baseUrl: "http://localhost:1234/v1" },
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await buildModelsList(["llm"]);

    const [, init] = global.fetch.mock.calls.find((c) =>
      c[0].endsWith("/models")
    );
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer local-key" })
    );
  });
});
