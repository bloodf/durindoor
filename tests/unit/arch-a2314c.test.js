import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogCache } from "../../open-sse/services/catalogs/catalogCache.js";

afterEach(() => vi.useRealTimers());

describe("shared catalog cache", () => {
  it("deduplicates concurrent loads and expires at the TTL boundary", async () => {
    vi.useFakeTimers();
    const cache = createCatalogCache({ ttl: 100, keyFn: (id) => `catalog:${id}` });
    const loader = vi.fn(async () => ["model"]);
    const key = cache.keyFor("account");
    expect(key).toBe("catalog:account");
    expect(await Promise.all([cache.load(key, loader), cache.load(key, loader)])).toEqual([["model"], ["model"]]);
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    expect(await cache.load(key, loader)).toEqual(["model"]);
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(await cache.load(key, loader)).toEqual(["model"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("remembers failed lookups only for negativeTtl", async () => {
    vi.useFakeTimers();
    const cache = createCatalogCache({ ttl: 100, negativeTtl: 20 });
    const loader = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(["recovered"]);
    expect(await cache.load("account", loader)).toBeNull();
    vi.advanceTimersByTime(19);
    expect(await cache.load("account", loader)).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(await cache.load("account", loader)).toEqual(["recovered"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

it("preserves antigravityCatalog exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/antigravityCatalog.js");
  expect(Object.keys(catalog).sort()).toEqual(["ANTIGRAVITY_CAPABILITY_CACHE_TTL_MS", "ANTIGRAVITY_CAPABILITY_HINTS_META_KEY", "ANTIGRAVITY_CATALOG_OUTCOME", "ANTIGRAVITY_CATALOG_URL", "antigravityCapabilityRouteFingerprint", "antigravityCatalogEndpoint", "antigravityCatalogProxyUrl", "antigravityCatalogRouteFingerprint", "antigravityCatalogUserAgent", "antigravityForbiddenBackoff", "buildAntigravityCapabilityHintsPsdPatch", "buildAntigravityCatalogBody", "buildPersistedAntigravityCapabilityHints", "classifyAntigravityCatalogStatus", "normalizeAntigravityModelId", "parseAntigravityCatalogModels", "parseAntigravityModelCapabilityHints", "parsePersistedAntigravityCapabilityHints", "recordAntigravityForbidden", "resolveAntigravityConnectionProject", "reuseAntigravityCapabilityHints", "sanitizeAntigravityPersistedEndpoint"]);
});

it("preserves clineModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/clineModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["resolveClineModels"]);
});

it("preserves clinepassModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/clinepassModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["resolveClinepassModels"]);
});

it("preserves cloudflareModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/cloudflareModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["cloudflareInferenceId", "discoverCloudflareModels"]);
});

it("preserves commandcodeModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/commandcodeModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["COMMANDCODE_MODELS_URL", "parseCommandCodeModels", "resolveCommandCodeModels"]);
});

it("preserves copilotModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/copilotModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["clearCopilotModelCache", "resolveCopilotModels"]);
});

it("preserves cursorModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/cursorModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["addCursorEffortAliases", "clearCursorModelCache", "mergeCursorModelFlags", "normalizeCursorAvailableModels", "parseCursorAvailableModels", "parseCursorUsableModels", "resolveAutoModelSelection", "resolveCursorModels"]);
});

it("preserves kimchiModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/kimchiModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["KIMCHI_API", "buildKimchiModelsUrl", "clearKimchiCatalog", "getCachedKimchiModelMetadata", "normalizeKimchiModel", "resolveKimchiModels"]);
});

it("preserves kiroModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/kiroModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["clearKiroModelCache", "enrichKiroCredentialsFromSsoCache", "invalidateKiroModelCache", "isKiroSsoToken", "isRefreshableKiroAuthError", "resolveKiroCredentialsFromSsoCache", "resolveKiroModels"]);
});

it("preserves ollamaCatalog exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/ollamaCatalog.js");
  expect(Object.keys(catalog).sort()).toEqual(["discoverOllamaCatalog", "getOllamaCatalogModel", "isLegacyOllamaEmbeddingModel"]);
});

it("preserves openrouterCatalog exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/openrouterCatalog.js");
  expect(Object.keys(catalog).sort()).toEqual(["OPENROUTER_DECISIONS_MODELS_URL", "OPENROUTER_LOOKUP_BUDGET_MS", "OPENROUTER_MODELS_URL", "clearOpenRouterCatalogCache", "getOpenRouterModelCapabilities", "isOpenRouterDecisionModel", "isOpenRouterFreeModel", "mapOpenRouterModel", "mergeOpenRouterCatalogs", "resolveOpenRouterDecisionModels", "resolveOpenRouterModels", "warmOpenRouterCatalog"]);
});

it("preserves qoderModels exports", async () => {
  const catalog = await import("../../open-sse/services/catalogs/qoderModels.js");
  expect(Object.keys(catalog).sort()).toEqual(["clearQoderCatalog", "getQoderModelConfig", "invalidateQoderCatalog", "resolveQoderModels"]);
});

