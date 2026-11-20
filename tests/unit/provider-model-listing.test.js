import { describe, expect, it, vi } from "vitest";

// Registry-driven model listing (9router #5464).
//
// DurinDoor never derives a "/models" URL from a provider's chat base URL.
// A provider becomes refreshable only when it declares its catalogue
// explicitly: a hand-written entry in PROVIDER_MODELS_CONFIG, or a
// `modelsFetcher` on its registry entry. These cases pin that contract and
// prove the provider route, the playground probe and the auto-sync service
// agree on which providers can list models.

const routedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
  saveSyncedModelCatalog: vi.fn(),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProxyPoolById: vi.fn(async () => null),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => null),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  refreshGoogleToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

import { canDiscoverModels } from "@/app/api/providers/route.js";
import { isModelAutoSyncEligible } from "@/lib/modelAutoSync/runner.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Refreshable purely because its registry entry declares a catalogue URL;
// there is no hand-written PROVIDER_MODELS_CONFIG entry for it.
const REGISTRY_ONLY_PROVIDER = "qiniu";
// Neither a config entry nor a registry catalogue.
const NO_CATALOGUE_PROVIDER = "opencode-go";
// A hand-written config entry.
const CONFIG_PROVIDER = "claude";
// A chat base URL with no declared catalogue.
const NO_EXPLICIT_CATALOGUE_PROVIDER = "glm-cn";

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("registry-driven model listing", () => {
  it("keeps the premise: the registry-only provider has no config entry", () => {
    expect(PROVIDER_MODELS_CONFIG[REGISTRY_ONLY_PROVIDER]).toBeUndefined();
    expect(typeof AI_PROVIDERS[REGISTRY_ONLY_PROVIDER]?.modelsFetcher?.url).toBe("string");
    expect(PROVIDER_MODELS_CONFIG[NO_EXPLICIT_CATALOGUE_PROVIDER]).toBeUndefined();
    expect(AI_PROVIDERS[NO_EXPLICIT_CATALOGUE_PROVIDER]?.modelsFetcher?.url).toBeUndefined();
  });

  it("treats a registry-only provider as listable for the route and the sync service", () => {
    expect(canDiscoverModels({ provider: REGISTRY_ONLY_PROVIDER, apiKey: "k" })).toBe(true);
    expect(isModelAutoSyncEligible(REGISTRY_ONLY_PROVIDER)).toBe(true);
  });

  it("treats a provider with a config entry as listable", () => {
    expect(PROVIDER_MODELS_CONFIG[CONFIG_PROVIDER]).toBeDefined();
    expect(canDiscoverModels({ provider: CONFIG_PROVIDER, apiKey: "sk-ant-test" })).toBe(true);
    expect(isModelAutoSyncEligible(CONFIG_PROVIDER)).toBe(true);
  });

  it("does not list a provider without any declared catalogue", () => {
    expect(canDiscoverModels({ provider: NO_CATALOGUE_PROVIDER, apiKey: "k" })).toBe(false);
    expect(isModelAutoSyncEligible(NO_CATALOGUE_PROVIDER)).toBe(false);
  });

  it("does not guess a catalogue URL from the provider chat base URL", async () => {
    // Upstream #5464 derives "{baseUrl}/models" for any registry provider that
    // lacks a catalogue declaration. DurinDoor keeps the catalogue explicit:
    // a guessed URL would 404 against hosts that expose no model list.
    expect(canDiscoverModels({ provider: NO_EXPLICIT_CATALOGUE_PROVIDER, apiKey: "k" })).toBe(false);

    const result = await fetchConnectionModels({
      id: 42,
      provider: NO_EXPLICIT_CATALOGUE_PROVIDER,
      apiKey: "k",
      providerSpecificData: {},
    });
    expect(result.error).toContain("does not support models listing");
    expect(result.status).toBe(400);
    expect(routedFetch).not.toHaveBeenCalled();
  });

  it("fetches the registry catalogue URL and returns the parsed models", async () => {
    routedFetch.mockReset();
    routedFetch.mockResolvedValue(json({ data: [{ id: "qwen3-max" }, { id: "qwen3-coder" }] }));

    const result = await fetchConnectionModels({
      id: 7,
      provider: REGISTRY_ONLY_PROVIDER,
      apiKey: "secret-key",
      providerSpecificData: {},
    });

    const expectedUrl = AI_PROVIDERS[REGISTRY_ONLY_PROVIDER].modelsFetcher.url;
    expect(routedFetch).toHaveBeenCalledTimes(1);
    expect(routedFetch.mock.calls[0][0]).toBe(expectedUrl);
    expect(routedFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-key");
    expect(result.provider).toBe(REGISTRY_ONLY_PROVIDER);
    expect(result.connectionId).toBe(7);
    expect(result.models.map((model) => model.id)).toEqual(["qwen3-max", "qwen3-coder"]);
  });
});
