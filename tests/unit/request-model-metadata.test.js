import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(),
  getSyncedModelCatalog: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
  getCachedSharedModelMetadata: vi.fn(),
  getProviderNodes: vi.fn(),
  getCachedLiveLimits: vi.fn(),
  countInputTokens: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getCustomModels: mocks.getCustomModels,
  getSyncedModelCatalog: mocks.getSyncedModelCatalog,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
  getCachedSharedModelMetadata: mocks.getCachedSharedModelMetadata,
  saveCachedSharedModelMetadata: vi.fn(),
  getProviderNodes: mocks.getProviderNodes,
  getModelAliases: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => []),
  getComboForModel: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("../../open-sse/services/openrouterCatalog.js", () => ({
  getOpenRouterModelCapabilities: vi.fn(() => null),
}));
vi.mock("../../open-sse/services/liveModelLimits.js", () => ({
  getCachedLiveLimits: mocks.getCachedLiveLimits,
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: async () => null,
    resolveEffectiveOutputReservation: (body, context) => executor.resolveEffectiveOutputReservation(body, context),
  }),
}));
vi.mock("../../open-sse/handlers/countTokensCore.js", () => ({
  estimateTokens: () => 1,
  countInputTokens: mocks.countInputTokens,
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {},
    logProviderResponse() {}, logConvertedResponse() {}, logError() {},
  }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null,
  isNativePassthrough: () => false,
  isCodexOriginatedHeaders: () => false,
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: () => ({
    signal: undefined, startTime: Date.now(), isConnected: () => true,
    handleComplete() {}, handleError() {}, handleDisconnect() {}, abort() {},
  }),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: (value) => value,
  extractRequestConfig: () => ({}),
  extractUsageFromResponse: () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
  saveUsageStats: vi.fn(),
}));
vi.mock("../../open-sse/utils/error.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createErrorResult: (status, error) => ({ success: false, status, error }),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: () => () => {},
  handleStreamingResponse: async () => ({ success: true }),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: () => null, record() {}, finishTrace() {}, attachClientFrameTap() {},
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest() {}, appendRequestLog: async () => {}, saveRequestDetail: async () => {},
  finishActiveSession: vi.fn(),
}));

import { BaseExecutor } from "../../open-sse/executors/base.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";
import { isDeterministicPayloadError } from "../../open-sse/services/modelFallback.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { loadCustomCapabilities } from "../../src/sse/services/model.js";
import { GET, HEAD } from "../../src/app/api/v1/models/info/route.js";

const executor = new BaseExecutor("openai", {});
const catalog = (models) => ({ syncedAt: "2026-10-05T12:00:00Z", models });
const shared = (providers) => ({ version: 1, fetchedAt: 1_791_201_600_000, providers });
const imageBody = () => ({
  messages: [{ role: "user", content: [
    { type: "text", text: "Describe this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ] }],
});
const info = (id, kind = null) => new Request(`http://localhost/v1/models/info?id=${encodeURIComponent(id)}${kind ? `&kind=${kind}` : ""}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getSyncedModelCatalog.mockResolvedValue(null);
  mocks.getSyncedModelCatalogs.mockResolvedValue({});
  mocks.getCachedSharedModelMetadata.mockResolvedValue(null);
  mocks.getProviderNodes.mockResolvedValue([]);
  mocks.getCachedLiveLimits.mockReturnValue(null);
  mocks.countInputTokens.mockResolvedValue({ tokens: 10, approximate: true });
  mocks.execute.mockImplementation(async ({ body, requestContext }) => {
    // Kimi's native Messages route needs a coherent Claude envelope. OpenAI
    // forces streaming and uses the streaming-handler mock above instead.
    const nativeMessages = Array.isArray(body.messages?.[0]?.content);
    const payload = nativeMessages
      ? { id: "msg_test", type: "message", role: "assistant", model: body.model,
          content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 1 } }
      : { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] };
    return {
      response: new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
      url: "https://upstream.invalid/v1/chat/completions",
      headers: {},
      transformedBody: executor.clampCustomMaxOutput(structuredClone(body), requestContext),
    };
  });
});

describe("scoped request metadata", () => {
  it("uses cached modalities for stripping and Vision Bridge, with operator overrides above live/shared flags", async () => {
    mocks.getCachedSharedModelMetadata.mockResolvedValue(shared({ openai: { "future-chat": { vision: false, contextWindow: 512000 } } }));
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "future-chat", kind: "llm", capabilities: { vision: true, maxOutput: 8192 } }]));
    const caps = await loadCustomCapabilities("openai", "future-chat", "openai");
    const body = imageBody();
    stripUnsupportedModalities(body, "openai", caps);
    expect(body.messages[0].content).toEqual(imageBody().messages[0].content);
    expect(applyVisionBridgeReroute({ body, modelStr: "openai/future-chat", capabilities: caps,
      settings: { visionBridgeEnabled: true, visionBridgeModel: "openai/gpt-4o" } }).rerouted).toBe(false);
    expect(caps.customKeys.size).toBe(0);

    mocks.getCustomModels.mockResolvedValue([{ id: "future-chat", providerAlias: "openai", capabilities: { vision: false, maxOutput: 4096 } }]);
    const overridden = await loadCustomCapabilities("openai", "future-chat", "openai");
    const textOnly = imageBody();
    stripUnsupportedModalities(textOnly, "openai", overridden);
    expect(textOnly.messages[0].content.some((part) => part.type === "image_url")).toBe(false);
    expect(overridden.contextWindow).toBe(512000);
    expect(overridden.maxOutput).toBe(4096);
    expect([...overridden.customKeys]).toEqual(["vision", "maxOutput"]);
    expect(JSON.parse(JSON.stringify(overridden))).not.toHaveProperty("customKeys");
  });

  it("does not borrow another provider's shared metadata or operator row via a misleading prefix", async () => {
    mocks.getCachedSharedModelMetadata.mockResolvedValue(shared({ xai: { "future-chat": { vision: true, contextWindow: 900000 } } }));
    mocks.getCustomModels.mockResolvedValue([{ id: "future-chat", providerAlias: "xai", capabilities: { vision: true } }]);
    expect(await loadCustomCapabilities("openai", "future-chat", "xai")).toBeNull();
    expect((await GET(info("openai/future-chat"))).status).toBe(404);
  });

  it("does not materialize shared-only ids as available request models", async () => {
    mocks.getCachedSharedModelMetadata.mockResolvedValue(shared({ openai: {
      "not-listed": { contextWindow: 4096, maxOutput: 1024, vision: true },
    } }));
    expect(await loadCustomCapabilities("openai", "not-listed", "openai")).toBeNull();
    expect((await GET(info("openai/not-listed"))).status).toBe(404);
    expect((await HEAD(info("openai/not-listed"))).status).toBe(404);
  });

  it("retains usable cached metadata when the custom-row lookup fails", async () => {
    mocks.getCustomModels.mockRejectedValue(new Error("custom catalog unavailable"));
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "future-chat", kind: "llm", capabilities: { contextWindow: 4096, vision: true } }]));
    const body = imageBody();
    stripUnsupportedModalities(body, "openai", await loadCustomCapabilities("openai", "future-chat", null));
    expect(body.messages[0].content.some((part) => part.type === "image_url")).toBe(true);
    const metadata = await (await GET(info("openai/future-chat"))).json();
    expect(metadata.contextWindow).toBe(4096);
    expect(metadata).not.toHaveProperty("maxOutput");
    expect(metadata.capabilities).not.toHaveProperty("maxOutput");
  });

  it("retains explicit operator limits when both optional metadata caches fail", async () => {
    mocks.getSyncedModelCatalog.mockRejectedValue(new Error("synced catalog unavailable"));
    mocks.getCachedSharedModelMetadata.mockRejectedValue(new Error("shared catalog unavailable"));
    mocks.getCustomModels.mockResolvedValue([{ id: "operator-chat", providerAlias: "openai", capabilities: { contextWindow: 4096, maxOutput: 1024 } }]);
    const caps = await loadCustomCapabilities("openai", "operator-chat", null);
    expect(caps).toMatchObject({ contextWindow: 4096, maxOutput: 1024 });
    expect([...caps.customKeys]).toEqual(["contextWindow", "maxOutput"]);
  });

  it("retains shared limits and operator flags when synced lookup fails", async () => {
    mocks.getSyncedModelCatalog.mockRejectedValue(new Error("synced catalog unavailable"));
    mocks.getCachedSharedModelMetadata.mockResolvedValue(shared({ openai: {
      "operator-chat": { contextWindow: 4096, maxOutput: 1024, vision: true },
    } }));
    mocks.getCustomModels.mockResolvedValue([{ id: "operator-chat", providerAlias: "openai",
      capabilities: { vision: false } }]);
    const caps = await loadCustomCapabilities("openai", "operator-chat", null);
    expect(caps).toMatchObject({ contextWindow: 4096, maxOutput: 1024, vision: false });
    expect([...caps.customKeys]).toEqual(["vision"]);
    const metadata = await (await GET(info("openai/operator-chat"))).json();
    expect(metadata).toMatchObject({ endpoint: "/v1/chat/completions",
      contextWindow: 4096, maxOutput: 1024, capabilities: { vision: false },
      limits: { max_output_tokens: 1024 } });
  });

  it("finds node-prefix operator rows without inheriting a similarly named cloud provider", async () => {
    mocks.getCustomModels.mockResolvedValue([{ id: "private-chat", providerAlias: "private-node", capabilities: { contextWindow: 8192, vision: true } }]);
    mocks.getProviderNodes.mockImplementation(async ({ type }) => type === "openai-compatible"
      ? [{ id: "openai-compatible-private", prefix: "private-node" }] : []);
    const caps = await loadCustomCapabilities("openai-compatible-private", "private-chat", null);
    expect(caps.contextWindow).toBe(8192);
    expect(caps.maxOutput).toBeUndefined();
    expect([...caps.customKeys]).toEqual(["contextWindow", "vision"]);
  });
});

describe("metadata info discovery", () => {
  it("keeps Codex API capacity at request time and on canonical-provider info lookups", async () => {
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "gpt-6.1-sol", kind: "llm",
      capabilities: { contextWindow: 272000, vision: true } }]));
    const caps = await loadCustomCapabilities("codex", "gpt-6.1-sol", "cx");
    expect(caps).toMatchObject({ contextWindow: 1050000, maxInput: 922000, maxOutput: 128000 });
    expect(caps.customKeys.size).toBe(0);
    const canonical = await (await GET(info("codex/gpt-6.1-sol"))).json();
    const aliased = await (await GET(info("cx/gpt-6.1-sol"))).json();
    expect(canonical).toMatchObject({ contextWindow: 1050000, maxOutput: 128000 });
    expect(aliased.contextWindow).toBe(canonical.contextWindow);
  });

  it("applies canonical cached/operator metadata to documented inbound model aliases", async () => {
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "k3", kind: "llm", capabilities: { vision: false } }]));
    mocks.getCustomModels.mockResolvedValue([{ id: "k3", providerAlias: "kimi-coding", capabilities: { maxOutput: 4096 } }]);
    const caps = await loadCustomCapabilities("kimi-coding", "k3[1m]", "kimi-coding");
    const body = imageBody();
    stripUnsupportedModalities(body, "openai", caps);
    expect(body.messages[0].content.some((part) => part.type === "image_url")).toBe(false);
    expect(caps.maxOutput).toBe(4096);
    expect([...caps.customKeys]).toEqual(["maxOutput"]);
    const aliased = await (await GET(info("kimi-coding/k3[1m]"))).json();
    const canonical = await (await GET(info("kimi-coding/k3"))).json();
    expect(aliased).toEqual(canonical);
    expect(aliased).toMatchObject({ id: "kimi-coding/k3", kind: "llm", endpoint: "/v1/chat/completions", maxOutput: 4096 });
    expect((await HEAD(info("kimi-coding/k3[1m]"))).status).toBe(200);
  });

  it("returns new synced models with rich modalities and identical GET/HEAD presence", async () => {
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "future-chat", kind: "llm", capabilities: {
      contextWindow: 512000, maxInput: 500000, maxOutput: 12000, vision: true, videoInput: true, tools: true,
    } }]));
    const response = await GET(info("openai/future-chat"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "openai/future-chat", endpoint: "/v1/chat/completions", contextWindow: 512000, maxOutput: 12000,
      input_modalities: ["text", "image", "video"], supportsTools: true,
      limits: { max_input_tokens: 500000, max_output_tokens: 12000 },
    });
    expect((await HEAD(info("openai/future-chat"))).status).toBe(200);
    expect((await HEAD(info("openai/not-listed"))).status).toBe(404);
  });

  it.each([
    { request: new Request("http://localhost/v1/models/info"), status: 400 },
    { request: info("openai/not-listed"), status: 404 },
    { request: info("openai/gpt-6.1-sol", "image"), status: 404 },
    { request: info("openai/gpt-6.1-sol", "llm"), status: 200 },
  ])("keeps GET and bodyless HEAD status $status in agreement", async ({ request, status }) => {
    const get = await GET(request);
    const head = await HEAD(request);
    expect(get.status).toBe(status);
    expect(head.status).toBe(status);
    expect(await head.text()).toBe("");
    expect(get.headers.get("access-control-allow-origin")).toBe("*");
    expect(head.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("does not invent limits for an operator-listed model or confuse duplicate endpoint kinds", async () => {
    mocks.getCustomModels.mockResolvedValue([
      null,
      { id: "unbounded-private", providerAlias: "openai", kind: "image", capabilities: { imageOutput: true, vision: true } },
      { id: "unbounded-private", providerAlias: "openai", kind: "llm", capabilities: { vision: false } },
    ]);
    const llm = await (await GET(info("openai/unbounded-private", "llm"))).json();
    expect(llm.endpoint).toBe("/v1/chat/completions");
    expect(llm.capabilities.vision).toBe(false);
    for (const key of ["contextWindow", "maxOutput", "context_length", "max_output_tokens"]) expect(llm).not.toHaveProperty(key);
    expect(llm.capabilities).not.toHaveProperty("contextWindow");
    const image = await (await GET(info("openai/unbounded-private", "image"))).json();
    expect(image.endpoint).toBe("/v1/images/generations");
    expect(image.capabilities.imageOutput).toBe(true);
  });

  it("keeps image operations as an array and never spreads them into numeric flags", async () => {
    const body = await (await GET(info("codex/gpt-5.6-sol-image", "image"))).json();
    expect(body.operations).toEqual(["text2img", "edit"]);
    expect(body.capabilities).not.toHaveProperty("0");
    expect(body.capabilities).not.toHaveProperty("1");
    expect(body.endpoint).toBe("/v1/images/generations");
  });
});

function markedCaps(caps, keys = []) {
  Object.defineProperty(caps, "customKeys", { value: new Set(keys), enumerable: false });
  return caps;
}
function chatOptions(provider, model, caps, fields = {}) {
  const body = { model, stream: false, messages: [{ role: "user", content: "Hello" }], ...fields };
  return { body, modelInfo: { provider, model }, modelCapabilities: caps,
    credentials: { providerSpecificData: {} }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} } };
}

describe("maximum versus actual/default output reservation", () => {
  it("reserves Kimi K3's documented default rather than its context-sized maximum", async () => {
    mocks.getSyncedModelCatalog.mockResolvedValue(catalog([{ id: "kimi-k3", kind: "llm" }]));
    const caps = await loadCustomCapabilities("kimi", "kimi-k3", "kimi");
    expect(executor.resolveEffectiveOutputReservation({}, { modelCapabilities: caps })).toBe(131072);
    const result = await handleChatCore(chatOptions("kimi", "kimi-k3", caps));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledOnce();
    const dispatch = mocks.execute.mock.calls[0][0];
    expect(dispatch.body.max_tokens).toBe(131072);
    expect(executor.resolveEffectiveOutputReservation(dispatch.body, dispatch.requestContext)).toBe(131072);
  });

  it("accepts a no-cap prompt up to the published context boundary when no default is known", async () => {
    const caps = markedCaps({ contextWindow: 4096, maxOutput: 4096 });
    mocks.countInputTokens.mockResolvedValue({ tokens: 4096, approximate: true });
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps));
    expect(result.success).toBe(true);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("uses the native documented default even without supplied request metadata", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: 10, approximate: true });
    const result = await handleChatCore(chatOptions("kimi", "kimi-k3", undefined));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(mocks.execute.mock.calls[0][0].body.max_tokens).toBe(131072);
  });

  it.each([
    { input: 917504, accepted: true },
    { input: 917505, accepted: false },
  ])("reserves the native documented default at $input input tokens", async ({ input, accepted }) => {
    mocks.countInputTokens.mockResolvedValue({ tokens: input, approximate: true });
    const result = await handleChatCore(chatOptions("kimi", "kimi-k3", undefined));
    if (accepted) {
      expect(result.success).toBe(true);
      expect(mocks.execute.mock.calls[0][0].body.max_tokens).toBe(131072);
    } else {
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(result.error).toMatch(/\+ 131072 output reservation/);
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  });

  it.each([
    { input: 3584, accepted: true },
    { input: 3585, accepted: false },
  ])("checks the documented-default boundary at $input input tokens", async ({ input, accepted }) => {
    const caps = markedCaps({ contextWindow: 4096, maxOutput: 4096, defaultOutput: 512 });
    mocks.countInputTokens.mockResolvedValue({ tokens: input, approximate: true });
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps));
    if (accepted) {
      expect(result.success).toBe(true);
    } else {
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(result.error).toMatch(/\+ 512 output reservation/);
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  });

  it("rejects input alone beyond the context window deterministically without dispatch", async () => {
    const caps = markedCaps({ contextWindow: 4096, maxOutput: 4096 });
    mocks.countInputTokens.mockResolvedValue({ tokens: 4097, approximate: true });
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps));
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(isDeterministicPayloadError(result.status, result.error)).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("enforces a separately published maxInput even when total context still fits", async () => {
    const caps = markedCaps({ contextWindow: 4096, maxInput: 3000, maxOutput: 4096 });
    mocks.countInputTokens.mockResolvedValue({ tokens: 3001, approximate: true });
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps));
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(/3000-token input length/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("uses the same explicit-output ceiling for preflight and dispatch, preserving operator precedence", async () => {
    mocks.getCachedLiveLimits.mockReturnValue({ contextWindow: 16384, maxOutput: 8192 });
    const caps = markedCaps({ contextWindow: 4096, maxOutput: 1024 }, ["contextWindow", "maxOutput"]);
    mocks.countInputTokens.mockResolvedValue({ tokens: 3072, approximate: true });
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps, { max_tokens: 20000 }));
    expect(result.success).toBe(true);
    const dispatch = mocks.execute.mock.calls[0][0];
    const sent = executor.clampCustomMaxOutput(structuredClone(dispatch.body), dispatch.requestContext);
    expect(sent.max_tokens).toBe(1024);
    expect(executor.resolveEffectiveOutputReservation(sent, dispatch.requestContext)).toBe(1024);
    expect([...dispatch.requestContext.modelCapabilities.customKeys]).toEqual(["contextWindow", "maxOutput"]);
  });

  it("still reserves an explicit operator cap on requests without a body output field", async () => {
    const caps = markedCaps({ contextWindow: 4096, maxOutput: 4096, defaultOutput: 512 }, ["maxOutput"]);
    const result = await handleChatCore(chatOptions("openai", "future-chat", caps));
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(/\+ 4096 output reservation/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reserves the sent executor default ahead of a provider default, bounded by the ceiling", () => {
    const withDefault = new BaseExecutor("openai", { requestDefaults: { maxTokens: 1024 } });
    const context = { modelCapabilities: markedCaps({ maxOutput: 2048, defaultOutput: 512 }) };
    expect(withDefault.resolveEffectiveOutputReservation({}, context)).toBe(1024);
    context.modelCapabilities.maxOutput = 768;
    expect(withDefault.resolveEffectiveOutputReservation({}, context)).toBe(768);
    expect(executor.resolveEffectiveOutputReservation({}, context)).toBe(512);
  });
});
