import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
  getDisabledModels: vi.fn(),
  getEnabledModels: vi.fn(),
  getSettings: vi.fn(),
  getProxyPoolById: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
  getComboForModel: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getSettings: mocks.getSettings,
  getProxyPoolById: mocks.getProxyPoolById,
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: mocks.getEnabledModels }));
vi.mock("@/sse/services/modelAccess.js", () => ({
  filterModelsForRequest: vi.fn(async (_req, models) => models),
  getRequestModelDiscoveryOptions: vi.fn(async () => ({})),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

import {
  OPENROUTER_DECISIONS_MODELS_URL,
  OPENROUTER_MODELS_URL,
  clearOpenRouterCatalogCache,
  isOpenRouterDecisionModel,
  mapOpenRouterModel,
  mergeOpenRouterCatalogs,
  resolveOpenRouterDecisionModels,
  resolveOpenRouterModels,
} from "../../open-sse/services/openrouterCatalog.js";
import { classifyModelKind, normalizeSyncedModels } from "../../src/lib/modelAutoSync/catalog.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { GET as getModelsByKind } from "../../src/app/api/v1/models/[...model]/route.js";

const CHAT_FREE = {
  id: "google/gemma-4-31b-it:free",
  name: "Google: Gemma 4 31B (free)",
  context_length: 262144,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" },
  top_provider: { context_length: 262144, max_completion_tokens: 32768 },
  supported_parameters: ["max_tokens", "tools"],
};

const CHAT_PAID = {
  id: "openai/gpt-4o",
  name: "OpenAI: GPT-4o",
  context_length: 128000,
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  pricing: { prompt: "0.0000025", completion: "0.00001" },
  top_provider: { max_completion_tokens: 16384 },
  supported_parameters: ["tools"],
};

const DECISIONS_JEV = {
  id: "typesafe/jev-1.13",
  name: "TypeSafe: Jev 1.13",
  context_length: 8192,
  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
  pricing: { prompt: "0.0000001", completion: "0" },
};

const DECISIONS_MERCURY = {
  id: "inception/mercury-decide",
  name: "Inception: Mercury Decide",
  context_length: 16384,
  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
  pricing: { prompt: "0.0000002", completion: "0" },
};

const DECISIONS_FREE = {
  id: "vendor/decide-mini:free",
  name: "Vendor: Decide Mini (free)",
  context_length: 4096,
  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
  pricing: { prompt: "0", completion: "0" },
};

const EMBED_MODEL = {
  id: "vendor/embed-v1:free",
  name: "Vendor Embed",
  architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] },
  pricing: { prompt: "0", completion: "0" },
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function catalogFetch({ primary = [CHAT_FREE, CHAT_PAID], decisions = [DECISIONS_JEV, DECISIONS_MERCURY], onDecisions = null } = {}) {
  return vi.fn(async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("output_modalities") === "decisions") {
      if (onDecisions) return onDecisions(url);
      return jsonResponse({ data: decisions });
    }
    return jsonResponse({ data: primary });
  });
}

beforeEach(() => {
  clearOpenRouterCatalogCache();
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getSyncedModelCatalogs.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getEnabledModels.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
  mocks.getProxyPoolById.mockResolvedValue(null);
  mocks.proxyAwareFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenRouter decision model classification", () => {
  it("classifies output_modalities=decisions rows as systemone in local representation", () => {
    expect(isOpenRouterDecisionModel(DECISIONS_JEV)).toBe(true);
    expect(isOpenRouterDecisionModel(CHAT_FREE)).toBe(false);
    expect(isOpenRouterDecisionModel(EMBED_MODEL)).toBe(false);
    expect(isOpenRouterDecisionModel(null)).toBe(false);

    expect(mapOpenRouterModel(DECISIONS_JEV)).toMatchObject({
      id: "typesafe/jev-1.13",
      name: "TypeSafe: Jev 1.13",
      free: false,
      kind: "systemone",
      capabilities: { contextWindow: 8192 },
    });
    expect(mapOpenRouterModel(CHAT_FREE).kind).toBeUndefined();
    expect(mapOpenRouterModel(EMBED_MODEL).kind).toBe("embedding");
  });

  it("classifies raw decision rows as systemone in synced model normalization", () => {
    expect(classifyModelKind(DECISIONS_MERCURY.id, DECISIONS_MERCURY)).toBe("systemone");
    expect(classifyModelKind(CHAT_FREE.id, CHAT_FREE)).toBe("llm");

    const normalized = normalizeSyncedModels([CHAT_FREE, DECISIONS_MERCURY]);
    expect(normalized.map((row) => [row.id, row.kind])).toEqual([
      [CHAT_FREE.id, "llm"],
      [DECISIONS_MERCURY.id, "systemone"],
    ]);
  });

  it("merges primary and decision catalogs without duplicating overlapping ids", () => {
    const primary = [mapOpenRouterModel(CHAT_FREE), mapOpenRouterModel(DECISIONS_JEV)];
    const decisions = [
      mapOpenRouterModel({ ...DECISIONS_JEV, name: "Duplicate Jev" }),
      mapOpenRouterModel(DECISIONS_MERCURY),
    ];
    const merged = mergeOpenRouterCatalogs(primary, decisions);
    expect(merged.map((m) => [m.id, m.name])).toEqual([
      [CHAT_FREE.id, CHAT_FREE.name],
      [DECISIONS_JEV.id, DECISIONS_JEV.name],
      [DECISIONS_MERCURY.id, DECISIONS_MERCURY.name],
    ]);
  });
});

describe("OpenRouter catalog discovery with decisions", () => {
  it("fetches and merges both the primary and decisions listings with no credentials and strict redirects", async () => {
    const fetchImpl = catalogFetch();
    const models = await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });

    expect(models.map((m) => [m.id, m.kind ?? "llm"])).toEqual([
      [CHAT_FREE.id, "llm"],
      [CHAT_PAID.id, "llm"],
      [DECISIONS_JEV.id, "systemone"],
      [DECISIONS_MERCURY.id, "systemone"],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      OPENROUTER_MODELS_URL,
      OPENROUTER_DECISIONS_MODELS_URL,
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps decision models alongside free models when freeOnly and includeDecisions are both set", async () => {
    const fetchImpl = catalogFetch();
    const models = await resolveOpenRouterModels({ freeOnly: true, includeDecisions: true, fetchImpl });

    expect(models.map((m) => m.id)).toEqual([
      CHAT_FREE.id,
      DECISIONS_JEV.id,
      DECISIONS_MERCURY.id,
    ]);
  });

  it("leaves the primary catalog usable when the decisions request fails and retries after failure TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    let decisionsFail = true;
    const fetchImpl = catalogFetch({
      onDecisions: () => decisionsFail
        ? new Response("unavailable", { status: 503 })
        : jsonResponse({ data: [DECISIONS_MERCURY] }),
    });

    const first = await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    expect(first.map((m) => m.id)).toEqual([CHAT_FREE.id, CHAT_PAID.id]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Within 5-minute failure TTL, both primary (positive) and decisions (negative) hit cache.
    vi.setSystemTime(new Date("2026-11-26T00:04:00Z"));
    const second = await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    expect(second.map((m) => m.id)).toEqual([CHAT_FREE.id, CHAT_PAID.id]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // After 5-minute failure TTL (still inside 30-minute primary TTL), only decisions retries.
    decisionsFail = false;
    vi.setSystemTime(new Date("2026-11-26T00:06:00Z"));
    const third = await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    expect(third.map((m) => m.id)).toEqual([CHAT_FREE.id, CHAT_PAID.id, DECISIONS_MERCURY.id]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][0]).toBe(OPENROUTER_DECISIONS_MODELS_URL);
  });

  it("enforces timeout on a hanging secondary decisions fetch while preserving the primary catalog", async () => {
    vi.useFakeTimers();
    let seenSignal = null;
    const fetchImpl = catalogFetch({
      onDecisions: (_url) => new Promise((_resolve, reject) => {
        const call = fetchImpl.mock.calls.at(-1);
        seenSignal = call?.[1]?.signal ?? null;
        seenSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });

    const pending = resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    await vi.advanceTimersByTimeAsync(8100);
    const models = await pending;

    expect(seenSignal?.aborted).toBe(true);
    expect(models.map((m) => m.id)).toEqual([CHAT_FREE.id, CHAT_PAID.id]);
  });

  it("caches merged results within TTL and coalesces concurrent calls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const fetchImpl = catalogFetch();

    const [a, b] = await Promise.all([
      resolveOpenRouterModels({ includeDecisions: true, fetchImpl }),
      resolveOpenRouterModels({ includeDecisions: true, fetchImpl }),
    ]);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-11-26T00:29:00Z"));
    await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-11-26T00:31:00Z"));
    await resolveOpenRouterModels({ includeDecisions: true, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("isolates cache and routes outbound proxy policy per connection without leaking direct fetch", async () => {
    const directFetch = vi.fn(async () => {
      throw new Error("direct fetch must not be used for proxied connections");
    });
    vi.stubGlobal("fetch", directFetch);

    mocks.proxyAwareFetch.mockImplementation(async (url, _init, proxyOptions) => {
      const parsed = new URL(String(url));
      if (proxyOptions?.strictProxy && !proxyOptions?.connectionProxyUrl) {
        throw new Error("[ProxyFetch] Proxy required but unavailable (strictProxy=true)");
      }
      if (proxyOptions?.connectionProxyUrl === "http://proxy-a.local:8080") {
        return jsonResponse({
          data: parsed.searchParams.get("output_modalities") === "decisions" ? [DECISIONS_JEV] : [CHAT_FREE],
        });
      }
      if (proxyOptions?.connectionProxyUrl === "http://proxy-b.local:8080") {
        return jsonResponse({
          data: parsed.searchParams.get("output_modalities") === "decisions" ? [DECISIONS_MERCURY] : [CHAT_PAID],
        });
      }
      throw new Error("unexpected proxyOptions");
    });

    const proxyA = { source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.local:8080" };
    const proxyB = { source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-b.local:8080" };
    const brokenStrict = { source: "error", strictProxy: true, connectionProxyEnabled: false, connectionProxyUrl: "" };

    const modelsA = await resolveOpenRouterModels({ includeDecisions: true, proxyOptions: proxyA });
    const modelsB = await resolveOpenRouterModels({ includeDecisions: true, proxyOptions: proxyB });
    const modelsBroken = await resolveOpenRouterModels({ includeDecisions: true, proxyOptions: brokenStrict });

    expect(modelsA.map((m) => m.id)).toEqual([CHAT_FREE.id, DECISIONS_JEV.id]);
    expect(modelsB.map((m) => m.id)).toEqual([CHAT_PAID.id, DECISIONS_MERCURY.id]);
    expect(modelsBroken).toBeNull();
    expect(directFetch).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(5);
    expect(await resolveOpenRouterDecisionModels({ proxyOptions: brokenStrict })).toBeNull();
  });
});

describe("System One listing and synced OpenRouter models", () => {
  it("lists discovered OpenRouter decision models under systemone and excludes them from llm", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    const fetchMock = catalogFetch();
    vi.stubGlobal("fetch", fetchMock);

    const systemoneModels = await buildModelsList(["systemone"]);
    const systemoneIds = systemoneModels.map((m) => m.id);
    expect(systemoneIds).toContain("openrouter/typesafe/jev-1.13");
    expect(systemoneIds).toContain("openrouter/inception/mercury-decide");
    expect(systemoneIds).not.toContain(`openrouter/${CHAT_FREE.id}`);
    expect(systemoneModels.find((m) => m.id === "openrouter/inception/mercury-decide")?.kind).toBe("systemone");

    const llmModels = await buildModelsList([LLM_KIND]);
    const llmIds = llmModels.map((m) => m.id);
    expect(llmIds).toContain(`openrouter/${CHAT_FREE.id}`);
    expect(llmIds).not.toContain("openrouter/typesafe/jev-1.13");
    expect(llmIds).not.toContain("openrouter/inception/mercury-decide");

    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.stringify(init ?? {})).not.toContain("sk-or-secret");
    }
  });

  it("respects hidePaidModels on discovered OpenRouter decision models", async () => {
    mocks.getSettings.mockResolvedValue({ hidePaidModels: true });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    vi.stubGlobal("fetch", catalogFetch({ decisions: [DECISIONS_JEV, DECISIONS_MERCURY, DECISIONS_FREE] }));

    const ids = (await buildModelsList(["systemone"])).map((m) => m.id);
    expect(ids).toContain(`openrouter/${DECISIONS_FREE.id}`);
    expect(ids).not.toContain(`openrouter/${DECISIONS_MERCURY.id}`);
  });

  it("keeps OpenRouter decision models listed when synced models exist", async () => {
    mocks.getSettings.mockResolvedValue({ modelAutoSyncProviders: { openrouter: true } });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-sync", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    mocks.getSyncedModelCatalogs.mockResolvedValue({
      openrouter: {
        syncedAt: "2026-11-26T00:00:00.000Z",
        models: [{ id: "fixture/chat-model", name: "Fixture Chat", kind: "llm" }],
      },
    });
    const fetchMock = catalogFetch({ primary: [CHAT_FREE], decisions: [DECISIONS_JEV, DECISIONS_MERCURY] });
    vi.stubGlobal("fetch", fetchMock);

    const systemoneModels = (await buildModelsList(["systemone"])).filter((m) => m.owned_by === "openrouter");
    expect(systemoneModels.map((m) => [m.id, m.kind])).toEqual([
      ["openrouter/typesafe/jev-1.13", "systemone"],
      ["openrouter/inception/mercury-decide", "systemone"],
    ]);

    // Synced LLM listing stays scoped to synced models without re-adding public chat rows.
    const llmModels = (await buildModelsList([LLM_KIND])).filter((m) => m.owned_by === "openrouter");
    expect(llmModels.map((m) => m.id)).toEqual(["openrouter/fixture/chat-model"]);
  });

  it("keeps primary free models and static systemone rows usable when the secondary decisions fetch fails", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    vi.stubGlobal("fetch", catalogFetch({
      primary: [CHAT_FREE, CHAT_PAID],
      onDecisions: () => new Response("unavailable", { status: 503 }),
    }));

    const llmIds = (await buildModelsList([LLM_KIND])).filter((m) => m.owned_by === "openrouter").map((m) => m.id);
    expect(llmIds).toEqual([`openrouter/${CHAT_FREE.id}`]);

    const systemoneIds = (await buildModelsList(["systemone"])).filter((m) => m.owned_by === "openrouter").map((m) => m.id);
    expect(systemoneIds).toEqual(["openrouter/typesafe/jev-1.13"]);
  });

  it("serves discovered OpenRouter decision models from GET /v1/models/systemone", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    vi.stubGlobal("fetch", catalogFetch({ primary: [CHAT_FREE], decisions: [DECISIONS_JEV, DECISIONS_MERCURY] }));

    const response = await getModelsByKind(
      new Request("http://localhost/v1/models/systemone"),
      { params: Promise.resolve({ model: ["systemone"] }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const openrouterRows = body.data.filter((m) => m.owned_by === "openrouter");
    expect(openrouterRows.map((m) => [m.id, m.kind])).toEqual([
      ["openrouter/typesafe/jev-1.13", "systemone"],
      ["openrouter/inception/mercury-decide", "systemone"],
    ]);
  });

  it("keeps synced OpenRouter models intact when the secondary decisions request fails", async () => {
    mocks.getSettings.mockResolvedValue({ modelAutoSyncProviders: { openrouter: true } });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "or-sync", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" },
    ]);
    mocks.getSyncedModelCatalogs.mockResolvedValue({
      openrouter: {
        syncedAt: "2026-11-26T00:00:00.000Z",
        models: [{ id: "fixture/chat-model", name: "Fixture Chat", kind: "llm" }],
      },
    });
    vi.stubGlobal("fetch", catalogFetch({
      onDecisions: () => new Response("unavailable", { status: 503 }),
    }));

    expect((await buildModelsList(["systemone"])).filter((m) => m.owned_by === "openrouter")).toEqual([]);
    expect((await buildModelsList([LLM_KIND])).filter((m) => m.owned_by === "openrouter").map((m) => m.id)).toEqual(["openrouter/fixture/chat-model"]);
  });

  it("honors explicit enabledModels allowlist for OpenRouter decision models alongside synced models", async () => {
    mocks.getSettings.mockResolvedValue({ modelAutoSyncProviders: { openrouter: true } });
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "or-sync",
        provider: "openrouter",
        isActive: true,
        apiKey: "sk-or-secret",
        providerSpecificData: { enabledModels: ["fixture/chat-model", "inception/mercury-decide"] },
      },
    ]);
    mocks.getSyncedModelCatalogs.mockResolvedValue({
      openrouter: {
        syncedAt: "2026-11-26T00:00:00.000Z",
        models: [{ id: "fixture/chat-model", name: "Fixture Chat", kind: "llm" }],
      },
    });
    vi.stubGlobal("fetch", catalogFetch({ decisions: [DECISIONS_JEV, DECISIONS_MERCURY] }));

    const systemoneIds = (await buildModelsList(["systemone"])).filter((m) => m.owned_by === "openrouter").map((m) => m.id);
    expect(systemoneIds).toEqual(["openrouter/inception/mercury-decide"]);
  });

  it("passes the connection proxy policy when listing OpenRouter decision models with synced catalogs", async () => {
    mocks.getSettings.mockResolvedValue({ modelAutoSyncProviders: { openrouter: true } });
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "or-proxied",
        provider: "openrouter",
        isActive: true,
        apiKey: "sk-or-secret",
        providerSpecificData: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy-sync.local:8080",
        },
      },
    ]);
    mocks.getSyncedModelCatalogs.mockResolvedValue({
      openrouter: {
        syncedAt: "2026-11-26T00:00:00.000Z",
        models: [{ id: "fixture/chat-model", name: "Fixture Chat", kind: "llm" }],
      },
    });
    const directFetch = vi.fn(async () => {
      throw new Error("direct fetch must not be used when connection proxy is enabled");
    });
    vi.stubGlobal("fetch", directFetch);
    mocks.proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ data: [DECISIONS_MERCURY] }));

    const systemoneIds = (await buildModelsList(["systemone"])).filter((m) => m.owned_by === "openrouter").map((m) => m.id);
    expect(systemoneIds).toEqual(["openrouter/inception/mercury-decide"]);
    expect(directFetch).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe(OPENROUTER_DECISIONS_MODELS_URL);
    expect(mocks.proxyAwareFetch.mock.calls[0][2]).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy-sync.local:8080",
    });
  });
});
