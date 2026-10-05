import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ snapshot: null, catalogs: {}, settings: {}, connections: [], readError: false, saveError: false }));
vi.mock("@/lib/localDb", () => ({
  getCachedSharedModelMetadata: async () => {
    if (store.readError) throw new Error("offline cache");
    return store.snapshot;
  },
  saveCachedSharedModelMetadata: async (snapshot) => {
    if (store.saveError) throw new Error("cache write failed");
    store.snapshot = snapshot;
  },
  getProviderConnections: async (filter = {}) => store.connections.filter((connection) =>
    (!filter.provider || connection.provider === filter.provider) && (filter.isActive === undefined || connection.isActive === filter.isActive)),
  getSettings: async () => store.settings,
  getCombos: async () => [],
  getModelAliases: async () => ({}),
  getCustomModels: async () => [],
  getSyncedModelCatalog: async (provider) => store.catalogs[provider] || null,
  getSyncedModelCatalogs: async () => store.catalogs,
  saveSyncedModelCatalog: async (provider, entry) => { store.catalogs[provider] = entry; },
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

import { getSharedModelMetadata, normalizeSharedModelMetadata, refreshSharedModelMetadata } from "../../src/lib/modelAutoSync/sharedMetadata.js";
import { effectiveSyncedModels } from "../../src/lib/modelAutoSync/catalog.js";
import { runModelAutoSync } from "../../src/lib/modelAutoSync/runner.js";
const NOW = Date.parse("2026-10-05T12:00:00Z");
const HOUR = 3600000;
const SOURCE = "https://models.dev/api.json";
const catalog = { openai: { models: { "future-model": { limit: { context: 512000, output: 64000 }, modalities: { input: ["text", "image"], output: ["text"] }, tool_call: true } } } };
const reply = (data) => new Response(JSON.stringify(data));

beforeEach(() => {
  store.snapshot = null;
  store.catalogs = {};
  store.settings = {};
  store.connections = [];
  store.readError = false;
  store.saveError = false;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("shared model metadata cache", () => {
  it("retains an explicit embedding kind through refresh, cache reads, and available-model materialization", async () => {
    await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply({
      openai: { models: { "vector-v1": { kind: "embedding", limit: { context: 8192 }, tool_call: false } } },
    }) });
    const cached = await getSharedModelMetadata();
    const [model] = effectiveSyncedModels({
      syncedAt: new Date(NOW).toISOString(), models: [{ id: "vector-v1", kind: "embedding" }],
    }, [], "openai", cached);
    expect(model.capabilities).toMatchObject({ contextWindow: 8192, tools: false, reasoning: false });
  });

  it("keeps usable metadata after a failed refresh and retries once it is stale", async () => {
    const first = await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply(catalog) });
    const failed = await refreshSharedModelMetadata({ now: NOW + 25 * HOUR, fetchCatalog: async () => new Response("unavailable", { status: 503 }) });
    expect(failed.fetchedAt).toBe(NOW);
    expect(failed.providers.openai["future-model"]).toMatchObject({ contextWindow: 512000, vision: true, tools: true });
    const refreshed = await refreshSharedModelMetadata({ now: NOW + 26 * HOUR, fetchCatalog: async () => reply({ openai: { models: { "future-model": { limit: { context: 1050000 } } } } }) });
    expect(refreshed.providers.openai["future-model"].contextWindow).toBe(1050000);
    expect(first.fetchedAt).toBe(NOW);
  });

  it.each([
    ["empty providers", () => reply({ openai: { models: {} } })],
    ["malformed model", () => reply({ openai: { models: { "future-model": { limit: { context: -1 }, input_modalities: [] } } } })],
    ["unregistered provider", () => reply({ outsider: { models: { "future-model": { limit: { context: 999999 } } } } })],
    ["invalid JSON", () => new Response("not-json")],
    ["network failure", () => { throw new Error("offline"); }],
  ])("does not replace usable metadata after %s", async (_name, fetchCatalog) => {
    const first = await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply(catalog) });
    const failed = await refreshSharedModelMetadata({ now: NOW + 25 * HOUR, fetchCatalog });
    expect(failed).toEqual(first);
    expect(store.snapshot).toEqual(first);
    expect((await getSharedModelMetadata()).providers.openai["future-model"].contextWindow).toBe(512000);
  });

  it("uses a 24h TTL, refreshes exactly at expiry, and forced refresh ignores freshness", async () => {
    const fetchCatalog = vi.fn(async () => reply(catalog));
    await refreshSharedModelMetadata({ now: NOW, fetchCatalog });
    await refreshSharedModelMetadata({ now: NOW + 24 * HOUR - 1, fetchCatalog });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await refreshSharedModelMetadata({ now: NOW + 24 * HOUR, fetchCatalog });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    fetchCatalog.mockImplementation(async () => reply({ openai: { models: { "future-model": { limit: { context: 800000 } } } } }));
    const forced = await refreshSharedModelMetadata({ now: NOW + 24 * HOUR + 1, force: true, fetchCatalog });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    expect(forced.providers.openai["future-model"].contextWindow).toBe(800000);
  });

  it("reads stale cached metadata without a side-effect download or fabricated provenance", async () => {
    const download = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("cache reads must not download"));
    store.snapshot = { version: 1, fetchedAt: NOW - 48 * HOUR, providers: { openai: { "future-model": { contextWindow: 512000, vision: false } } } };
    const fetched = await getSharedModelMetadata();
    expect(fetched.providers.openai["future-model"]).toEqual({ contextWindow: 512000, vision: false });
    expect(fetched.source).toBeUndefined();
    expect(fetched.modelMetadata.openai["future-model"]).toEqual({ fetchedAt: NOW - 48 * HOUR });
    expect(store.snapshot.fetchedAt).toBe(NOW - 48 * HOUR);
    expect(download).not.toHaveBeenCalled();
  });

  it("sanitizes cached capability rows instead of trusting cache transports or unknown providers", async () => {
    store.snapshot = {
      version: 1, fetchedAt: NOW, source: SOURCE,
      providers: {
        openai: { "future-model": { contextWindow: 512000, tools: false, headers: { Authorization: "untrusted-fixture" }, baseUrl: "https://untrusted.example" } },
        outsider: { "future-model": { contextWindow: 999999 } },
      },
    };
    const cached = await getSharedModelMetadata();
    expect(cached.providers.openai["future-model"]).toEqual({ contextWindow: 512000, tools: false });
    expect(cached.providers.outsider).toBeUndefined();
  });

  it("repairs an unusable empty cache and returns null when both disk and network are unavailable", async () => {
    store.snapshot = { version: 1, fetchedAt: NOW, providers: { openai: {} } };
    const fetchCatalog = vi.fn(async () => reply(catalog));
    const repaired = await refreshSharedModelMetadata({ now: NOW + 1, fetchCatalog });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(repaired.providers.openai["future-model"].contextWindow).toBe(512000);
    store.readError = true;
    expect(await getSharedModelMetadata()).toBeNull();
    expect(await refreshSharedModelMetadata({ now: NOW + 2, fetchCatalog: async () => { throw new Error("offline"); } })).toBeNull();
  });

  it("retains the persisted snapshot if saving a usable refresh fails", async () => {
    const old = await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply(catalog) });
    store.saveError = true;
    const result = await refreshSharedModelMetadata({ now: NOW + 25 * HOUR, fetchCatalog: async () => reply({ openai: { models: { "future-model": { limit: { context: 800000 } } } } }) });
    expect(result).toEqual(old);
    expect(store.snapshot).toEqual(old);
  });

  it("retains missing provider/model specs during partial refresh without giving them a new freshness stamp", async () => {
    await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply({
      ...catalog,
      xai: { models: { "other-model": { limit: { context: 96000 }, tool_call: false } } },
    }) });
    const refreshed = await refreshSharedModelMetadata({ now: NOW + 25 * HOUR, fetchCatalog: async () => reply({
      openai: { models: { "next-model": { limit: { context: 800000 } } } },
      xai: { models: {} },
    }) });
    expect(refreshed.fetchedAt).toBe(NOW + 25 * HOUR);
    expect(refreshed.providers.openai["future-model"].contextWindow).toBe(512000);
    expect(refreshed.providers.xai["other-model"].tools).toBe(false);
    expect(refreshed.modelMetadata.openai["future-model"].fetchedAt).toBe(NOW);
    expect(refreshed.modelMetadata.xai["other-model"].fetchedAt).toBe(NOW);
    expect(refreshed.modelMetadata.openai["next-model"].fetchedAt).toBe(NOW + 25 * HOUR);
    const [model] = effectiveSyncedModels({ syncedAt: new Date(NOW).toISOString(), models: [{ id: "future-model", kind: "llm" }] }, [], "openai", await getSharedModelMetadata());
    expect(model.metadataSources.sharedFetchedAt).toBe(NOW);
  });

  it("does not assign a new source to retained legacy metadata whose origin was unknown", async () => {
    store.snapshot = { version: 1, fetchedAt: NOW, providers: { openai: { "future-model": { contextWindow: 512000 } } } };
    await refreshSharedModelMetadata({ now: NOW + 25 * HOUR, fetchCatalog: async () => reply({
      openai: { models: { "next-model": { limit: { context: 800000 } } } },
    }) });
    const shared = await getSharedModelMetadata();
    expect(shared.modelMetadata.openai["future-model"]).toEqual({ fetchedAt: NOW });
    const [model] = effectiveSyncedModels({ syncedAt: new Date(NOW).toISOString(), models: [{ id: "future-model", kind: "llm" }] }, [], "openai", shared);
    expect(model.metadataSources.sharedSource).toBeUndefined();
    expect(model.metadataSources.sharedFetchedAt).toBe(NOW);
  });

  it("does not swallow a manual refresh behind a scheduled cache-only read", async () => {
    await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply(catalog) });
    const scheduledFetch = vi.fn(async () => reply(catalog));
    const forcedFetch = vi.fn(async () => reply({ openai: { models: { "future-model": { limit: { context: 800000 } } } } }));
    const scheduled = refreshSharedModelMetadata({ now: NOW + 1, fetchCatalog: scheduledFetch });
    const forced = refreshSharedModelMetadata({ now: NOW + 2, force: true, fetchCatalog: forcedFetch });
    await scheduled;
    const refreshed = await forced;
    expect(scheduledFetch).not.toHaveBeenCalled();
    expect(forcedFetch).toHaveBeenCalledTimes(1);
    expect(refreshed.providers.openai["future-model"].contextWindow).toBe(800000);
    expect(refreshed.fetchedAt).toBe(NOW + 2);
  });

  it("coalesces concurrent forced downloads while retaining the refreshed snapshot", async () => {
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const fetchCatalog = vi.fn(async () => response);
    const first = refreshSharedModelMetadata({ now: NOW, force: true, fetchCatalog });
    const second = refreshSharedModelMetadata({ now: NOW + 1, force: true, fetchCatalog });
    resolveResponse(reply(catalog));
    const snapshots = await Promise.all([first, second]);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(store.snapshot.providers.openai["future-model"].contextWindow).toBe(512000);
  });

  it("never imports credentials, endpoints, executable configuration, or unregistered providers", () => {
    const result = normalizeSharedModelMetadata({
      openai: { models: { "future-model": { limit: { context: 512000 }, headers: { Authorization: "untrusted-fixture" }, baseUrl: "https://untrusted.example", api: "untrusted-wire" } } },
      "unregistered-provider": { models: { "future-model": { limit: { context: 999999 } } } },
    });
    expect(result.openai["future-model"]).toEqual({ contextWindow: 512000 });
    expect(result["unregistered-provider"]).toBeUndefined();
  });

  it("combines Codex API specs without importing account availability and reads mapped Gemini/Copilot metadata", () => {
    const result = normalizeSharedModelMetadata({
      ...catalog,
      "openai-codex": { models: { "future-model": { tool_call: false }, "codex-only": { limit: { context: 128000 } } } },
      google: { models: { "gemini-future": { limit: { context: 1048576 } } } },
      "github-copilot": { models: { "copilot-future": { limit: { output: 128000 } } } },
    });
    expect(result.codex["future-model"]).toMatchObject({ contextWindow: 512000, tools: false });
    expect(result.codex["codex-only"].contextWindow).toBe(128000);
    expect(result.gemini["gemini-future"].contextWindow).toBe(1048576);
    expect(result.github["copilot-future"].maxOutput).toBe(128000);
  });
});

describe("shared metadata refresh through the production sync runner", () => {
  it("manual provider refresh updates actual metadata even with an injected roster fetcher and fresh shared cache", async () => {
    await refreshSharedModelMetadata({ now: NOW, fetchCatalog: async () => reply(catalog) });
    store.connections = [{ id: "openai-1", provider: "openai", isActive: true, apiKey: "fixture-key" }];
    store.settings = { modelAutoSyncProviders: { openai: false } };
    const fetchCatalog = vi.fn(async () => reply({ openai: { models: { "future-model": { limit: { context: 800000 }, tool_call: false } } } }));
    const result = await runModelAutoSync({
      providerIds: ["openai"], now: NOW + 1,
      fetchModels: async () => ({ models: [{ id: "future-model", capabilities: { vision: false } }] }),
      fetchCatalog,
    });
    expect(result[0].status).toBe("synced");
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    const shared = await getSharedModelMetadata();
    const [model] = effectiveSyncedModels(store.catalogs.openai, [], "openai", shared);
    expect(model.capabilities).toMatchObject({ contextWindow: 800000, tools: false, vision: false });
    expect(shared.fetchedAt).toBe(NOW + 1);
    expect(store.catalogs.openai.models[0].capabilities).toEqual({ vision: false });
    expect(store.catalogs.openai.models[0].metadataSources).toBeUndefined();
  });

  it("does not download shared metadata when there are no enabled/due roster providers", async () => {
    store.connections = [{ id: "openai-1", provider: "openai", isActive: true, apiKey: "fixture-key" }];
    store.catalogs.openai = { lastAttemptAt: new Date(NOW).toISOString(), models: [] };
    const fetchCatalog = vi.fn(async () => reply(catalog));
    expect(await runModelAutoSync({ now: NOW + 1, fetchCatalog })).toEqual([]);
    expect(fetchCatalog).not.toHaveBeenCalled();
    store.settings = { modelAutoSyncProviders: { openai: false } };
    store.catalogs = {};
    expect(await runModelAutoSync({ now: NOW + 25 * HOUR, fetchCatalog })).toEqual([]);
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(store.snapshot).toBeNull();
  });

  it("a forced metadata refresh still runs when the account has no roster provider", async () => {
    await runModelAutoSync({ force: true, now: NOW, fetchCatalog: async () => reply(catalog) });
    expect((await getSharedModelMetadata()).providers.openai["future-model"].contextWindow).toBe(512000);
    expect(store.catalogs).toEqual({});
  });
});
