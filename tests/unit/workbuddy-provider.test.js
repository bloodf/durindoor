import { afterEach, describe, expect, it, vi } from "vitest";
import workbuddy from "../../src/lib/oauth/workbuddyProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("WorkBuddy device authorization", () => {
  it("starts authorization and consumes the one-shot token", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 0, data: { state: "state+1", authUrl: "https://www.workbuddy.ai/login" } }))
      .mockResolvedValueOnce(Response.json({ code: 11217, msg: "pending" }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { accessToken: "access", refreshToken: "refresh" } }));
    vi.stubGlobal("fetch", fetch);
    const device = await workbuddy.requestDeviceCode(workbuddy.config);
    expect(device.device_code).toBe("state+1");
    expect(fetch.mock.calls[0][0]).toContain("?platform=CLI");
    expect(await workbuddy.pollToken(workbuddy.config, device.device_code)).toEqual({ ok: false, data: { error: "authorization_pending" } });
    const result = await workbuddy.pollToken(workbuddy.config, device.device_code);
    expect(fetch.mock.calls[2][0]).toContain("state=state%2B1");
    expect(workbuddy.mapTokens(result.data)).toMatchObject({ accessToken: "access", refreshToken: "refresh" });
  });
});

import provider, { modelsConfig } from "../../open-sse/providers/private/workbuddy.js";
import { WorkbuddyExecutor } from "../../open-sse/executors/workbuddy.js";

it("keeps dispatch disabled until a connection opts in", async () => {
  const executor = new WorkbuddyExecutor();
  const result = await executor.execute({ body: {}, credentials: { providerSpecificData: {} } });
  expect(result.response.status).toBe(403);
  expect(await result.response.text()).toContain("enableSessionDispatch");
});

it("parses authenticated discovery without seeding a catalog", () => {
  expect(provider.models).toEqual([]);
  expect(modelsConfig.parseResponse({ data: { models: [{ id: "chat", name: "Chat" }, { id: "image", tags: ["text-to-image"] }] } })).toEqual([{ id: "chat", name: "Chat", owned_by: "workbuddy" }]);
});

const upstream = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/providers/registry/index.js", async (original) => {
  const registry = await original();
  const { default: entry } = await import("../../open-sse/providers/private/workbuddy.js");
  return { ...registry, default: [...registry.default, entry] };
});
vi.mock("../../open-sse/providers/index.js", async (original) => {
  const registry = await original();
  const { default: entry } = await import("../../open-sse/providers/private/workbuddy.js");
  return { ...registry, PROVIDERS: { ...registry.PROVIDERS, workbuddy: { ...entry.transport, authType: "oauth" } },
    PROVIDER_MODELS: { ...registry.PROVIDER_MODELS, workbuddy: [], wb: [] },
    PROVIDER_MEDIA: { ...registry.PROVIDER_MEDIA, workbuddy: { serviceKinds: ["llm"] } } };
});
vi.mock("../../open-sse/executors/index.js", async (original) => {
  const executors = await original();
  const { WorkbuddyExecutor: Executor } = await import("../../open-sse/executors/workbuddy.js");
  const instance = new Executor();
  return { ...executors, getExecutor: (id) => id === "workbuddy" ? instance : executors.getExecutor(id) };
});
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: upstream }));
vi.mock("../../src/app/api/providers/[id]/models/modelsConfig.js", async (original) => {
  const configs = await original();
  const { modelsConfig: config } = await import("../../open-sse/providers/private/workbuddy.js");
  return { ...configs, PROVIDER_MODELS_CONFIG: { ...configs.PROVIDER_MODELS_CONFIG, workbuddy: config } };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({ ...(await original()), createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })) }));
import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
async function chat(format, stream, token = "fixture-a", enabled = true) {
  const body = { model: "test-model", stream, messages: [{ role: "user", content: "hello" }], ...(format === "claude" ? { max_tokens: 32 } : {}) };
  return handleChatCore({ body, modelInfo: { provider: "workbuddy", model: "test-model" },
    credentials: { accessToken: token, providerSpecificData: { enableSessionDispatch: enabled } }, sourceFormatOverride: format,
    clientRawRequest: { endpoint: format === "claude" ? "/v1/messages" : "/v1/chat/completions", body: { ...body }, headers: {} },
    connectionId: token, log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
}

it.each([["openai", false], ["openai", true], ["claude", false], ["claude", true]])("routes %s stream=%s", async (format, stream) => {
  upstream.mockReset();
  upstream.mockResolvedValue(new Response('data: {"id":"one","object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\ndata: {"id":"one","object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  const result = await chat(format, stream);
  expect(result.success).toBe(true);
  expect(await result.response.text()).toContain("hello");
  expect(JSON.parse(upstream.mock.calls[0][1].body).stream).toBe(true);
});

it("refreshes using the connection's refresh token and preserves rotation", async () => {
  upstream.mockReset().mockResolvedValue(Response.json({ code: 0, data: { accessToken: "new", refreshToken: "rotated", expiresIn: 60 } }));
  const executor = new WorkbuddyExecutor();
  expect(await executor.refreshCredentials({ refreshToken: "refresh-a" })).toEqual({ accessToken: "new", refreshToken: "rotated", expiresIn: 60 });
  expect(upstream.mock.calls[0][1].headers["X-Refresh-Token"]).toBe("refresh-a");
});

it.each([401, 429])("preserves upstream status %s", async (status) => {
  upstream.mockReset().mockResolvedValue(Response.json({ error: { message: "fixture error" } }, { status, headers: { "retry-after": "3600" } }));
  const result = await chat("openai", false);
  expect(result.response.status).toBe(status);
});

it("isolates connection tokens and honors opt-in separately", async () => {
  upstream.mockReset().mockResolvedValue(new Response('data: {"id":"one","object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  const denied = await chat("openai", false, "fixture-b", false);
  expect(denied.response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
  await chat("openai", false, "fixture-a");
  upstream.mockResolvedValue(new Response('data: {"id":"two","object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  await chat("openai", false, "fixture-b");
  expect(upstream.mock.calls.map((call) => call[1].headers.Authorization)).toEqual(["Bearer fixture-a", "Bearer fixture-b"]);
});

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
it("discovers models with the connection token", async () => {
  upstream.mockReset().mockResolvedValue(Response.json({ code: 0, data: { models: [{ id: "model-a", name: "Model A" }] } }));
  const result = await fetchConnectionModels({ id: "a", provider: "workbuddy", accessToken: "fixture-a" });
  expect(result.models).toEqual([{ id: "model-a", name: "Model A", owned_by: "workbuddy" }]);
  expect(upstream.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-a");
});

it("repairs client identity and history for the gateway", () => {
  const executor = new WorkbuddyExecutor();
  const transformed = executor.transformRequest("model", { model: "model", messages: [{ role: "user", content: "Codex CLI" }] }, true, {}, {});
  expect(transformed.messages[0].role).toBe("system");
  expect(transformed.messages[1].content).toBe("the assistant");
});
