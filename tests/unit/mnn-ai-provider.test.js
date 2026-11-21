// MNN AI (https://mnnai.ru) exposes one documented OpenAI-compatible chat API.
//
// Every HTTP call in this file is a local mock: no MNN AI account, API key,
// plan, or billed request is involved, and nothing reaches api.mnnai.ru.
//
// First-party contract: https://mnnai.ru/docs
// Port source: OmniRoute release/v3.8.55
// (4624250231f49ed118fb4522a9d735e4894322c6),
// open-sse/config/providers/registry/mnn-ai/index.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { isModelAutoSyncEligible } from "../../src/lib/modelAutoSync/runner.js";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// The documented MNN AI endpoints: Bearer-authenticated chat completions and
// an authenticated model list.
const CHAT_URL = "https://api.mnnai.ru/v1/chat/completions";
const MODELS_URL = "https://api.mnnai.ru/v1/models";

// Synthetic placeholders. These are not credentials and were never issued by
// MNN AI.
const KEY_A = "mnn_synthetic_key_alpha";
const KEY_B = "mnn_synthetic_key_beta";

// Model ids named on https://mnnai.ru/docs, plus one the live catalog is
// expected to add later. Discovery must forward whatever the endpoint returns
// without rewriting it.
const DOCUMENTED_MODEL = "gpt-5.4";
const DISCOVERED_MODEL = "claude-4.6-sonnet";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sseResponse = (events) =>
  new Response(events.join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } });

const chatBody = (model, stream) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
  stream,
});

describe("MNN AI registry contract", () => {
  it("registers the documented OpenAI-compatible bearer transport", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "mnn-ai");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("mnn-ai");
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.passthroughModels).toBe(true);
    // The upstream catalog is empty on purpose: the live endpoint is the only
    // source of model ids, so nothing is seeded locally.
    expect(entry.models).toEqual([]);
    expect(PROVIDERS["mnn-ai"]).toMatchObject({
      baseUrl: CHAT_URL,
      validateUrl: MODELS_URL,
      format: "openai",
      authType: "apikey",
    });
    expect(PROVIDER_MEDIA["mnn-ai"].serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA["mnn-ai"].modelsFetcher).toEqual({ url: MODELS_URL, type: "openai" });
    expect(PROVIDER_MODELS["mnn-ai"]).toEqual([]);
  });

  it("is selectable as an API-key provider and eligible for live model discovery", () => {
    expect(APIKEY_PROVIDERS["mnn-ai"]).toMatchObject({
      id: "mnn-ai",
      alias: "mnn-ai",
      authType: "apikey",
      passthroughModels: true,
      defaultBaseUrl: CHAT_URL,
    });
    expect(APIKEY_PROVIDERS["mnn-ai"].modelsFetcher?.url).toBe(MODELS_URL);
    expect(isModelAutoSyncEligible("mnn-ai")).toBe(true);
    expect(resolveProviderAlias("mnn-ai")).toBe("mnn-ai");
  });

  it("keeps model IDs intact through model parsing and validation", () => {
    expect(parseModel("mnn-ai/gpt-5.4")).toMatchObject({
      provider: "mnn-ai",
      model: "gpt-5.4",
    });
    expect(isValidModel("mnn-ai", DOCUMENTED_MODEL)).toBe(true);
    expect(isValidModel("mnn-ai", DISCOVERED_MODEL)).toBe(true);
  });

  it("builds the upstream URL and Bearer headers without inventing another credential", () => {
    const executor = new DefaultExecutor("mnn-ai");
    expect(executor.buildUrl(DOCUMENTED_MODEL, false)).toBe(CHAT_URL);
    expect(executor.buildUrl(DOCUMENTED_MODEL, true)).toBe(CHAT_URL);
    expect(executor.buildHeaders({ apiKey: KEY_A }, false).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(executor.buildHeaders({}, false).Authorization).toBeUndefined();
  });
});

describe("MNN AI credential validation", () => {
  afterEach(() => vi.clearAllMocks());

  it("checks the stored key against the authenticated model list", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [{ id: DOCUMENTED_MODEL }] }));
    const result = await probeRegistryProvider("mnn-ai", KEY_A, fetcher);
    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(MODELS_URL);
    expect(options.headers.Authorization).toBe(`Bearer ${KEY_A}`);
  });

  it("rejects a credential the model list refuses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: { message: "invalid api key" } }, 401));
    const result = await probeRegistryProvider("mnn-ai", KEY_B, fetcher);
    expect(result).toMatchObject({ valid: false, status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("MNN AI model discovery route", () => {
  afterEach(() => vi.clearAllMocks());

  it("lists the live catalog for each connection with that connection's own key", async () => {
    routedFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: DOCUMENTED_MODEL }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: DISCOVERED_MODEL }] }));

    const first = await fetchConnectionModels({
      id: "mnn-ai-connection-a",
      provider: "mnn-ai",
      apiKey: KEY_A,
    });
    const second = await fetchConnectionModels({
      id: "mnn-ai-connection-b",
      provider: "mnn-ai",
      apiKey: KEY_B,
    });

    expect(first).toMatchObject({
      provider: "mnn-ai",
      connectionId: "mnn-ai-connection-a",
      models: [{ id: DOCUMENTED_MODEL }],
    });
    expect(second).toMatchObject({
      provider: "mnn-ai",
      connectionId: "mnn-ai-connection-b",
      models: [{ id: DISCOVERED_MODEL }],
    });

    expect(routedFetch).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = routedFetch.mock.calls[0];
    const [secondUrl, secondInit] = routedFetch.mock.calls[1];
    expect(firstUrl).toBe(MODELS_URL);
    expect(secondUrl).toBe(MODELS_URL);
    expect(firstInit.method).toBe("GET");
    expect(firstInit.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(secondInit.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    // Neither connection may fall back to the other connection's credential.
    expect(firstInit.headers.Authorization).not.toContain(KEY_B);
    expect(secondInit.headers.Authorization).not.toContain(KEY_A);
  });

  it("surfaces a rejected credential instead of an empty successful catalog", async () => {
    routedFetch.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    expect(
      await fetchConnectionModels({ id: "mnn-ai-connection-a", provider: "mnn-ai", apiKey: KEY_A }),
    ).toEqual({ error: "Failed to fetch models: 401", status: 401 });
  });

  it("surfaces a quota error instead of an empty successful catalog", async () => {
    routedFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limit exceeded" });
    expect(
      await fetchConnectionModels({ id: "mnn-ai-connection-a", provider: "mnn-ai", apiKey: KEY_A }),
    ).toEqual({ error: "Failed to fetch models: 429", status: 429 });
  });

  it("bounds discovery to one request and one deadline", async () => {
    routedFetch.mockResolvedValue(jsonResponse({ data: [{ id: DOCUMENTED_MODEL }] }));
    await fetchConnectionModels({
      id: "mnn-ai-connection-a",
      provider: "mnn-ai",
      apiKey: KEY_A,
    });
    // The MNN AI model list is a single unpaginated endpoint: one request, and
    // a deadline so a stalled upstream cannot hang the dashboard.
    expect(routedFetch).toHaveBeenCalledTimes(1);
    const [, init] = routedFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });
});

describe("MNN AI chat requests", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends a non-streaming request to the documented endpoint and keeps provider usage", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({
        id: "chatcmpl-mnnai",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }),
    );
    const executor = new DefaultExecutor("mnn-ai");
    const result = await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, false),
      stream: false,
      credentials: { apiKey: KEY_A },
    });

    expect(routedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = routedFetch.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(init.headers.Accept).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ model: DOCUMENTED_MODEL, stream: false });

    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toBe("hello");
    // The upstream reported the usage; DurinDoor must not invent a different one.
    expect(payload.usage).toEqual({ prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 });
  });

  it("keeps each connection on its own credential", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({
        id: "chatcmpl-mnnai",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    const executor = new DefaultExecutor("mnn-ai");
    await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, false),
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, false),
      stream: false,
      credentials: { apiKey: KEY_B },
    });

    expect(routedFetch).toHaveBeenCalledTimes(2);
    expect(routedFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(routedFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("asks for streaming, forwards SSE frames and asks the upstream for usage", async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "he" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "llo" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ];
    routedFetch.mockResolvedValue(sseResponse(events));
    const executor = new DefaultExecutor("mnn-ai");
    const result = await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, true),
      stream: true,
      credentials: { apiKey: KEY_A },
    });

    const [, init] = routedFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({
      model: DOCUMENTED_MODEL,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    const body = await result.response.text();
    expect(body).toContain('"content":"he"');
    expect(body).toContain("data: [DONE]");
  });

  it("passes an upstream credential rejection through as an error response", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({ error: { message: "Invalid API key", type: "invalid_request_error" } }, 401),
    );
    const executor = new DefaultExecutor("mnn-ai");
    const result = await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, false),
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    expect(result.response.status).toBe(401);
    const payload = await result.response.json();
    expect(payload.error.message).toBe("Invalid API key");
    expect(routedFetch).toHaveBeenCalledTimes(1);
  });

  it("passes an upstream quota error through without inventing a successful body", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({ error: { message: "Quota exceeded", type: "insufficient_quota" } }, 429),
    );
    const executor = new DefaultExecutor("mnn-ai");
    const result = await executor.execute({
      model: DOCUMENTED_MODEL,
      body: chatBody(DOCUMENTED_MODEL, false),
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    expect(result.response.status).toBe(429);
    const payload = await result.response.json();
    expect(payload.error.message).toBe("Quota exceeded");
    expect(payload.choices).toBeUndefined();
  });
});

describe("MNN AI streaming accounting", () => {
  afterEach(() => vi.clearAllMocks());

  it("records the token usage carried by the upstream stream", async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "he" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      })}`,
      "data: [DONE]",
    ];
    const providerResponse = sseResponse(events);
    const completion = buildOnStreamComplete({
      provider: "mnn-ai",
      model: DOCUMENTED_MODEL,
      connectionId: "mnn-ai-connection-a",
      requestStartTime: Date.now(),
      body: chatBody(DOCUMENTED_MODEL, true),
      stream: true,
      onRequestSuccess: vi.fn(),
      getProviderAttemptStartedAt: () => 1234,
    });
    const result = await handleStreamingResponse({
      provider: "mnn-ai",
      model: DOCUMENTED_MODEL,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: chatBody(DOCUMENTED_MODEL, true),
      stream: true,
      requestStartTime: Date.now(),
      connectionId: "mnn-ai-connection-a",
      streamController: createStreamController({ provider: "mnn-ai", model: DOCUMENTED_MODEL }),
      providerResponse,
      ...completion,
    });
    await result.response.text();
    await Promise.resolve();

    const detail = saveRequestDetail.mock.calls.at(-1)[0];
    expect(detail.tokens).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
  });
});
