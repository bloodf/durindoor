import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routedFetch, saveRequestUsage } = vi.hoisted(() => ({ routedFetch: vi.fn(), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage,
}));

import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel } from "../../open-sse/services/model.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const connection = { id: "fixture", provider: "nan", apiKey: "sk-fixture" };
let restoreFetch;
beforeEach(() => { restoreFetch = __setOriginalFetchForTesting(routedFetch); });
afterEach(() => { restoreFetch(); vi.clearAllMocks(); });

describe("NaN provider", () => {
  it("registers the provider and routes chat with an inference key", () => {
    expect(APIKEY_PROVIDERS.nan).toBeDefined();
    expect(parseModel("nan/deepseek-v4-flash")).toMatchObject({ provider: "nan", model: "deepseek-v4-flash" });
    const executor = new DefaultExecutor("nan");
    expect(executor.buildUrl("deepseek-v4-flash", true)).toBe("https://api.nan.builders/v1/chat/completions");
    expect(executor.buildHeaders(connection, true).Authorization).toBe("Bearer sk-fixture");
  });

  it("preserves a key-specific mixed catalog, including non-chat models", async () => {
    routedFetch.mockResolvedValue(Response.json({ data: [
      { id: "deepseek-v4-flash" }, { id: "glm5.3" }, { id: "glm5x3" },
      { id: "qwen3-embedding" }, { id: "rerank" }, { id: "kokoro" },
      { id: "whisper" }, { id: "flux-2-klein" }, { id: "qwen-image-2.1" }, { id: "unknown" },
    ] }));
    const result = await fetchConnectionModels(connection);
    expect(result.models.map(({ id }) => id)).toEqual(["deepseek-v4-flash", "glm5.3", "glm5x3", "qwen3-embedding", "rerank", "kokoro", "whisper", "flux-2-klein", "qwen-image-2.1", "unknown"]);
    expect(routedFetch).toHaveBeenCalledWith("https://api.nan.builders/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-fixture" }),
    }));
  });

  it("discovers each account with its own key and retains its available models", async () => {
    routedFetch.mockImplementation(async (_url, options) => {
      const key = new Headers(options.headers).get("authorization");
      const ids = key === "Bearer sk-first" ? ["gemma4", "whisper"] : ["deepseek-v4-flash", "rerank"];
      return Response.json({ data: ids.map((id) => ({ id })) });
    });
    const first = await fetchConnectionModels({ ...connection, id: "first", apiKey: "sk-first" });
    const second = await fetchConnectionModels({ ...connection, id: "second", apiKey: "sk-second" });
    expect(first.models.map(({ id }) => id)).toEqual(["gemma4", "whisper"]);
    expect(second.models.map(({ id }) => id)).toEqual(["deepseek-v4-flash", "rerank"]);
    expect(routedFetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 402])("propagates catalog status %i", async (status) => {
    routedFetch.mockResolvedValue(new Response("{}", { status }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: "{}", status });
  });
  it.each([false, true])("routes chat responses with stream=%s", async (stream) => {
    await initTranslators();
    const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
    routedFetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://api.nan.builders/v1/chat/completions");
      expect(new Headers(options.headers).get("authorization")).toBe("Bearer sk-fixture");
      expect(JSON.parse(options.body)).toMatchObject({ model: "deepseek-v4-flash", stream, ...(stream ? { stream_options: { include_usage: true } } : {}) });
      if (stream) return new Response([
        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "deepseek-v4-flash", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", model: "deepseek-v4-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""), { headers: { "content-type": "text/event-stream" } });
      return Response.json({ id: "c", object: "chat.completion", model: "deepseek-v4-flash", choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage });
    });
    const body = { model: "nan/deepseek-v4-flash", stream, messages: [{ role: "user", content: "Hi" }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "nan", model: "deepseek-v4-flash" }, credentials: connection,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "fixture",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() } });
    expect(result.success).toBe(true);
    const output = await result.response.text();
    expect(output).toContain("Hello");
    expect(output).toContain("prompt_tokens");
    expect(output).toContain("completion_tokens");
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "nan", model: "deepseek-v4-flash", tokens: expect.objectContaining({ prompt_tokens: 3, completion_tokens: 2 }) })));
    expect(routedFetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402])("returns upstream chat failure %i", async (status) => {
    routedFetch.mockResolvedValue(Response.json({ error: { message: "fixture error", type: "invalid_request_error", code: status === 401 ? "invalid_api_key" : "insufficient_balance" } }, { status }));
    const body = { model: "nan/deepseek-v4-flash", stream: false, messages: [{ role: "user", content: "Hi" }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "nan", model: "deepseek-v4-flash" }, credentials: connection,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "fixture",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() } });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(status);
  });

  it("translates an Anthropic request and response through chat completions", async () => {
    await initTranslators();
    routedFetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://api.nan.builders/v1/chat/completions");
      expect(JSON.parse(options.body)).toMatchObject({ model: "deepseek-v4-flash", messages: [{ role: "user", content: "Hi" }] });
      return Response.json({ id: "c", object: "chat.completion", model: "deepseek-v4-flash", choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    });
    const body = { model: "nan/deepseek-v4-flash", max_tokens: 20, messages: [{ role: "user", content: "Hi" }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "nan", model: "deepseek-v4-flash" }, credentials: connection, sourceFormatOverride: "claude",
      clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } }, connectionId: "fixture",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() } });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 3, output_tokens: 2 } });
  });

  it.each([["sk-fixture", 200, true], ["nan_pat_fixture", 401, false]])("validates key type through the model endpoint", async (key, status, valid) => {
    const fetch = vi.fn(async (url, options) => {
      expect(String(url)).toBe("https://api.nan.builders/v1/models");
      expect(new Headers(options.headers).get("authorization")).toBe(`Bearer ${key}`);
      return new Response("{}", { status });
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const { POST } = await import("../../src/app/api/providers/validate/route.js");
      const response = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "nan", apiKey: key }) }));
      expect((await response.json()).valid).toBe(valid);
      expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

});
