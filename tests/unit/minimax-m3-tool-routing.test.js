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
  ["minimax"],
  ["minimax-cn"],
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

describe("MiniMax M3 native tool-call routing (#2533)", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it.each(PROVIDERS)("%s: forces M3 family to the openai target format", (provider) => {
    expect(getModelTargetFormat(provider, "MiniMax-M3")).toBe(FORMATS.OPENAI);
    expect(getModelTargetFormat(provider, "MiniMax-M3.1-Flash-Preview")).toBe(FORMATS.OPENAI);
  });

  it.each(PROVIDERS)("%s: selects OpenAI transport for M3 family even for Claude source", (provider) => {
    const modelTargetFormat = getModelTargetFormat(provider, "MiniMax-M3.1-Flash-Preview");
    const transport = resolveTransport(provider, modelTargetFormat || FORMATS.CLAUDE);
    expect(transport?.format).toBe(FORMATS.OPENAI);
    expect(transport?.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
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
      url: "https://api.minimax.io/v1/chat/completions",
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

describe("MiniMax-M3 OpenAI tool_choice clamp (#2533)", () => {
  const OPENAI_TOOL_REQ = {
    model: "MiniMax-M3",
    messages: [{ role: "user", content: "call tool" }],
    tools: [{ type: "function", function: { name: "get_weather" } }],
    tool_choice: "required",
  };

  it.each(PROVIDERS)("%s: maps 'required' to 'auto'", (provider) => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "MiniMax-M3",
      structuredClone(OPENAI_TOOL_REQ),
      false,
      null,
      provider,
    );
    expect(translated.tool_choice).toBe("auto");
  });

  it.each(PROVIDERS)("%s: maps function object to 'auto'", (provider) => {
    const req = structuredClone(OPENAI_TOOL_REQ);
    req.tool_choice = { type: "function", function: { name: "get_weather" } };
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "MiniMax-M3",
      req,
      false,
      null,
      provider,
    );
    expect(translated.tool_choice).toBe("auto");
  });

  it.each(PROVIDERS)("%s: preserves 'auto' and 'none'", (provider) => {
    const auto = { ...structuredClone(OPENAI_TOOL_REQ), tool_choice: "auto" };
    const none = { ...structuredClone(OPENAI_TOOL_REQ), tool_choice: "none" };
    expect(translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "MiniMax-M3",
      auto,
      false,
      null,
      provider,
    ).tool_choice).toBe("auto");
    expect(translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "MiniMax-M3",
      none,
      false,
      null,
      provider,
    ).tool_choice).toBe("none");
  });

  it.each(PROVIDERS)("%s: leaves absent tool_choice absent", (provider) => {
    const req = { ...structuredClone(OPENAI_TOOL_REQ) };
    delete req.tool_choice;
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "MiniMax-M3",
      req,
      false,
      null,
      provider,
    );
    expect(translated).not.toHaveProperty("tool_choice");
  });

  it.each(PROVIDERS)("%s: clamps Claude-source 'any' and 'tool' tool_choice to 'auto'", (provider) => {
    const anyReq = {
      ...structuredClone(CLAUDE_TOOL_REQUEST),
      tool_choice: { type: "any" },
    };
    const toolReq = {
      ...structuredClone(CLAUDE_TOOL_REQUEST),
      tool_choice: { type: "tool", name: "get_weather" },
    };

    expect(translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "MiniMax-M3",
      anyReq,
      false,
      null,
      provider,
    ).tool_choice).toBe("auto");

    expect(translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "MiniMax-M3",
      toolReq,
      false,
      null,
      provider,
    ).tool_choice).toBe("auto");
  });
});
