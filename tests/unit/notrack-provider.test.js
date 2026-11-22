import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
const saveRequestUsage = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage,
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "fixture",
  updateKimchiUserAgent: vi.fn(),
}));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildRegistryProviderProbe, probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { getProviderConnectionById } from "@/models";
import { GET as getConnectionModels } from "../../src/app/api/providers/[id]/models/route.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS, isRoutableProvider } from "../../src/shared/constants/providers.js";
import { parseModel } from "../../open-sse/services/model.js";

const MODEL = "notrack-uncensored";
const KEY_A = "sk-notrack-fixture-account-a";
const KEY_B = "sk-notrack-fixture-account-b";
const CHAT_URL = "https://api.notrack.ai/v1/chat/completions";
const MODELS_URL = "https://api.notrack.ai/v1/models";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sse = (frames) =>
  new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
const chatBody = (stream = false) => ({
  model: MODEL,
  stream,
  messages: [
    { role: "system", content: "Be brief" },
    { role: "user", content: "Question" },
  ],
});
const execute = (options = {}) =>
  getExecutor("notrack").execute({
    model: MODEL,
    body: chatBody(false),
    stream: false,
    credentials: { apiKey: KEY_A },
    ...options,
  });
const chatCoreOptions = (options = {}) => {
  const body = chatBody(options.stream === true);
  return {
    body,
    modelInfo: { provider: "notrack", model: MODEL },
    credentials: { apiKey: KEY_A },
    connectionId: "account-a",
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: options.stream === true ? "text/event-stream" : "application/json" },
    },
    sourceFormatOverride: FORMATS.OPENAI,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...options,
  };
};

beforeEach(() => {
  transport.mockReset();
  saveRequestUsage.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Unexpected network");
  }));
});
afterEach(() => vi.unstubAllGlobals());

// Mocked responses prove local wiring only. They are not live discovery, key
// validation or inference evidence for notrack.ai.
describe("NoTrack developer API provider (mocked, not live proof)", () => {
  it("publishes the developer identity in the dashboard picker and the model catalog", () => {
    expect(AI_PROVIDERS.notrack.name).toBe("NoTrack");
    expect(AI_PROVIDERS.notrack.notice.apiKeyUrl).toBe("https://notrack.ai/api-keys");
    expect(APIKEY_PROVIDERS.notrack).toBeDefined();
    expect(isRoutableProvider("notrack")).toBe(true);
    expect(getProviderModels("notrack").map((model) => model.id)).toEqual([MODEL]);
    expect(parseModel("notrack/notrack-uncensored")).toMatchObject({ provider: "notrack", model: MODEL });
  });

  it("stays a separate identity from the consumer web session", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "notrack");
    expect(entry.transport.baseUrl).toBe(CHAT_URL);
    expect(entry.transport.baseUrl).not.toContain("notrack.ai/api/dispatch");
    // The consumer route (cookie auth, model `notrack-c`, alias `ntw`) is its own provider,
    // `notrack-web` (registration batch C, #2034): this API-key integration never claims it.
    const ids = REGISTRY.map((candidate) => candidate.id);
    const aliases = REGISTRY.flatMap((candidate) => [candidate.alias, candidate.uiAlias, ...(candidate.aliases || [])]);
    expect(ids.filter((id) => id === "notrack" || id === "notrack-web").sort()).toEqual(["notrack", "notrack-web"]);
    expect(aliases.filter((alias) => alias === "ntw")).toHaveLength(1);
    expect([entry.alias, entry.uiAlias, ...(entry.aliases || [])]).not.toContain("ntw");
    expect(JSON.stringify(entry.transport)).not.toContain("/api/dispatch");
    const web = REGISTRY.find((candidate) => candidate.id === "notrack-web");
    expect(web).toMatchObject({ alias: "ntw", category: "webCookie", authType: "cookie", transport: { baseUrl: "https://notrack.ai/api/dispatch" } });
    // Only the web session dispatches to the consumer route.
    expect(REGISTRY.filter((candidate) => JSON.stringify(candidate.transport || {}).includes("notrack.ai/api/dispatch")).map((candidate) => candidate.id)).toEqual(["notrack-web"]);
    expect(entry.transport.baseUrl.startsWith("https://api.notrack.ai/v1")).toBe(true);
  });

  it("sends the documented base URL, bearer key and no consumer cookie", async () => {
    transport.mockResolvedValueOnce(json({ id: "chatcmpl-1", object: "chat.completion", model: MODEL, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }] }));
    await execute();
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(init.headers.Cookie).toBeUndefined();
    expect(Object.keys(init.headers).map((key) => key.toLowerCase())).not.toContain("cookie");
    expect(JSON.parse(init.body)).toMatchObject({ model: MODEL, messages: chatBody(false).messages });
  });

  it("keeps separately scoped keys on their own connection", async () => {
    transport.mockResolvedValue(json({ id: "chatcmpl-1", object: "chat.completion", model: MODEL, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }] }));
    await execute({ credentials: { apiKey: KEY_A } });
    await execute({ credentials: { apiKey: KEY_B } });
    expect(transport.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([
      `Bearer ${KEY_A}`,
      `Bearer ${KEY_B}`,
    ]);
    // Neither key leaks into the other account's request body.
    expect(transport.mock.calls[1][1].body).not.toContain(KEY_A);
  });

  it("requests usage in the streamed request and answers JSON with the provider-reported usage", async () => {
    transport.mockResolvedValueOnce(json({
      id: "chatcmpl-1",
      object: "chat.completion",
      model: MODEL,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
      usage: { prompt_tokens: 41, completion_tokens: 118, total_tokens: 159 },
    }));
    const result = await handleChatCore(chatCoreOptions());
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
    // The client-facing input count carries the gateway's standard input
    // buffer; the completion count stays the number NoTrack reported.
    expect(body.usage.completion_tokens).toBe(118);
    expect(body.usage.prompt_tokens).toBeGreaterThan(41);
    expect(body.usage.total_tokens).toBe(body.usage.prompt_tokens + body.usage.completion_tokens);
    // The accounted ledger row keeps the provider-reported counts.
    expect(saveRequestUsage).toHaveBeenCalled();
    expect(saveRequestUsage.mock.calls.at(-1)[0]).toMatchObject({
      provider: "notrack",
      model: MODEL,
      tokens: expect.objectContaining({ prompt_tokens: 41, completion_tokens: 118 }),
    });
  });

  it("streams server-sent events and reports the usage chunk NoTrack always sends", async () => {
    transport.mockResolvedValueOnce(sse([
      { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Ev" } }] },
      { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "ening" } }] },
      { id: "chatcmpl-1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 41, completion_tokens: 118, total_tokens: 159 } },
    ]));
    const result = await handleChatCore(chatCoreOptions({ stream: true }));
    expect(result.success).toBe(true);
    const text = await result.response.text();
    const frames = text.split("\n\n").filter((frame) => frame.startsWith("data: {")).map((frame) => JSON.parse(frame.slice(6)));
    expect(frames.map((frame) => frame.choices?.[0]?.delta?.content || "").join("")).toBe("Evening");
    expect(frames.at(-1).usage).toEqual({ prompt_tokens: 41, completion_tokens: 118, total_tokens: 159 });
    expect(text).toContain("[DONE]");
    expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("discovers the developer catalog through the connection models route", async () => {
    getProviderConnectionById.mockResolvedValue({ id: "account-a", provider: "notrack", apiKey: KEY_A });
    transport.mockResolvedValueOnce(json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "notrack" }] }));
    const response = await getConnectionModels(
      new Request("http://localhost/api/providers/account-a/models"),
      { params: Promise.resolve({ id: "account-a" }) },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.models.map((model) => model.id)).toEqual([MODEL]);
    expect(transport).toHaveBeenCalledWith(MODELS_URL, expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: `Bearer ${KEY_A}` }),
    }), expect.anything());
  });

  it("surfaces a discovery failure instead of inventing a catalog", async () => {
    getProviderConnectionById.mockResolvedValue({ id: "account-a", provider: "notrack", apiKey: KEY_A });
    transport.mockResolvedValueOnce(json({ error: { type: "invalid_key", message: "unknown key" } }, 401));
    const response = await getConnectionModels(
      new Request("http://localhost/api/providers/account-a/models"),
      { params: Promise.resolve({ id: "account-a" }) },
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("401");
  });

  it("validates the key against the developer catalog endpoint", async () => {
    const probe = buildRegistryProviderProbe("notrack", KEY_A);
    expect(probe.url).toBe(MODELS_URL);
    expect(probe.options.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    const fetcher = vi.fn().mockResolvedValueOnce(json({ object: "list", data: [] }));
    expect(await probeRegistryProvider("notrack", KEY_A, fetcher)).toMatchObject({ valid: true });
    const rejected = vi.fn().mockResolvedValueOnce(json({ error: { type: "invalid_key", message: "unknown key" } }, 401));
    expect(await probeRegistryProvider("notrack", KEY_A, rejected)).toMatchObject({ valid: false, status: 401 });
  });

  it.each([
    [401, "invalid_key", "unknown key"],
    [402, "no_credit", "no credit left on this account"],
    [402, "key_daily_cap", "daily ceiling reached"],
    [403, "content_policy", "refused"],
    [429, "rate_limit", "slow down"],
    [429, "concurrency", "too many parallel requests"],
  ])("preserves the documented %s %s failure", async (status, type, message) => {
    transport.mockResolvedValueOnce(json({ error: { type, message } }, status));
    const result = await handleChatCore(chatCoreOptions());
    expect(result.status).toBe(status);
  });

  it("does not echo the saved key in an upstream failure", async () => {
    transport.mockResolvedValueOnce(json({ error: { type: "invalid_key", message: "unknown key" } }, 401));
    const result = await handleChatCore(chatCoreOptions());
    expect(result.status).toBe(401);
    const body = await result.response.text();
    expect(body).not.toContain(KEY_A);
    expect(body).toContain("unknown key");
  });

  it("rejects a 400 body error without spending a request", async () => {
    transport.mockResolvedValueOnce(json({ error: { type: "body", message: "invalid JSON or no messages" } }, 400));
    const { response } = await execute();
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("invalid JSON or no messages");
  });
});
