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

describe("9router #5900 compatible upstream vision metadata", () => {
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

  it("publishes declared vision=true and vision=false from architecture.input_modalities on compatible connections", async () => {
    const provider = "openai-compatible-chat-llama-5900";
    db.getProviderConnections.mockResolvedValue([
      {
        id: "conn-llama-5900",
        provider,
        isActive: true,
        apiKey: "key-5900",
        providerSpecificData: {
          prefix: "llama-local",
          baseUrl: "http://127.0.0.1:8080/v1",
          enabledModels: ["local-mm-model", "local-text-only"],
        },
      },
    ]);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/models")) {
        return Response.json({
          data: [
            { id: "local-mm-model", architecture: { input_modalities: ["text", "image"] } },
            { id: "llama-local/local-text-only", architecture: { input_modalities: ["text"] } },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const models = await buildModelsList(["llm"], "block-metadata");
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get("llama-local/local-mm-model")?.capabilities?.vision).toBe(true);
    expect(byId.get("llama-local/local-text-only")?.capabilities?.vision).toBe(false);
  });
});
