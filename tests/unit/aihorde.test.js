import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getProxyPools: vi.fn(),
  getProviderNodes: vi.fn(),
  getComboForModel: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  getCodexModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getProxyPools: mocks.getProxyPools,
  getProviderNodes: mocks.getProviderNodes,
  getComboForModel: mocks.getComboForModel,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: mocks.getCodexModels }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { parseModel } from "../../open-sse/services/model.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { handleChat } from "../../src/sse/handlers/chat.js";

const LIVE_MODEL_ID = "koboldcpp/Llama-3.2-3B";
const CHAT_FIXTURE = {
  id: "3c5d11fa-2ca8-4f6b-ab83-41fc9e4b7813",
  choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content: "OK." } }],
  created: 1788578094,
  model: LIVE_MODEL_ID,
  usage: { kudos: 2 },
  object: "chat.completion",
};
let restoreFetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearLiveModelLimitsCache();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getProviderConnectionById.mockResolvedValue(null);
  mocks.getApiKeyByKey.mockResolvedValue(null);
  mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ enforced: false, exceeded: false });
  mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
  mocks.getQuotaReservationPressure.mockResolvedValue(null);
  mocks.getProxyPools.mockResolvedValue([]);
  mocks.getProviderNodes.mockResolvedValue([]);
  mocks.getComboForModel.mockResolvedValue(null);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
  mocks.getCodexModels.mockResolvedValue([]);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  vi.unstubAllGlobals();
});

describe("AI Horde provider", () => {
  it("registers the official no-auth OpenAI facade with a dynamic-only catalog", () => {
    const provider = REGISTRY.find((entry) => entry.id === "aihorde");

    expect(provider).toMatchObject({
      alias: "horde",
      category: "free",
      noAuth: true,
      authType: "apikey",
      models: [],
      modelsFetcher: { url: "https://oai.aihorde.net/v1/models", type: "openai" },
      transport: {
        baseUrl: "https://oai.aihorde.net/v1/chat/completions",
        format: "openai",
        headers: { Authorization: "Bearer 0000000000" },
      },
    });
    expect(PROVIDER_MODELS.horde).toEqual([]);
    expect(new Set(REGISTRY.map((entry) => entry.id)).size).toBe(REGISTRY.length);
    expect(REGISTRY.filter((entry) => entry.alias === "horde" || entry.uiAlias === "horde")).toHaveLength(1);
  });

  it("preserves slash-containing model IDs and exposes no invented capabilities or limits", () => {
    expect(parseModel(`horde/${LIVE_MODEL_ID}`)).toMatchObject({
      provider: "aihorde",
      providerAlias: "horde",
      model: LIVE_MODEL_ID,
    });
    expect(getCapabilitiesForModel("aihorde", LIVE_MODEL_ID)).toMatchObject({
      vision: false,
      tools: false,
      reasoning: false,
      contextWindow: undefined,
      maxOutput: undefined,
    });
    expect(resolveModelLimits("aihorde", LIVE_MODEL_ID)).toEqual({
      contextWindow: undefined,
      maxOutput: undefined,
      known: false,
      source: "default",
    });
  });

  it("honors proven output-only limits without inventing a context window", () => {
    expect(resolveModelLimits("aihorde", LIVE_MODEL_ID, { maxOutput: 256 })).toEqual({
      contextWindow: undefined,
      maxOutput: 256,
      known: true,
      source: "custom",
    });
    expect(resolveModelLimits("horde", LIVE_MODEL_ID, null, null, { maxOutput: 128 })).toEqual({
      contextWindow: undefined,
      maxOutput: 128,
      known: true,
      source: "live",
    });
  });

  it("discovers the anonymous live catalog and maps its actual slash-containing ID", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      object: "list",
      data: [{ id: LIVE_MODEL_ID, object: "model", owned_by: "aihorde" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);

    const models = await buildModelsList([LLM_KIND]);
    const live = models.find((model) => model.id === `horde/${LIVE_MODEL_ID}`);

    expect(live).toMatchObject({
      id: `horde/${LIVE_MODEL_ID}`,
      owned_by: "horde",
      capabilities: { vision: false, tools: false, reasoning: false },
    });
    expect(live.context_length).toBeUndefined();
    expect(live.max_completion_tokens).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://oai.aihorde.net/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer 0000000000" }),
      }),
    );
  });

  it("routes the anonymous facade with selector-produced credentials and preserves saved keys", async () => {
    const executor = new DefaultExecutor("aihorde");
    const outboundFetch = vi.fn(async () => new Response(JSON.stringify(CHAT_FIXTURE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    restoreFetch = __setOriginalFetchForTesting(outboundFetch);

    const anonymous = await getProviderCredentials("aihorde", null, LIVE_MODEL_ID);
    expect(anonymous).toMatchObject({ id: "noauth", connectionId: "noauth", authType: "none" });
    const result = await executor.execute({
      model: LIVE_MODEL_ID,
      body: { model: LIVE_MODEL_ID, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 16 },
      credentials: anonymous,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const json = await result.response.json();

    expect(result.url).toBe("https://oai.aihorde.net/v1/chat/completions");
    expect(result.headers.Authorization).toBe("Bearer 0000000000");
    expect(JSON.parse(outboundFetch.mock.calls[0][1].body).max_tokens).toBe(16);
    expect(json).toMatchObject({ object: "chat.completion", model: LIVE_MODEL_ID });

    mocks.getProviderConnections.mockResolvedValueOnce([{
      id: "aihorde-saved",
      provider: "aihorde",
      apiKey: "aihorde-private-key",
      authType: "none",
      isActive: true,
      providerSpecificData: {},
    }]);
    const saved = await getProviderCredentials("aihorde", null, LIVE_MODEL_ID);
    expect(saved).toMatchObject({ connectionId: "aihorde-saved", apiKey: "aihorde-private-key", authType: "none" });
    expect(executor.buildHeaders(saved, false).Authorization).toBe("Bearer aihorde-private-key");
    expect(PROVIDERS.aihorde.headers.Authorization).toBe("Bearer 0000000000");
  });

  it("routes a live Horde model through handleChat without probing another provider", async () => {
    const outboundFetch = vi.fn(async (url) => {
      if (url === "https://oai.aihorde.net/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: LIVE_MODEL_ID }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(url).toBe("https://oai.aihorde.net/v1/chat/completions");
      return new Response(JSON.stringify(CHAT_FIXTURE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    restoreFetch = __setOriginalFetchForTesting(outboundFetch);

    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `horde/${LIVE_MODEL_ID}`,
        stream: false,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ object: "chat.completion", model: LIVE_MODEL_ID });
    const chatCalls = outboundFetch.mock.calls.filter(([url]) => url === "https://oai.aihorde.net/v1/chat/completions");
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0][1].headers.Authorization).toBe("Bearer 0000000000");
  });
});
