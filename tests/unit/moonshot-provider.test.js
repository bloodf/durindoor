import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "fixture", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(async () => {}) }));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()), createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

import { saveRequestUsage } from "@/lib/usageDb.js";
import { getProviderConnectionById } from "@/lib/localDb";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import { __setProviderTestFetchForTesting, testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveRequestTransport, handleChatCore } from "../../open-sse/handlers/chatCore.js";

const key = "fixture-platform-key";
const connection = { id: "fixture", provider: "kimi", apiKey: key };
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
const completion = { id: "fixture", object: "chat.completion", model: "kimi-k3.1-pro", choices: [{ index: 0, message: { role: "assistant", content: "hello", reasoning_content: "reason" }, finish_reason: "stop" }], usage };

async function chat(body, sourceFormat = "openai") {
  return handleChatCore({ body, modelInfo: { provider: "kimi", model: body.model }, credentials: { apiKey: key, authType: "apikey" },
    sourceFormatOverride: sourceFormat, clientRawRequest: { endpoint: sourceFormat === "claude" ? "/v1/messages" : "/v1/chat/completions", body, headers: {} },
    connectionId: "fixture", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
}

beforeEach(() => { proxyAwareFetch.mockReset(); vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); })); });
afterEach(() => vi.unstubAllGlobals());

describe("Kimi platform Chat Completions", () => {
  it("uses the existing platform connection and selects the client protocol, including discovered models", () => {
    expect(APIKEY_PROVIDERS.kimi.modelsFetcher.url).toBe("https://api.moonshot.ai/v1/models");
    expect(PROVIDERS.kimi.baseUrl).toBe("https://api.moonshot.ai/anthropic/v1/messages");
    for (const model of ["kimi-k3.1-pro", "future-platform-model"]) {
      for (const [format, path] of [["openai", "/v1/chat/completions"], ["claude", "/anthropic/v1/messages"]]) {
        const result = resolveRequestTransport({ provider: "kimi", alias: "kimi", model, sourceFormat: format, credentials: connection });
        expect(result.targetFormat).toBe(format);
        expect(result.runtimeTransport.baseUrl).toBe(`https://api.moonshot.ai${path}`);
      }
    }
    expect(PROVIDERS["kimi-coding"].baseUrl).toContain("api.kimi.com/coding/");
    expect(PROVIDERS["kimi-ai"].baseUrl).toContain("api.kimi.ai/coding/");
    const platform = getExecutor("kimi");
    expect(platform.buildHeaders({ apiKey: key, accessToken: "coding-token" }, false).Authorization).toBe(`Bearer ${key}`);
    expect(platform.buildHeaders({ accessToken: "coding-token" }, false).Authorization).toBeUndefined();
  });

  it("discovers with the platform key and reports upstream failures", async () => {
    expect(await fetchConnectionModels({ provider: "kimi", accessToken: "coding-token" })).toMatchObject({ status: 401 });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ data: [{ id: "kimi-k3.1-pro" }] }));
    expect(await fetchConnectionModels(connection)).toMatchObject({ models: [{ id: "kimi-k3.1-pro" }] });
    expect(proxyAwareFetch).toHaveBeenCalledWith("https://api.moonshot.ai/v1/models", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: `Bearer ${key}` }) }), {});
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect(await fetchConnectionModels(connection)).toMatchObject({ status: 401 });
  });

  it("validates a new platform key through the read-only model list", async () => {
    fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    const request = new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "kimi", apiKey: key }) });
    expect(await (await validate(request)).json()).toMatchObject({ valid: true });
    expect(fetch.mock.calls[0][0]).toBe("https://api.moonshot.ai/v1/models");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
  });

  it.each([[200, true], [400, true], [401, false], [403, false]])("preserves saved connection probe behavior for HTTP %i", async (status, valid) => {
    getProviderConnectionById.mockResolvedValue({ ...connection, authType: "apikey" });
    const probe = vi.fn(async () => new Response("fixture", { status }));
    const restore = __setProviderTestFetchForTesting(probe);
    try {
      expect(await testSingleConnection("fixture")).toMatchObject({ valid });
      expect(probe.mock.calls[0][0]).toBe("https://api.moonshot.ai/v1/chat/completions");
      expect(probe.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
      expect(probe.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(probe.mock.calls[0][1].body)).toMatchObject({ model: "kimi-for-coding", max_tokens: 10 });
    } finally { restore(); }
  });

  it("sends non-streaming chat and preserves reasoning, tools and usage", async () => {
    proxyAwareFetch.mockImplementation(async () => Response.json(completion));
    const body = { model: "kimi-k3.1-pro", stream: false, messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }], reasoning_effort: "high" };
    const result = await chat(body);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({ choices: completion.choices, usage: { completion_tokens: 2 } });
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.headers["x-api-key"]).toBeUndefined();
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "kimi", model: "kimi-k3.1-pro", connectionId: "fixture", tokens: expect.objectContaining({ prompt_tokens: 3, completion_tokens: 2 }) })));
    expect(JSON.parse(init.body)).toMatchObject(body);
  });

  it("streams chat with usage and propagates upstream errors", async () => {
    const chunks = [{ id: "fixture", object: "chat.completion.chunk", model: "kimi-k3.1-pro", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] }, { id: "fixture", object: "chat.completion.chunk", model: "kimi-k3.1-pro", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, { id: "fixture", object: "chat.completion.chunk", model: "kimi-k3.1-pro", choices: [], usage }];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    proxyAwareFetch.mockImplementation(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const body = { model: "kimi-k3.1-pro", stream: true, messages: [{ role: "user", content: "hello" }] };
    const result = await chat(body);
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("hello");
    expect(text).toContain("[DONE]");
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "kimi", tokens: expect.objectContaining({ prompt_tokens: 3, completion_tokens: 2 }) })));
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    proxyAwareFetch.mockImplementation(async () => Response.json({ error: { message: "bad key" } }, { status: 401 }));
    const failed = await chat({ ...body, stream: false });
    expect(failed.success).toBe(false);
    expect(failed.response.status).toBe(401);
  });

  it.each([
    ["openai", {}, "max_completion_tokens", 131072],
    ["openai", { max_tokens: 64 }, "max_completion_tokens", 64],
    ["openai", { max_completion_tokens: 96 }, "max_completion_tokens", 96],
    ["claude", {}, "max_tokens", 131072],
    ["claude", { max_tokens: 64 }, "max_tokens", 64],
  ])("sends the %s output limit in its native wire format", async (format, limit, field, expected) => {
    proxyAwareFetch.mockImplementation(async () => format === "claude"
      ? Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: "kimi-k3", content: [{ type: "text", text: "hello" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } })
      : Response.json({ ...completion, model: "kimi-k3" }));
    const result = await chat({ model: "kimi-k3", stream: false, messages: [{ role: "user", content: "hello" }], ...limit }, format);
    expect(result.success).toBe(true);
    const wire = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(wire[field]).toBe(expected);
    expect(wire[field === "max_tokens" ? "max_completion_tokens" : "max_tokens"]).toBeUndefined();
  });

  it("keeps native Messages on the platform endpoint with the same key", async () => {
    const response = { id: "msg_fixture", type: "message", role: "assistant", model: "kimi-k3.1-pro", content: [{ type: "text", text: "hello" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } };
    proxyAwareFetch.mockImplementation(async () => Response.json(response));
    const body = { model: "kimi-k3.1-pro", max_tokens: 32, stream: false, messages: [{ role: "user", content: "hello" }] };
    const result = await chat(body, "claude");
    expect(result.success).toBe(true);
    const [url, init] = proxyAwareFetch.mock.calls.find(([target]) => target === "https://api.moonshot.ai/anthropic/v1/messages");
    expect(url).toBe("https://api.moonshot.ai/anthropic/v1/messages");
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(await result.response.json()).toMatchObject({ content: [{ type: "text", text: "hello" }] });
  });
});
