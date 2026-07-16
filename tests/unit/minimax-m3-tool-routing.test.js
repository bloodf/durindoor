/**
 * Focused test for upstream decolua/9router#2533: MiniMax-M3 tool calls are
 * routed through the standard OpenAI API (OpenAI wire format + the
 * /v1/text/chatcompletion_v2 endpoint), for BOTH Claude-source and
 * OpenAI-source clients, while every other MiniMax model keeps its existing
 * format-aware transports and URLs.
 *
 * Observable contracts defended here:
 *  1. getModelTargetFormat() forces MiniMax-M3 → "openai" (minimax + minimax-cn).
 *  2. resolveTransport() then selects the OpenAI transport even for a Claude
 *     source format, and chatCore attaches it so the executor uses it.
 *  3. DefaultExecutor.buildUrl() for MiniMax-M3 on the OpenAI transport returns
 *     the chatcompletion_v2 URL (with the /v1/chat/completions fallback never
 *     used for M3), while MiniMax-M2.7 URLs are byte-identical before/after.
 *  4. A Claude-format request carrying tools is translated openai→openai shape:
 *     outgoing body keeps tools[0].type === "function" for M3.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const PROVIDERS = [
  ["minimax", "https://api.minimax.io"],
  ["minimax-cn", "https://api.minimaxi.com"],
];

const CLAUDE_TOOL_REQUEST = {
  model: "MiniMax-M3",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Call the test tool." }],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather",
      input_schema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  ],
};

describe("MiniMax-M3 tool-call routing (#2533)", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it.each(PROVIDERS)("%s: forces M3 to the openai target format", (provider) => {
    expect(getModelTargetFormat(provider, "MiniMax-M3")).toBe(FORMATS.OPENAI);
  });

  it.each(PROVIDERS)("%s: selects the OpenAI transport for M3 even for a Claude source", (provider) => {
    const modelTargetFormat = getModelTargetFormat(provider, "MiniMax-M3");
    const transport = resolveTransport(provider, modelTargetFormat || FORMATS.CLAUDE);
    expect(transport?.format).toBe(FORMATS.OPENAI);
    expect(transport?.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it.each(PROVIDERS)("%s: executor buildUrl returns chatcompletion_v2 for M3 on the OpenAI transport", (provider, host) => {
    const transport = resolveTransport(provider, FORMATS.OPENAI);
    const executor = new DefaultExecutor(provider);
    const url = executor.buildUrl("MiniMax-M3", false, 0, { runtimeTransport: transport });
    expect(url).toBe(`${host}/v1/text/chatcompletion_v2`);
  });

  it.each(PROVIDERS)("%s: M2.7 URLs are unchanged on both transports", (provider, host) => {
    const executor = new DefaultExecutor(provider);
    const openaiTransport = resolveTransport(provider, FORMATS.OPENAI);
    const claudeTransport = resolveTransport(provider, FORMATS.CLAUDE);
    expect(executor.buildUrl("MiniMax-M2.7", false, 0, { runtimeTransport: openaiTransport }))
      .toBe(`${host}/v1/chat/completions`);
    expect(executor.buildUrl("MiniMax-M2.7", false, 0, { runtimeTransport: claudeTransport }))
      .toBe(`${host}/anthropic/v1/messages?beta=true`);
  });

  it.each(PROVIDERS)("%s: M3 URL override keys provider+model+openai transport", (provider, host) => {
    const executor = new DefaultExecutor(provider);
    const openaiTransport = resolveTransport(provider, FORMATS.OPENAI);
    const claudeTransport = resolveTransport(provider, FORMATS.CLAUDE);
    // M3 + claude transport (claude body) keeps the anthropic URL — no rewrite.
    expect(executor.buildUrl("MiniMax-M3", false, 0, { runtimeTransport: claudeTransport }))
      .toBe(`${host}/anthropic/v1/messages?beta=true`);
    // A non-minimax executor never rewrites, even for model id MiniMax-M3.
    const other = new DefaultExecutor("openai");
    expect(other.buildUrl("MiniMax-M3", false, 0, {
      runtimeTransport: { format: "openai", baseUrl: "https://api.openai.com/v1/chat/completions" },
    })).toBe("https://api.openai.com/v1/chat/completions");
    expect(openaiTransport).toBeTruthy();
  });

  it.each(PROVIDERS)("%s: translates a Claude tool request to an OpenAI function-tool body for M3", (provider) => {
    const modelTargetFormat = getModelTargetFormat(provider, "MiniMax-M3");
    const translated = translateRequest(
      FORMATS.CLAUDE,
      modelTargetFormat,
      "MiniMax-M3",
      CLAUDE_TOOL_REQUEST,
      false,
      null,
      provider,
    );
    expect(translated.tools).toHaveLength(1);
    expect(translated.tools[0].type).toBe("function");
    expect(translated.tools[0].function.name).toBe("get_weather");
    expect(translated.tools[0].function.parameters).toEqual(CLAUDE_TOOL_REQUEST.tools[0].input_schema);
  });

  it("handleChatCore attaches the OpenAI runtime transport for a Claude-source M3 request", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl-m3",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      url: "https://api.minimax.io/v1/text/chatcompletion_v2",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });

    await handleChatCore({
      body: structuredClone(CLAUDE_TOOL_REQUEST),
      modelInfo: { provider: "minimax", model: "MiniMax-M3" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: null,
      onCredentialsRefreshed: vi.fn(),
      onRequestSuccess: vi.fn(),
      onDisconnect: vi.fn(),
      clientRawRequest: { endpoint: "/v1/messages", body: {}, headers: { accept: "application/json" } },
      connectionId: "test-conn",
      userAgent: "vitest",
      sourceFormatOverride: FORMATS.CLAUDE,
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const executeInput = executeMock.mock.calls[0][0];
    // Model override selected and attached the OpenAI transport even though the
    // client source format is Claude — without it the executor would fall back
    // to the provider default (anthropic) endpoint.
    expect(executeInput.credentials.runtimeTransport?.format).toBe(FORMATS.OPENAI);
    expect(executeInput.credentials.runtimeTransport?.baseUrl).toMatch(/\/v1\/chat\/completions$/);
    // Body was translated to the OpenAI shape before dispatch.
    expect(executeInput.body.tools?.[0]?.type).toBe("function");
    expect(executeInput.body.tools?.[0]?.function?.name).toBe("get_weather");
  });
});
