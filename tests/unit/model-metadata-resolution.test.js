import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractApiCapabilities, extractLiveModelLimits, projectDiscoveryMetadata } from "../../open-sse/services/modelMetadata.js";
import { effectiveSyncedModels, materializeSyncedModel, normalizeSyncedModels } from "../../src/lib/modelAutoSync/catalog.js";
import { buildModelsResponse } from "../../src/app/api/v1/models/_shared.js";
import { GET as getDashboardModels } from "../../src/app/api/models/route.js";
import { GET as getModelInfo } from "../../src/app/api/v1/models/info/route.js";
import { getProviderAlias } from "../../src/shared/constants/providers.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";

// Mock only cache/database reads; roster selection and materialization are real.
const dashboardDb = vi.hoisted(() => ({
  settings: {}, catalogs: {}, shared: null, custom: [], aliases: {}, disabled: {},
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => dashboardDb.settings,
  getSyncedModelCatalogs: async () => dashboardDb.catalogs,
  getSyncedModelCatalog: async (provider) => dashboardDb.catalogs[provider] ?? null,
  getCustomModels: async () => dashboardDb.custom,
  getCachedSharedModelMetadata: async () => dashboardDb.shared,
}));
vi.mock("@/models", () => ({
  getModelAliases: async () => dashboardDb.aliases,
  setModelAlias: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => dashboardDb.disabled,
}));
beforeEach(() => {
  Object.assign(dashboardDb, { settings: {}, catalogs: {}, shared: null, custom: [], aliases: {}, disabled: {} });
});

const entry = (models) => ({ syncedAt: "2026-10-05T12:00:00Z", models });

describe("model metadata source precedence", () => {
  it("rebuilds cached Codex capacity from the API specification instead of a compaction default", () => {
    const [model] = effectiveSyncedModels(entry([{
      id: "gpt-6.1-sol", kind: "llm", capabilities: { contextWindow: 272000, vision: true },
    }]), [], "codex");
    expect(model.capabilities).toMatchObject({ contextWindow: 1050000, maxInput: 922000, maxOutput: 128000, vision: true });
  });

  it("does not let shared defaults replace a verified MiniMax maximum or invent an output ceiling", () => {
    const model = materializeSyncedModel("minimax", { id: "MiniMax-M3.1-Flash-Preview", kind: "llm" }, {
      providers: { minimax: { "MiniMax-M3.1-Flash-Preview": { contextWindow: 200000, maxOutput: 64000, vision: false } } },
    });
    expect(model.capabilities).toMatchObject({ contextWindow: 1000000, maxOutput: null, vision: true, videoInput: true });
  });

  it("uses provider-scoped shared metadata for a new available model while preserving an explicit false flag", () => {
    const shared = { providers: { openai: { "future-model": { contextWindow: 512000, vision: true, tools: true } }, xai: { "future-model": { contextWindow: 96000 } } } };
    const [model] = effectiveSyncedModels(entry([{ id: "future-model", kind: "llm", capabilities: { vision: false } }]), [], "openai", shared);
    expect(model.capabilities).toMatchObject({ contextWindow: 512000, vision: false, tools: true });
  });

  it("does not grant models from a shared catalog that the account did not list", () => {
    const shared = { providers: { openai: { "unavailable-model": { contextWindow: 1050000 } } } };
    expect(effectiveSyncedModels(entry([{ id: "available-model", kind: "llm" }]), [], "openai", shared).map((m) => m.id)).toEqual(["available-model"]);
  });

  it("retains registered realtime service models instead of pruning them as unroutable chat", () => {
    const models = normalizeSyncedModels([{ id: "gpt-realtime-2.1" }], [{ id: "gpt-realtime-2.1", kind: "realtime" }]);
    expect(models.map((m) => [m.id, m.kind])).toEqual([["gpt-realtime-2.1", "realtime"]]);
  });
});

describe("rich compatible model metadata", () => {
  it("prefers the declared maximum window and retains an independently known output limit", () => {
    expect(extractLiveModelLimits({ max_model_len: 1050000, context_length: 272000, limits: { max_output_tokens: 128000 } })).toEqual({ contextWindow: 1050000, maxOutput: 128000 });
    expect(extractLiveModelLimits({ limits: { max_input_tokens: "invalid", max_output_tokens: 128000 } })).toEqual({ maxOutput: 128000 });
  });

  it("does not turn missing or empty modality metadata into unsupported flags", () => {
    expect(extractApiCapabilities({ input_modalities: [] })).toEqual({});
    expect(extractApiCapabilities({ input_modalities: ["text", "image"] }).videoInput).toBeUndefined();
    expect(extractApiCapabilities({ capabilities: { videoInput: false } }).videoInput).toBe(false);
  });

  it("keeps explicit false above derived native support, modalities and effort hints", () => {
    const caps = extractApiCapabilities({
      input: ["text", "image", "web_search"],
      output: ["text", "image"],
      supported_reasoning_levels: ["none", "low", "high"],
      capabilities: {
        vision: false, imageOutput: false, tools: false, reasoning: false,
        structuredOutput: false, promptCaching: false, thinkingCanDisable: false,
        supports: { vision: true, tool_calls: true },
        thinking: { supported: true },
        structured_outputs: { supported: true },
        prompt_caching: { supported: true },
      },
    });
    expect(caps).toMatchObject({
      vision: false, imageOutput: false, tools: false, reasoning: false,
      structuredOutput: false, promptCaching: false, thinkingCanDisable: false,
    });
    expect(extractApiCapabilities({ input: ["web_search", "code_execution"] })).toEqual({});
    expect(extractApiCapabilities({ supportedTools: ["web_search"], input: ["text"] }).tools).toBeUndefined();
  });

  it.each([
    ["root boolean", { reasoning: false }],
    ["capability boolean", { capabilities: { reasoning: false } }],
    ["root alias", { supportsReasoning: false }],
    ["capability alias", { capabilities: { isReasoning: false } }],
    ["root thinking boolean", { thinking: false }],
    ["capability thinking boolean", { capabilities: { thinking: false } }],
    ["native thinking support", { capabilities: { thinking: { supported: false } } }],
    ["root nested support", { supports: { reasoning: false } }],
    ["capability nested support", { capabilities: { supports: { reasoning: false } } }],
    ["nested support alias", { capabilities: { supports: { supportsReasoning: false } } }],
  ])("does not let reasoning efforts override explicit false from %s", (_name, declaration) => {
    const caps = extractApiCapabilities({
      ...declaration, maxInput: 922000, defaultOutput: 131072,
      supported_reasoning_levels: [{ effort: "high" }],
    });
    expect(caps).toMatchObject({ reasoning: false, maxInput: 922000, defaultOutput: 131072 });
    expect(caps).not.toHaveProperty("contextWindow");
    expect(caps).not.toHaveProperty("maxOutput");
  });

  it("infers reasoning only from usable efforts when support is otherwise unknown", () => {
    expect(extractApiCapabilities({ supported_reasoning_levels: [{ effort: "high" }] })).toMatchObject({ reasoning: true });
    for (const raw of [{}, { supported_reasoning_levels: [] }, { supported_reasoning_levels: [null, {}, ""] }]) {
      expect(extractApiCapabilities(raw)).not.toHaveProperty("reasoning");
    }
    expect(extractApiCapabilities({ capabilities: { maxInput: 922000, defaultOutput: 131072 } }))
      .toEqual({ maxInput: 922000, defaultOutput: 131072 });
  });

  it("distinguishes native Anthropic windows from generic additive budgets", () => {
    const native = {
      max_input_tokens: 1000000, max_tokens: 128000,
      capabilities: { image_input: { supported: false }, thinking: { supported: true } },
    };
    expect(extractApiCapabilities(native)).toEqual({
      maxInput: 1000000, maxOutput: 128000, vision: false, reasoning: true,
    });
    expect(extractApiCapabilities(native, { format: "anthropic" })).toEqual({
      contextWindow: 1000000, maxInput: 1000000, maxOutput: 128000, vision: false, reasoning: true,
    });
    expect(extractApiCapabilities({
      max_input_tokens: 922000, max_output_tokens: 128000,
    })).toEqual({ contextWindow: 1050000, maxInput: 922000, maxOutput: 128000 });
    expect(extractApiCapabilities({
      capabilities: { limits: { max_prompt_tokens: 922000 } },
    })).toEqual({ maxInput: 922000 });
  });

  it("keeps native and curated Anthropic totals at one million through materialization/discovery", () => {
    const decoded = extractApiCapabilities({
      type: "model", max_input_tokens: 1000000, max_tokens: 128000,
    });
    expect(decoded).toEqual({ contextWindow: 1000000, maxInput: 1000000, maxOutput: 128000 });
    const native = materializeSyncedModel("anthropic", {
      id: "claude-future-metadata", kind: "llm", capabilities: decoded,
    });
    expect(native.capabilities).toMatchObject({ contextWindow: 1000000, maxInput: 1000000, maxOutput: 128000 });
    expect(projectDiscoveryMetadata(native)).toMatchObject({ max_model_len: 1000000, context_length: 1000000 });
    const curated = extractApiCapabilities({
      max_input_tokens: 1000000, max_tokens: 128000,
      capabilities: { contextWindow: 1000000 },
    });
    expect(curated).toEqual({ contextWindow: 1000000, maxInput: 1000000, maxOutput: 128000 });
  });

  it("retains total context separately from the input ceiling through native discovery", async () => {
    const model = materializeSyncedModel("codex", {
      id: "gpt-6.1-sol", kind: "llm", capabilities: { contextWindow: 272000 },
    });
    const response = await buildModelsResponse(new Request("http://localhost/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    }), [{ ...model, id: "cx/gpt-6.1-sol" }]).json();
    expect(extractLiveModelLimits(response.data[0])).toMatchObject({
      contextWindow: 1050000, maxInput: 922000, maxOutput: 128000,
    });
  });

  it("does not turn independent canonical ceilings into an additive discovery window", async () => {
    const model = { id: "unknown-window", capabilities: { maxInput: 1000000, maxOutput: 128000, defaultOutput: 32000 } };
    const projected = projectDiscoveryMetadata(model);
    expect(projected.capabilities).toMatchObject({ maxInput: 1000000, maxOutput: 128000, defaultOutput: 32000 });
    expect(projected).not.toHaveProperty("max_model_len");
    expect(projected.limits).toEqual({ max_output_tokens: 128000 });
    expect(extractLiveModelLimits(projected)).toEqual({ maxInput: 1000000, maxOutput: 128000, defaultOutput: 32000 });
    const native = await buildModelsResponse(new Request("http://localhost/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    }), [model]).json();
    expect(native.data[0]).toMatchObject({
      max_input_tokens: 1000000, max_tokens: 128000, max_context_window_tokens: null,
    });
    for (const options of [undefined, { format: "anthropic" }]) {
      expect(extractLiveModelLimits(native.data[0], options))
        .toEqual({ maxInput: 1000000, maxOutput: 128000 });
      const decoded = extractApiCapabilities(native.data[0], options);
      expect(decoded).toEqual({ maxInput: 1000000, maxOutput: 128000 });
      expect(projectDiscoveryMetadata({ id: model.id, capabilities: decoded }))
        .not.toHaveProperty("max_model_len");
    }
  });

  it("keeps explicit serialized limits above stale capability values in every envelope", async () => {
    const model = {
      id: "openai/operator-model", context_length: 1050000, max_completion_tokens: 128000,
      capabilities: { contextWindow: 272000, maxOutput: 64000, maxInput: 922000, tools: false },
    };
    const generic = await buildModelsResponse(new Request("http://localhost/v1/models"), [model]).json();
    expect(generic.data[0]).toMatchObject({
      max_model_len: 1050000, limits: { max_input_tokens: 922000, max_output_tokens: 128000 },
      capabilities: { contextWindow: 1050000, maxOutput: 128000 }, supportsTools: false,
    });
    const codex = await buildModelsResponse(new Request("http://localhost/v1/models", { headers: { originator: "codex_cli_rs" } }), [model]).json();
    expect(codex.models[0]).toMatchObject({ context_window: 1050000, max_output_tokens: 128000 });
    const anthropic = await buildModelsResponse(new Request("http://localhost/v1/models", { headers: { "anthropic-version": "" } }), [model]).json();
    expect(anthropic.data[0]).toMatchObject({ max_input_tokens: 922000, max_tokens: 128000 });
  });

  it("keeps native Anthropic limits/capabilities without OpenAI DTO fields or remote config", async () => {
    const model = {
      id: "kimi/kimi-k3", object: "model", owned_by: "kimi",
      capabilities: { contextWindow: 1048576, maxOutput: 1048576, defaultOutput: 131072, vision: true, reasoning: true, structuredOutput: false },
      headers: { Authorization: "secret-sentinel" }, baseUrl: "https://remote.invalid",
      apiKey: "!executable-sentinel", compat: { extraBody: { token: "secret-sentinel" } },
    };
    const native = await buildModelsResponse(new Request("http://localhost/v1/models", {
      headers: { "anthropic-version": "2023-06-01", originator: "codex_cli_rs" },
    }), [model]).json();
    expect(native).toMatchObject({ has_more: false, first_id: native.data[0].id, last_id: native.data[0].id });
    expect(native.models).toBeUndefined();
    expect(native.data[0]).toMatchObject({
      type: "model", max_input_tokens: 1048576, max_tokens: 1048576,
      capabilities: { image_input: { supported: true }, thinking: { supported: true }, structured_outputs: { supported: false } },
    });
    for (const key of ["object", "owned_by", "input", "limits", "context_length", "max_output_tokens", "headers", "baseUrl", "apiKey", "compat"]) {
      expect(native.data[0]).not.toHaveProperty(key);
    }
    const projected = projectDiscoveryMetadata(model);
    expect(projected.capabilities).toMatchObject({ maxOutput: 1048576, defaultOutput: 131072 });
    expect(JSON.stringify(projected)).not.toContain("sentinel");
    expect(projected).not.toHaveProperty("baseUrl");
  });

  it.each([
    ["OpenAI", {}],
    ["Codex", { originator: "codex_cli_rs" }],
  ])("serializes bounded thinking data and safe provider attribution for %s consumers", async (_name, headers) => {
    const model = {
      id: "gateway/budget-model", object: "model", created: 123, created_at: "2026-10-05T00:00:00Z",
      owned_by: "gateway", name: "Budget Model", display_name: "Budget Model Display", description: "Budget model description", kind: "llm",
      provider_name: "Upstream Provider", provider_alias: "gateway", gateway_provider: "gateway-provider",
      capabilities: {
        reasoning: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576, apiKey: "secret-sentinel" },
        headers: { Authorization: "secret-sentinel" }, config: { token: "secret-sentinel" },
      },
      headers: { Authorization: "secret-sentinel" }, endpoint: "https://secret-sentinel.invalid",
      baseUrl: "https://secret-sentinel.invalid", apiKey: "secret-sentinel",
      compat: { extraBody: { token: "secret-sentinel" } },
    };
    const body = await buildModelsResponse(new Request("http://localhost/v1/models", { headers }), [model]).json();
    const serialized = (body.data ?? body.models)[0];
    expect(serialized).toMatchObject({
      id: model.id, object: model.object, created: model.created, created_at: model.created_at,
      owned_by: model.owned_by, name: model.name, display_name: model.display_name,
      description: model.description, kind: model.kind,
      provider_name: model.provider_name, provider_alias: model.provider_alias, gateway_provider: model.gateway_provider,
      capabilities: { reasoning: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576 } },
    });
    expect(serialized.capabilities.thinkingRange).toEqual({ min: 0, max: 24576 });
    expect(JSON.stringify(body)).not.toContain("secret-sentinel");
    for (const key of ["headers", "endpoint", "baseUrl", "apiKey", "compat", "max_model_len", "max_output_tokens", "limits"]) {
      expect(serialized).not.toHaveProperty(key);
    }
  });

  it("preserves the resolved operator thinking range on the real info endpoint", async () => {
    dashboardDb.custom = [{
      id: "budget-info-model", providerAlias: getProviderAlias("openai"),
      capabilities: { reasoning: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 8192 } },
    }];
    const response = await getModelInfo(new Request(`http://localhost/v1/models/info?id=${getProviderAlias("openai")}/budget-info-model`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.capabilities).toMatchObject({
      reasoning: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 8192 },
    });
  });

  it.each([
    { min: -1, max: 1024 }, { min: 0, max: 0 }, { min: 2048, max: 1024 },
    { min: 0, max: 16777217 }, { min: 0.5, max: 1024 }, { min: 0, max: "1024" },
    { min: {}, max: 1024 }, [],
  ])("omits malformed thinking budget bounds from serialized discovery: %j", async (thinkingRange) => {
    const body = await buildModelsResponse(new Request("http://localhost/v1/models"), [{
      id: "invalid-range", provider_name: { apiKey: "secret-sentinel" },
      provider_alias: ["secret-sentinel"], gateway_provider: 123,
      capabilities: { thinkingRange },
    }]).json();
    expect(body.data[0].capabilities).not.toHaveProperty("thinkingRange");
    for (const key of ["provider_name", "provider_alias", "gateway_provider"]) expect(body.data[0]).not.toHaveProperty(key);
    expect(JSON.stringify(body)).not.toContain("secret-sentinel");
  });

  it("does not invent unknown ceilings for native or Codex clients", async () => {
    const model = { id: "unknown", capabilities: {} };
    const codex = await buildModelsResponse(new Request("http://localhost/v1/models", { headers: { originator: "codex_cli_rs" } }), [model]).json();
    expect(codex.models[0]).not.toHaveProperty("context_window");
    expect(codex.models[0]).not.toHaveProperty("max_output_tokens");
    const anthropic = await buildModelsResponse(new Request("http://localhost/v1/models", { headers: { "anthropic-version": "" } }), [model]).json();
    expect(anthropic.data[0]).toMatchObject({ max_input_tokens: null, max_tokens: null });
  });

  it("preserves Kimi's documented whole-window output ceiling across client envelopes", async () => {
    const model = { id: "kimi/kimi-k3", object: "model", owned_by: "kimi", capabilities: { contextWindow: 1048576, maxOutput: 1048576, vision: true, videoInput: true, tools: true, reasoning: true } };
    const generic = await buildModelsResponse(new Request("http://localhost/v1/models"), [model]).json();
    expect(generic.data[0]).toMatchObject({ max_model_len: 1048576, max_output_tokens: 1048576, input: ["text", "image", "video"], limits: { max_output_tokens: 1048576 } });
    const codex = await buildModelsResponse(new Request("http://localhost/v1/models", { headers: { originator: "codex_cli_rs" } }), [model]).json();
    expect(codex.models[0]).toMatchObject({ context_window: 1048576, max_output_tokens: 1048576 });
  });

  it("does not publish token limits for an unknown model", () => {
    const model = projectDiscoveryMetadata({ id: "unknown", capabilities: {} });
    expect(model.max_model_len).toBeUndefined();
    expect(model.max_output_tokens).toBeUndefined();
  });
});

describe("dashboard model metadata", () => {
  it("uses each provider's current synced roster, scoped enrichment and operator overrides", async () => {
    const id = "future-discovery-model";
    dashboardDb.catalogs = {
      openai: entry([
        { id, kind: "llm", capabilities: { contextWindow: 512000, tools: false, defaultOutput: 4096 } },
        { id: "unknown-discovery-model", kind: "llm" },
      ]),
      xai: entry([{ id, kind: "llm", capabilities: { contextWindow: 64000 } }]),
    };
    dashboardDb.settings = { modelAutoSyncProviders: { openai: true, xai: true } };
    dashboardDb.shared = {
      version: 1, fetchedAt: 1791201600000, source: "test-catalog",
      providers: {
        openai: {
          [id]: { maxInput: 480000, maxOutput: 32000, vision: true, tools: true },
          "not-account-accessible": { contextWindow: 1050000 },
        },
        xai: { [id]: { maxOutput: 8000, vision: false } },
      },
    };
    dashboardDb.custom = [{
      id, providerAlias: getProviderAlias("openai"),
      capabilities: { contextWindow: 96000, maxOutput: 16000 },
    }];
    const response = await getDashboardModels();
    const { models } = await response.json();
    expect(response.status).toBe(200);
    const openai = models.filter((model) => model.provider === getProviderAlias("openai"));
    expect(openai.map((model) => model.model)).toEqual([id, "unknown-discovery-model"]);
    expect(openai[0].caps).toMatchObject({
      contextWindow: 96000, maxInput: 480000, maxOutput: 16000,
      vision: true, tools: false, defaultOutput: 4096,
    });
    expect(openai[1].caps).not.toHaveProperty("contextWindow");
    expect(openai[1].caps).not.toHaveProperty("maxOutput");
    const xai = models.find((model) => model.provider === getProviderAlias("xai") && model.model === id);
    expect(xai.caps).toMatchObject({ contextWindow: 64000, maxOutput: 8000, vision: false });
    expect(models.some((model) => model.model === "not-account-accessible")).toBe(false);
  });
});

it("keeps static models when sync is disabled and preserves alias/disabled controls", async () => {
  const provider = getProviderAlias("openai");
  const disabledId = getModelsByProviderId("openai").find((model) => model.id !== "gpt-6.1-sol").id;
  dashboardDb.catalogs = { openai: entry([{ id: "disabled-sync-only-model", kind: "llm" }]) };
  dashboardDb.settings = { modelAutoSyncProviders: { openai: false } };
  dashboardDb.aliases = { [`${provider}/gpt-6.1-sol`]: "operator-sol" };
  dashboardDb.disabled = { [provider]: [disabledId] };
  const { models } = await (await getDashboardModels()).json();
  expect(models.some((model) => model.model === "disabled-sync-only-model")).toBe(false);
  expect(models.some((model) => model.provider === provider && model.model === disabledId)).toBe(false);
  expect(models.find((model) => model.provider === provider && model.model === "gpt-6.1-sol")).toMatchObject({
    alias: "operator-sol", caps: { contextWindow: 1050000, maxOutput: 128000 },
  });
});
