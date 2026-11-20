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
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Runcrate exposes one OpenAI-compatible chat API
// (https://www.runcrate.ai/chat-api). Every HTTP call below is a local mock:
// no Runcrate account, key, GPU instance or billed service is involved.
// Source: OmniRoute release/v3.8.55
// (4624250231f49ed118fb4522a9d735e4894322c6),
// open-sse/config/providers/registry/runcrate/index.ts.
const CHAT_URL = "https://api.runcrate.ai/v1/chat/completions";
const MODELS_URL = "https://api.runcrate.ai/v1/models";
const UPSTREAM_CATALOG = [
  "deepseek-ai/DeepSeek-V4.1-Flash",
  "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "zai-org/GLM-5.3",
  "zai-org/GLM-5.3-Flash",
  "Qwen/Qwen3.8-Flash",
  "openai/gpt-oss-120b",
];
const SYNTHETIC_KEY = "rc_live_synthetic_test_key";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sseResponse = (events) =>
  new Response(events.join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } });

const chatBody = (model, stream) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
  stream,
});

describe("Runcrate registry contract", () => {
  it("registers the OpenAI-compatible bearer transport and the upstream catalog", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "runcrate");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(PROVIDERS.runcrate).toMatchObject({
      baseUrl: CHAT_URL,
      validateUrl: MODELS_URL,
      format: "openai",
      authType: "apikey",
    });
    expect(PROVIDER_MODELS.runcrate.map((model) => model.id)).toEqual(UPSTREAM_CATALOG);
    expect(PROVIDER_MEDIA.runcrate.serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA.runcrate.modelsFetcher).toEqual({ url: MODELS_URL, type: "openai" });
    expect(resolveProviderAlias("runcrate")).toBe("runcrate");
  });

  it("is selectable as an API-key provider and eligible for live model discovery", () => {
    expect(APIKEY_PROVIDERS.runcrate).toMatchObject({
      id: "runcrate",
      alias: "runcrate",
      authType: "apikey",
      passthroughModels: true,
    });
    expect(APIKEY_PROVIDERS.runcrate.modelsFetcher?.url).toBe(MODELS_URL);
    expect(isModelAutoSyncEligible("runcrate")).toBe(true);
  });

  it("keeps publisher-prefixed model IDs intact through model parsing and validation", () => {
    expect(parseModel("runcrate/deepseek-ai/DeepSeek-V4.1-Flash")).toMatchObject({
      provider: "runcrate",
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
    });
    expect(parseModel("runcrate/Qwen/Qwen3.8-Flash")).toMatchObject({
      provider: "runcrate",
      model: "Qwen/Qwen3.8-Flash",
    });
    expect(isValidModel("runcrate", "deepseek-ai/DeepSeek-V4.1-Flash")).toBe(true);
    expect(PROVIDER_MODELS.runcrate.some((model) => model.id === "Qwen/Qwen3.8-Flash")).toBe(true);
  });

  it("builds the upstream URL and Bearer headers without inventing another credential", () => {
    const executor = new DefaultExecutor("runcrate");
    expect(executor.buildUrl("deepseek-ai/DeepSeek-V4.1-Flash", false)).toBe(CHAT_URL);
    expect(executor.buildHeaders({ apiKey: SYNTHETIC_KEY }, false).Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    expect(executor.buildHeaders({}, false).Authorization).toBeUndefined();
  });
});

describe("Runcrate model discovery route", () => {
  afterEach(() => vi.clearAllMocks());

  it("lists the live catalog with the stored key and keeps slash IDs", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({ data: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash" }, { id: "Qwen/Qwen3.8-Flash" }] }),
    );
    const result = await fetchConnectionModels({
      id: "runcrate-test",
      provider: "runcrate",
      apiKey: SYNTHETIC_KEY,
    });
    expect(result).toMatchObject({
      provider: "runcrate",
      connectionId: "runcrate-test",
      models: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash" }, { id: "Qwen/Qwen3.8-Flash" }],
    });
    expect(routedFetch).toHaveBeenCalledWith(
      MODELS_URL,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: `Bearer ${SYNTHETIC_KEY}` }),
      }),
      expect.anything(),
    );
  });

  it("surfaces a rejected credential instead of an empty successful catalog", async () => {
    routedFetch.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    expect(
      await fetchConnectionModels({ id: "runcrate-test", provider: "runcrate", apiKey: "rc_live_wrong" }),
    ).toEqual({ error: "Failed to fetch models: 401", status: 401 });
  });
});

describe("Runcrate chat requests", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends a non-streaming request to the documented endpoint and keeps upstream usage", async () => {
    routedFetch.mockResolvedValue(
      jsonResponse({
        id: "chatcmpl-runcrate",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }),
    );
    const executor = new DefaultExecutor("runcrate");
    const result = await executor.execute({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", false),
      stream: false,
      credentials: { apiKey: SYNTHETIC_KEY },
    });

    expect(routedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = routedFetch.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    expect(init.headers.Accept).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      stream: false,
    });
    expect(JSON.parse(init.body).stream_options).toBeUndefined();

    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toBe("hello");
    expect(payload.usage).toEqual({ prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 });
  });

  it("asks for streaming, forwards SSE frames and asks the upstream for usage", async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "he" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "llo" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ];
    routedFetch.mockResolvedValue(sseResponse(events));
    const executor = new DefaultExecutor("runcrate");
    const result = await executor.execute({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", true),
      stream: true,
      credentials: { apiKey: SYNTHETIC_KEY },
    });

    const [, init] = routedFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
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
    const executor = new DefaultExecutor("runcrate");
    const result = await executor.execute({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", false),
      stream: false,
      credentials: { apiKey: "rc_live_wrong" },
    });
    expect(result.response.status).toBe(401);
    const payload = await result.response.json();
    expect(payload.error.message).toBe("Invalid API key");
    expect(routedFetch).toHaveBeenCalledTimes(1);
  });

  it("passes an upstream server error through without inventing a successful body", async () => {
    routedFetch.mockResolvedValue(jsonResponse({ error: { message: "upstream unavailable" } }, 500));
    const executor = new DefaultExecutor("runcrate");
    const result = await executor.execute({
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", false),
      stream: false,
      credentials: { apiKey: SYNTHETIC_KEY },
    });
    expect(result.response.status).toBe(500);
    expect((await result.response.json()).error.message).toBe("upstream unavailable");
  });
});

describe("Runcrate streaming accounting", () => {
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
      provider: "runcrate",
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      connectionId: "runcrate-test",
      requestStartTime: Date.now(),
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", true),
      stream: true,
      onRequestSuccess: vi.fn(),
      getProviderAttemptStartedAt: () => 1234,
    });
    const result = await handleStreamingResponse({
      provider: "runcrate",
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: chatBody("deepseek-ai/DeepSeek-V4.1-Flash", true),
      stream: true,
      requestStartTime: Date.now(),
      connectionId: "runcrate-test",
      streamController: createStreamController({ provider: "runcrate", model: "deepseek-ai/DeepSeek-V4.1-Flash" }),
      providerResponse,
      ...completion,
    });
    await result.response.text();
    await Promise.resolve();

    const detail = saveRequestDetail.mock.calls.at(-1)[0];
    expect(detail.tokens).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
  });
});
