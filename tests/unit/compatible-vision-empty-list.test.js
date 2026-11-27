import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  getCachedSharedModelMetadata: vi.fn(async () => null),
  getSyncedProviderCatalogs: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

const { buildModelsList } = await import("../../src/shared/models/buildModelsList.js");

describe("compatible upstream empty vision modality lists (9router #5900)", () => {
  let restoreFetch;
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    restoreFetch = __setOriginalFetchForTesting(fetchMock);
  });

  afterEach(() => {
    restoreFetch?.();
    vi.unstubAllGlobals();
  });

  it("skips empty modality lists to find a subsequent image list and leaves existing vision when all lists are empty", async () => {
    const provider = "openai-compatible-chat-rc-5900";
    db.getProviderConnections.mockResolvedValue([
      {
        id: "conn-rc-5900",
        provider,
        isActive: true,
        apiKey: "key-rc-5900",
        providerSpecificData: {
          prefix: "rc",
          baseUrl: "http://127.0.0.1:8081/v1",
          enabledModels: [
            "local-empty-arch-vision",
            "local-empty-both-vision",
            "gpt-4o",
            "preset-vision-empty-lists",
            "unknown-empty-lists",
          ],
        },
      },
    ]);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/models")) {
        return Response.json({
          data: [
            {
              id: "local-empty-arch-vision",
              architecture: { input_modalities: [] },
              input_modalities: ["text", "image"],
            },
            {
              id: "local-empty-both-vision",
              architecture: { input_modalities: [] },
              input_modalities: [],
              modalities: { input: ["image"] },
            },
            {
              id: "gpt-4o",
              architecture: { input_modalities: [] },
              input_modalities: [],
              modalities: { input: [] },
            },
            {
              id: "preset-vision-empty-lists",
              capabilities: { vision: true },
              architecture: { input_modalities: [] },
              input_modalities: [],
              modalities: { input: [] },
            },
            {
              id: "unknown-empty-lists",
              architecture: { input_modalities: [] },
              input_modalities: [],
              modalities: { input: [] },
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const models = await buildModelsList(["llm"], "block-metadata");
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get("rc/local-empty-arch-vision")?.capabilities?.vision).toBe(true);
    expect(byId.get("rc/local-empty-both-vision")?.capabilities?.vision).toBe(true);
    expect(byId.get("rc/gpt-4o")?.capabilities?.vision).toBe(true);
    expect(byId.get("rc/preset-vision-empty-lists")?.capabilities?.vision).toBe(true);
    expect(byId.get("rc/unknown-empty-lists")?.capabilities?.vision).toBeUndefined();
  });

  it("keeps explicit local catalog vision flags ahead of static defaults", async () => {
    const provider = "openai-compatible-chat-rc-custom-5900";
    db.getProviderConnections.mockResolvedValue([
      {
        id: "conn-rc-custom-5900",
        provider,
        isActive: true,
        apiKey: "key-rc-custom-5900",
        providerSpecificData: {
          prefix: "rc-custom",
          baseUrl: "http://127.0.0.1:8082/v1",
        },
      },
    ]);
    db.getCustomModels.mockResolvedValueOnce([
      {
        id: "gpt-4o",
        providerAlias: "rc-custom",
        capabilities: { vision: false },
      },
    ]);

    const models = await buildModelsList(["llm"], "block-metadata");
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get("rc-custom/gpt-4o")?.capabilities?.vision).toBe(false);
  });
});
