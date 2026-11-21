/**
 * Y-API — offline acceptance for bloodf/durindoor#1249 (tracker #2034).
 *
 * Every upstream interaction in this file goes through an injected fake
 * transport. There is no live provider call, no paid service, no browser, no
 * stored credential and no Docker. The only things that leave the process are
 * the URLs and headers the gateway itself would send, asserted here.
 *
 * First-party contract under test (inspected 2026-11-20):
 *   https://y-api.bestvirtualgoods.com/docs
 *   https://y-api.bestvirtualgoods.com/docs/errors
 *   https://y-api.bestvirtualgoods.com/openapi.json
 *   https://y-api.bestvirtualgoods.com/terms
 *
 * Upstream parity reference: OmniRoute release/v3.8.55 @
 * 4624250231f49ed118fb4522a9d735e4894322c6,
 * open-sse/config/providers/registry/y-api/index.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import yApi from "../../open-sse/providers/registry/y-api.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_ID_TO_ALIAS, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { getProviderErrorRuleMatch } from "../../open-sse/config/providerErrorRules.js";
import { createErrorResult } from "../../open-sse/utils/error.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

// The discovery path resolves the connection's proxy configuration. No proxy
// pool is configured here, so the lookup must never reach a database.
vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async () => null),
}));

const CHAT_URL = "https://api.y-api.bestvirtualgoods.com/v1/chat/completions";
const MODELS_URL = "https://api.y-api.bestvirtualgoods.com/v1/models";
const MESSAGES_URL = "https://api.y-api.bestvirtualgoods.com/v1/messages";
const MODEL_ID = "deepseek/deepseek-v4-flash";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Every provider's reported usage carries this shared context buffer
// (open-sse/utils/usageTracking.js).
const BUFFER = 2000;

function credentialsFor(apiKey, runtimeTransport = null, connectionId = "y-api-connection") {
  return {
    apiKey,
    runtimeTransport,
    providerSpecificData: {},
    id: connectionId,
    connectionId,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completionBody(usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) {
  return {
    id: "chatcmpl-y-api",
    object: "chat.completion",
    created: 1732000000,
    model: MODEL_ID,
    choices: [{
      index: 0,
      message: { role: "assistant", content: "pong" },
      finish_reason: "stop",
    }],
    usage,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected upstream request in Y-API acceptance test");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Y-API registry entry", () => {
  it("publishes the documented id, endpoints and bearer scheme", () => {
    expect(yApi.id).toBe("y-api");
    expect(yApi.alias).toBe("y-api");
    expect(yApi.category).toBe("apikey");
    expect(yApi.authType).toBe("apikey");
    expect(yApi.passthroughModels).toBe(true);
    expect(PROVIDERS["y-api"]).toMatchObject({
      baseUrl: CHAT_URL,
      validateUrl: MODELS_URL,
      modelsUrl: MODELS_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    });
    expect(yApi.modelsFetcher).toEqual({ url: MODELS_URL, type: "openai" });
  });

  it("seeds no static catalog: ids are discovered, never guessed", () => {
    expect(yApi.models).toEqual([]);
    expect(PROVIDER_ID_TO_ALIAS["y-api"]).toBe("y-api");
    expect(resolveProviderAlias("y-api")).toBe("y-api");
    // The id is new on this tree: no other provider answers to it, and the
    // alias map keeps it a sibling of itself rather than a shorthand.
    expect(Object.values(PROVIDER_ID_TO_ALIAS)).not.toContain("y-api.y-api");
  });

  it("keeps a discovered vendor/model id intact on the wire", () => {
    const parsed = parseModel(`y-api/${MODEL_ID}`);
    expect(parsed.provider).toBe("y-api");
    expect(parsed.model).toBe(MODEL_ID);
  });
});

describe("Y-API request path (closed mock)", () => {
  it("sends each connection's own bearer token and nothing else", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(completionBody()));
    vi.stubGlobal("fetch", fetchMock);
    const executor = new DefaultExecutor("y-api");
    const transport = resolveTransport("y-api", "openai");

    await executor.execute({
      model: MODEL_ID,
      body: { model: MODEL_ID, messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: credentialsFor("sk-y-api-connection-a", transport, "connection-a"),
      log,
    });
    await executor.execute({
      model: MODEL_ID,
      body: { model: MODEL_ID, messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: credentialsFor("sk-y-api-connection-b", transport, "connection-b"),
      log,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(firstUrl).toBe(CHAT_URL);
    expect(secondUrl).toBe(CHAT_URL);
    expect(firstInit.headers.Authorization).toBe("Bearer sk-y-api-connection-a");
    expect(secondInit.headers.Authorization).toBe("Bearer sk-y-api-connection-b");
    // The Anthropic credential slot never leaks into the OpenAI route.
    expect(firstInit.headers["x-api-key"]).toBeUndefined();
    expect(secondInit.headers["x-api-key"]).toBeUndefined();
    // The model id reaches the provider exactly as discovered.
    expect(JSON.parse(firstInit.body).model).toBe(MODEL_ID);
    expect(JSON.parse(secondInit.body).model).toBe(MODEL_ID);
  });

  it("isolates the Anthropic alternate: x-api-key, no bearer, /v1/messages", async () => {
    const executor = new DefaultExecutor("y-api");
    const claudeTransport = resolveTransport("y-api", "claude");
    const openaiTransport = resolveTransport("y-api", "openai");
    expect(claudeTransport.baseUrl).toBe(MESSAGES_URL);
    expect(openaiTransport.baseUrl).toBe(CHAT_URL);

    const claudeHeaders = executor.buildHeaders(credentialsFor("sk-y-api-anthropic", claudeTransport), false);
    expect(claudeHeaders["x-api-key"]).toBe("sk-y-api-anthropic");
    expect(claudeHeaders.Authorization).toBeUndefined();
    // The provider documents `anthropic-version` on this route.
    expect(claudeHeaders["anthropic-version"]).toBe("2023-06-01");

    const openaiHeaders = executor.buildHeaders(credentialsFor("sk-y-api-openai", openaiTransport), false);
    expect(openaiHeaders.Authorization).toBe("Bearer sk-y-api-openai");
    expect(openaiHeaders["x-api-key"]).toBeUndefined();

    expect(executor.buildUrl(MODEL_ID, false, 0, credentialsFor("sk-y-api-anthropic", claudeTransport)))
      .toBe(MESSAGES_URL);
    expect(executor.buildUrl(MODEL_ID, false, 0, credentialsFor("sk-y-api-openai", openaiTransport)))
      .toBe(CHAT_URL);
  });

  it("offers both transports for every discovered y-api model", () => {
    // The catalog is discovered at runtime, so no static model row can carry
    // `supportedFormats`. The provider serves one catalog over both protocols,
    // so a discovered id is routable over either transport.
    expect(getModelSupportedFormats("y-api", MODEL_ID)).toEqual(["openai", "claude"]);
    expect(resolveTransport("y-api", "openai")?.format).toBe("openai");
    expect(resolveTransport("y-api", "claude")?.format).toBe("claude");
  });

  it("asks for a stream with the SSE accept header", async () => {
    const fetchMock = vi.fn(async () => new Response("", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const executor = new DefaultExecutor("y-api");
    const transport = resolveTransport("y-api", "openai");

    await executor.execute({
      model: MODEL_ID,
      // chatCore stamps the stream flag onto the translated body before the
      // executor is called; the executor forwards it unchanged.
      body: { model: MODEL_ID, messages: [{ role: "user", content: "ping" }], stream: true },
      stream: true,
      credentials: credentialsFor("sk-y-api-stream", transport),
      log,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body).stream).toBe(true);
  });
});

describe("Y-API error semantics", () => {
  const invalidKeyBody = {
    error: { message: "Invalid token (request id: 2026090114474514374)", type: "new_api_error", code: "" },
  };
  const accountQuotaBody = {
    error: { message: "用户额度不足, 剩余额度: ＄0.00", type: "new_api_error", code: "insufficient_user_quota" },
  };
  const keyQuotaBody = {
    error: { message: "token quota is not enough, token remain quota: ＄0.000002, need quota: ＄0.000074", type: "new_api_error", code: "pre_consume_token_quota_failed" },
  };
  const unknownModelBody = {
    error: { message: "No available channel for model gpt-4o under group y-api (distributor)", type: "new_api_error", code: "model_not_found" },
  };

  it("keeps an invalid or revoked key on the shared authentication policy", () => {
    // No provider rule: the documented 401 (`Invalid token`, empty error.code)
    // stays a plain authentication failure and is never read as quota.
    expect(getProviderErrorRuleMatch("y-api", 401, {}, invalidKeyBody)).toBeNull();
    const verdict = checkFallbackError(
      401,
      JSON.stringify(invalidKeyBody),
      0,
      "y-api",
      null,
      invalidKeyBody
    );
    expect(verdict.shouldFallback).toBe(true);
    expect(verdict.cooldownMs).toBe(COOLDOWN_MS.unauthorized);
  });

  it("treats an exhausted balance as a connection-scoped quota event", () => {
    expect(getProviderErrorRuleMatch("y-api", 403, {}, accountQuotaBody)).toEqual({
      reason: "quota_exhausted",
      scope: "connection",
    });
    const verdict = checkFallbackError(
      403,
      JSON.stringify(accountQuotaBody),
      0,
      "y-api",
      null,
      accountQuotaBody
    );
    expect(verdict.shouldFallback).toBe(true);
    expect(verdict.scope).toBe("connection");
  });

  it("treats an exhausted per-key cap as a connection-scoped quota event", () => {
    expect(getProviderErrorRuleMatch("y-api", 403, {}, keyQuotaBody)).toEqual({
      reason: "quota_exhausted",
      scope: "connection",
    });
  });

  it("leaves 429 throttling on the shared rate-limit policy", () => {
    const throttled = { error: { message: "rate limit", type: "rate_limit_error", code: "rate_limit_exceeded" } };
    // No y-api rule claims 429: throttling is transient and recovers on its
    // own, so it must not be reported as an exhausted balance.
    expect(getProviderErrorRuleMatch("y-api", 429, {}, throttled)).toBeNull();
    const verdict = checkFallbackError(429, JSON.stringify(throttled), 0, "y-api", null, throttled);
    expect(verdict.shouldFallback).toBe(true);
    expect(verdict.scope).toBeNull();
  });

  it("locks only the requested model when the id is not in the catalog", () => {
    const rule = getProviderErrorRuleMatch("y-api", 503, {}, unknownModelBody);
    expect(rule).toMatchObject({ scope: "model" });
    expect(rule.scope).not.toBe("connection");
    expect(rule.cooldownMs).toBeGreaterThan(0);
  });

  it("keeps the quota code on the wire and redacts the connection key", async () => {
    // The provider's reason code reaches the client unchanged, so a client can
    // tell a credit problem from a throttle, while the connection key never
    // appears in the response body.
    const result = createErrorResult(
      403,
      "用户额度不足, 剩余额度: ＄0.00",
      null,
      { error: { message: "用户额度不足, 剩余额度: ＄0.00 sk-y-api-secret", type: "new_api_error", code: "insufficient_user_quota" } },
      null,
      { apiKey: "sk-y-api-secret" },
      403
    );
    const body = await result.response.json();
    expect(result.status).toBe(403);
    expect(body.error.code).toBe("insufficient_user_quota");
    expect(JSON.stringify(body)).not.toContain("sk-y-api-secret");
    expect(body.error.message).toContain("[redacted]");
  });
});

describe("Y-API response, usage and discovery", () => {
  const encoder = new TextEncoder();
  const onRequestSuccess = vi.fn();
  const onEmptyStream = vi.fn();

  /** The provider's documented SSE shape: OpenAI frames plus a literal [DONE]. */
  function providerFrames() {
    return [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "po" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ng" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\n`,
      "data: [DONE]\n\n",
    ];
  }

  /** Run one Y-API streaming request against the closed mock and return the client wire. */
  async function runProviderStream(model) {
    onRequestSuccess.mockClear();
    onEmptyStream.mockClear();
    const upstream = new ReadableStream({
      start(controller) {
        for (const frame of providerFrames()) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    const credentials = credentialsFor("sk-y-api-stream", resolveTransport("y-api", "openai"));
    const completion = buildOnStreamComplete({
      provider: "y-api",
      model,
      connectionId: "y-api-connection",
      apiKey: "sk-y-api-stream",
      requestStartTime: Date.now(),
      body: { model, messages: [] },
      stream: true,
      credentials,
      onRequestSuccess,
      onEmptyStream,
      getProviderAttemptStartedAt: () => 1732000000,
      terminalProvenance: "upstream",
    });
    const streamController = createStreamController({
      provider: "y-api",
      model,
      onComplete: () => {},
      onError: () => {},
      onDisconnect: () => {},
    });

    const result = await handleStreamingResponse({
      provider: "y-api",
      model,
      connectionId: "y-api-connection",
      apiKey: "sk-y-api-stream",
      requestStartTime: Date.now(),
      body: { model, messages: [] },
      stream: true,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      credentials,
      streamController,
      onStreamComplete: vi.fn((...args) => completion.onStreamComplete(...args)),
      onRequestSuccess,
      onEmptyStream,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      log,
      providerResponse: new Response(upstream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    });

    expect(result.success).toBe(true);
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let wire = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      wire += decoder.decode(value, { stream: true });
    }
    wire += decoder.decode();
    return wire;
  }

  function dataFrames(wire) {
    return wire.split(/\r?\n\r?\n/)
      .filter((block) => block.startsWith("data: ") && !block.includes("[DONE]"))
      .map((block) => JSON.parse(block.slice("data: ".length)));
  }

  function contentDeltas(wire) {
    return dataFrames(wire).map((payload) => payload.choices?.[0]?.delta?.content || "").join("");
  }

  function terminalChunk(wire) {
    const frames = dataFrames(wire);
    return frames[frames.length - 1];
  }

  it("returns the provider-reported usage to an OpenAI client", async () => {
    const providerResponse = {
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify(completionBody())),
      status: 200,
      statusText: "OK",
    };
    const result = await handleNonStreamingResponse({
      providerResponse,
      provider: "y-api",
      model: MODEL_ID,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: MODEL_ID, messages: [] },
      stream: false,
      streamToClient: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("pong");
    // The provider's own counts, plus the shared context buffer every
    // provider's usage carries (open-sse/utils/usageTracking.js).
    expect(body.usage).toMatchObject({
      prompt_tokens: 11 + BUFFER,
      completion_tokens: 7,
      total_tokens: 18 + BUFFER,
    });
  });

  it("forwards the provider's OpenAI-shaped SSE frames to the client", async () => {
    const wire = await runProviderStream("moonshotai/kimi-k2.5");
    // The provider's OpenAI-shaped frames reach the client: the content arrives
    // as incremental deltas, the terminal chunk carries the provider's usage,
    // and the provider's literal [DONE] sentinel closes the stream.
    expect(contentDeltas(wire)).toBe("pong");
    expect(terminalChunk(wire)).toMatchObject({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    expect(terminalChunk(wire)?.usage).toMatchObject({
      prompt_tokens: 11 + BUFFER,
      completion_tokens: 7,
      total_tokens: 18 + BUFFER,
    });
    expect(wire).toContain("[DONE]");
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it("ends the client stream cleanly for a DeepSeek-family catalog id", async () => {
    // A Y-API id that matches the DeepSeek family takes the gateway's own
    // DeepSeek stream path, where the gateway terminates the client stream
    // itself instead of relaying the provider's sentinel. The client still
    // receives every frame and a clean end of stream.
    const wire = await runProviderStream("deepseek/deepseek-v4-flash");
    expect(contentDeltas(wire)).toBe("pong");
    expect(terminalChunk(wire)?.usage).toMatchObject({
      completion_tokens: 7,
      total_tokens: 18,
    });
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it.each([200, 401, 429])("validates credentials through the catalog only (HTTP %i)", async (status) => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }, status));
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeRegistryProvider("y-api", "sk-y-api-probe");

    expect(result).toMatchObject({ valid: status === 200, status });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(MODELS_URL, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-y-api-probe" }),
      redirect: "manual",
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock.mock.calls[0][1].headers["x-api-key"]).toBeUndefined();
  });

  it("discovers the catalog with the same bearer key and keeps vendor/model ids", async () => {
    expect(yApi.modelsFetcher.url).toBe(MODELS_URL);

    const calls = [];
    const fetchMock = vi.fn(async (url, options) => {
      calls.push({ url, options });
      // The provider omits the OpenAI `"object": "list"` marker on /v1/models;
      // discovery keys off `data` only, so the missing marker is not an error.
      return jsonResponse({
        data: [
          { id: MODEL_ID, object: "model" },
          { id: "moonshotai/kimi-k2.5", object: "model" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchConnectionModels({
      id: "y-api-connection",
      provider: "y-api",
      apiKey: "sk-y-api-discovery",
      providerSpecificData: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.models.map((model) => model.id)).toEqual([
      MODEL_ID,
      "moonshotai/kimi-k2.5",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(MODELS_URL);
    expect(calls[0].options.headers.Authorization).toBe("Bearer sk-y-api-discovery");
    // The discovery request is bounded: it carries its own timeout signal.
    expect(calls[0].options.signal).toBeDefined();
  });
});
