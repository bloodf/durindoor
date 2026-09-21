import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getComboForModel: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

import {
  OPENROUTER_MODELS_URL,
  clearOpenRouterCatalogCache,
  getOpenRouterModelCapabilities,
  isOpenRouterFreeModel,
  mapOpenRouterModel,
  resolveOpenRouterModels,
} from "../../open-sse/services/openrouterCatalog.js";
import { resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { getKnownContextWindow } from "../../open-sse/services/combo/contextRequirements.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import { loadCustomCapabilities } from "../../src/sse/services/model.js";

// Shapes copied from the live https://openrouter.ai/api/v1/models response.
const GEMMA_FREE = {
  id: "google/gemma-4-31b-it:free",
  name: "Google: Gemma 4 31B (free)",
  context_length: 262144,
  architecture: { input_modalities: ["image", "text", "video"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" },
  top_provider: { context_length: 262144, max_completion_tokens: 32768, is_moderated: false },
  supported_parameters: ["max_tokens", "reasoning", "include_reasoning", "tool_choice", "tools"],
};
const GLM_FREE_TEXT = {
  id: "z-ai/glm-5.2:free",
  name: "Z.ai: GLM 5.2 (free)",
  context_length: 32768,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" },
  top_provider: { context_length: 32768, max_completion_tokens: 29491 },
  supported_parameters: ["max_tokens", "temperature"],
};
const PAID = {
  id: "openai/gpt-4o",
  name: "OpenAI: GPT-4o",
  context_length: 128000,
  architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
  pricing: { prompt: "0.0000025", completion: "0.00001" },
  top_provider: { max_completion_tokens: 16384 },
  supported_parameters: ["tools"],
};
const ZERO_PRICE_NO_SUFFIX = { ...GLM_FREE_TEXT, id: "google/lyria-3-pro-preview" };
const VARIABLE_ROUTER = { ...GLM_FREE_TEXT, id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } };

const catalog = (data) => ({ data });
function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

beforeEach(() => {
  clearOpenRouterCatalogCache();
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isOpenRouterFreeModel", () => {
  it("requires both the :free suffix and all-zero pricing", () => {
    expect(isOpenRouterFreeModel(GEMMA_FREE)).toBe(true);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { prompt: 0, completion: 0, request: "0" } })).toBe(true);
    expect(isOpenRouterFreeModel(ZERO_PRICE_NO_SUFFIX)).toBe(false);
    expect(isOpenRouterFreeModel(VARIABLE_ROUTER)).toBe(false);
    expect(isOpenRouterFreeModel(PAID)).toBe(false);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { prompt: "0", completion: "0.000001" } })).toBe(false);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { prompt: "0", completion: "0", request: "0.01" } })).toBe(false);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: undefined })).toBe(false);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: {} })).toBe(false);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { prompt: "", completion: "0" } })).toBe(false);
    expect(isOpenRouterFreeModel(null)).toBe(false);
    // Live rows carry nested `pricing.overrides` records; they are not this variant's fee.
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { prompt: "0", completion: "0", overrides: { "some-provider": { prompt: "0.1" } } } })).toBe(true);
    expect(isOpenRouterFreeModel({ ...GEMMA_FREE, pricing: { overrides: {} } })).toBe(false);
  });
});

describe("mapOpenRouterModel", () => {
  it("maps limits, modalities and supported_parameters onto capability fields", () => {
    expect(mapOpenRouterModel(GEMMA_FREE)).toEqual({
      id: "google/gemma-4-31b-it:free",
      name: "Google: Gemma 4 31B (free)",
      free: true,
      capabilities: {
        contextWindow: 262144,
        maxOutput: 32768,
        vision: true,
        pdf: false,
        audioInput: false,
        videoInput: true,
        imageOutput: false,
        audioOutput: false,
        tools: true,
        reasoning: true,
      },
    });
    const text = mapOpenRouterModel(GLM_FREE_TEXT).capabilities;
    expect(text).toMatchObject({ contextWindow: 32768, maxOutput: 29491, vision: false, tools: false, reasoning: false });
    expect(mapOpenRouterModel(PAID)).toMatchObject({ free: false, capabilities: { pdf: true, vision: true, maxOutput: 16384 } });
  });

  it("falls back to top_provider.context_length, drops bad limits and tags embeddings", () => {
    const model = mapOpenRouterModel({
      id: "x/embed:free",
      context_length: null,
      top_provider: { context_length: 8192, max_completion_tokens: -5 },
      architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] },
    });
    expect(model.capabilities.contextWindow).toBe(8192);
    expect(model.capabilities.maxOutput).toBeUndefined();
    expect(model.kind).toBe("embedding");
    expect(model.name).toBe("x/embed:free");
    expect(mapOpenRouterModel({ id: "" })).toBeNull();
    expect(mapOpenRouterModel("nope")).toBeNull();
  });
});

describe("resolveOpenRouterModels", () => {
  it("fetches the public catalog with no credentials and never follows redirects", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(catalog([GEMMA_FREE, PAID])));
    await resolveOpenRouterModels({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENROUTER_MODELS_URL);
    expect(new URL(url).host).toBe("openrouter.ai");
    expect(init.redirect).toBe("error");
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(JSON.stringify(init)).not.toMatch(/sk-or|Bearer/);
  });

  it("filters to free models and caches within the TTL, refetching after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    const fetchImpl = vi.fn(async () => jsonResponse(catalog([GEMMA_FREE, PAID, ZERO_PRICE_NO_SUFFIX])));
    const free = await resolveOpenRouterModels({ freeOnly: true, fetchImpl });
    expect(free.map((m) => m.id)).toEqual(["google/gemma-4-31b-it:free"]);
    const all = await resolveOpenRouterModels({ fetchImpl });
    expect(all).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-01T00:29:00Z"));
    await resolveOpenRouterModels({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-09-01T00:31:00Z"));
    await resolveOpenRouterModels({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes into one request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(catalog([GEMMA_FREE])));
    await Promise.all([resolveOpenRouterModels({ fetchImpl }), resolveOpenRouterModels({ fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["network error", async () => { throw new Error("offline"); }],
    ["non-2xx", async () => new Response("nope", { status: 503 })],
    ["invalid JSON", async () => new Response("{not json", { status: 200 })],
    ["missing data array", async () => jsonResponse({ models: "x" })],
    ["declared oversize body", async () => new Response("{}", { status: 200, headers: { "content-length": String(9 * 1024 * 1024) } })],
    ["actual oversize body", async () => new Response(`{"data":[],"pad":"${"x".repeat(8 * 1024 * 1024)}"}`, { status: 200 })],
  ])("fails open with null on %s", async (_label, fetchImpl) => {
    await expect(resolveOpenRouterModels({ fetchImpl })).resolves.toBeNull();
  });

  it("caps the number of mapped entries", async () => {
    const data = Array.from({ length: 2500 }, (_, i) => ({ ...GLM_FREE_TEXT, id: `m/model-${i}:free` }));
    const models = await resolveOpenRouterModels({ fetchImpl: async () => jsonResponse(catalog(data)) });
    expect(models).toHaveLength(2000);
  });

  it("keeps the last good catalog through a failed refresh and retries after the failure TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    await resolveOpenRouterModels({ fetchImpl: async () => jsonResponse(catalog([GEMMA_FREE])) });
    vi.setSystemTime(new Date("2026-09-01T00:31:00Z"));
    const failing = vi.fn(async () => { throw new Error("offline"); });
    const stale = await resolveOpenRouterModels({ fetchImpl: failing });
    expect(stale.map((m) => m.id)).toEqual([GEMMA_FREE.id]);
    expect(getOpenRouterModelCapabilities(GEMMA_FREE.id)).toMatchObject({ vision: true });
    await resolveOpenRouterModels({ fetchImpl: failing });
    expect(failing).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-09-01T00:37:00Z"));
    await resolveOpenRouterModels({ fetchImpl: failing });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("suggested-models openrouter-free filter", () => {
  it("returns only free chat models with their context windows", () => {
    const embed = { ...GLM_FREE_TEXT, id: "x/embed:free", architecture: { output_modalities: ["embeddings"] } };
    expect(FILTERS["openrouter-free"]([GEMMA_FREE, PAID, ZERO_PRICE_NO_SUFFIX, VARIABLE_ROUTER, embed, null])).toEqual([
      { id: "google/gemma-4-31b-it:free", name: "Google: Gemma 4 31B (free)", contextLength: 262144 },
    ]);
    expect(FILTERS["openrouter-free"]("bad")).toEqual([]);
  });
});

describe("discovered capabilities reach routing", () => {
  beforeEach(async () => {
    mocks.getCustomModels.mockResolvedValue([]);
    await resolveOpenRouterModels({ fetchImpl: async () => jsonResponse(catalog([GEMMA_FREE, GLM_FREE_TEXT])) });
  });

  it("loadCustomCapabilities merges live caps over the static table for openrouter only", async () => {
    const caps = await loadCustomCapabilities("openrouter", GEMMA_FREE.id, "openrouter");
    expect(caps).toMatchObject({ vision: true, videoInput: true, tools: true, reasoning: true, contextWindow: 262144 });
    // Live limits must not masquerade as operator-set custom limits.
    expect(caps.customKeys.size).toBe(0);
    expect(await loadCustomCapabilities("openrouter", "unknown/model:free", "openrouter")).toBeNull();
    expect(await loadCustomCapabilities("groq", GEMMA_FREE.id, "groq")).toBeNull();
  });

  it("a custom model row still wins over discovered capabilities", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { id: GEMMA_FREE.id, providerAlias: "openrouter", capabilities: { vision: false } },
    ]);
    const caps = await loadCustomCapabilities("openrouter", GEMMA_FREE.id, "openrouter");
    expect(caps.vision).toBe(false);
  });

  it("keeps images for a vision model and strips them for a text-only one", async () => {
    const body = () => ({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
    });
    const visionBody = body();
    stripUnsupportedModalities(visionBody, "openai", await loadCustomCapabilities("openrouter", GEMMA_FREE.id, "openrouter"));
    expect(visionBody.messages[0].content.some((p) => p.type === "image_url")).toBe(true);
    const textBody = body();
    stripUnsupportedModalities(textBody, "openai", await loadCustomCapabilities("openrouter", GLM_FREE_TEXT.id, "openrouter"));
    expect(textBody.messages[0].content.some((p) => p.type === "image_url")).toBe(false);
  });

  it("Vision Bridge treats a discovered vision model as vision-capable", async () => {
    const caps = await loadCustomCapabilities("openrouter", GEMMA_FREE.id, "openrouter");
    const result = applyVisionBridgeReroute({
      body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] },
      modelStr: `openrouter/${GEMMA_FREE.id}`,
      settings: { visionBridgeEnabled: true, visionBridgeModel: "openai/gpt-4o" },
      capabilities: caps,
    });
    expect(result.rerouted).toBe(false);
  });

  it("combo context filtering uses the published window over family patterns", async () => {
    // Static `*glm-5*` says 200000; the catalog publishes 32768.
    expect(getKnownContextWindow(`openrouter/${GLM_FREE_TEXT.id}`)).toBe(32768);
    const caps = await loadCustomCapabilities("openrouter", GLM_FREE_TEXT.id, "openrouter");
    const map = new Map([[`openrouter/${GLM_FREE_TEXT.id}`, caps]]);
    expect(getKnownContextWindow(`openrouter/${GLM_FREE_TEXT.id}`, map)).toBe(32768);
    expect(getKnownContextWindow("openrouter/unknown/model:free")).not.toBe(32768);
  });

  it("context-limit preflight resolves the published window as a live limit", () => {
    const limits = resolveModelLimits("openrouter", GLM_FREE_TEXT.id, null, null, getOpenRouterModelCapabilities(GLM_FREE_TEXT.id));
    expect(limits).toMatchObject({ contextWindow: 32768, maxOutput: 29491, known: true, source: "live" });
  });
});

describe("/v1/models", () => {
  beforeEach(() => {
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("lists discovered free models with capabilities next to the static rows", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" }]);
    const fetchMock = vi.fn(async () => jsonResponse(catalog([GEMMA_FREE, PAID])));
    vi.stubGlobal("fetch", fetchMock);
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const models = await buildModelsList(["llm"]);
    const gemma = models.find((m) => m.id === `openrouter/${GEMMA_FREE.id}`);
    expect(gemma.capabilities).toMatchObject({ vision: true, tools: true, contextWindow: 262144 });
    expect(models.some((m) => m.id === "openrouter/openai/gpt-4o")).toBe(false);
    const embeddings = await buildModelsList(["embedding"]);
    expect(embeddings.some((m) => m.id === "openrouter/openai/text-embedding-3-large")).toBe(true);
    for (const [, init] of fetchMock.mock.calls) expect(JSON.stringify(init ?? {})).not.toContain("sk-or-secret");
  });

  it("with an explicit selection, only enriches the selected models", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "c1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret",
      providerSpecificData: { enabledModels: ["openai/gpt-4o"] },
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(catalog([GEMMA_FREE, PAID]))));
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).toContain("openrouter/openai/gpt-4o");
    expect(ids).not.toContain(`openrouter/${GEMMA_FREE.id}`);
    const gpt = (await buildModelsList(["llm"])).find((m) => m.id === "openrouter/openai/gpt-4o");
    expect(gpt.capabilities).toMatchObject({ pdf: true, maxOutput: 16384 });
  });

  it("falls back to the static list when the catalog is unreachable", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", provider: "openrouter", isActive: true, apiKey: "sk-or-secret" }]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const embeddings = await buildModelsList(["embedding"]);
    expect(embeddings.some((m) => m.id === "openrouter/openai/text-embedding-3-large")).toBe(true);
    expect((await buildModelsList(["llm"])).some((m) => m.id.endsWith(":free") && m.id.startsWith("openrouter/google"))).toBe(false);
  });
});
