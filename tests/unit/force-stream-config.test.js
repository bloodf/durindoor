// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  dedupeToolsMock,
  detectClientToolMock,
  isNativePassthroughMock,
  normalizeClaudePassthroughMock,
  translateRequestMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  dedupeToolsMock: vi.fn((tools) => ({ tools, stripped: [] })),
  detectClientToolMock: vi.fn(() => null),
  isNativePassthroughMock: vi.fn(() => false),
  normalizeClaudePassthroughMock: vi.fn(),
  translateRequestMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
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

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: detectClientToolMock,
  isNativePassthrough: isNativePassthroughMock,
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/translator/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  translateRequestMock.mockImplementation(actual.translateRequest);
  return { ...actual, translateRequest: translateRequestMock };
});

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  })),
  pipeWithDisconnect: vi.fn(() => new ReadableStream({
    start(controller) { controller.close(); }
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  prepareClaudeRequest: vi.fn((body) => body),
  normalizeClaudePassthrough: normalizeClaudePassthroughMock,
  anchorClaudeCache: vi.fn(),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: dedupeToolsMock,
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({
  injectCaveman: vi.fn(),
}));

vi.mock("../../open-sse/rtk/ponytail.js", () => ({
  injectPonytail: vi.fn(),
}));

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
  // chatCore imports this for the per-request bypass header (#2609); default enabled.
  resolveTokenSaverEnabled: vi.fn(() => true),
}));

/** Preserve real exports such as classifyHeadroomDiagnostic so new imports do not break this mock. */
vi.mock("../../open-sse/rtk/headroom.js", async (importOriginal) => ({
  ...(await importOriginal()),
  compressWithHeadroom: vi.fn(async () => null),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
  // Unknown limits: the preflight must stay out of the way of these tests.
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn((body) => body?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
  saveUsageStats: vi.fn(),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
  sanitizeErrorMessage: vi.fn((message) => String(message || "")),
  readBoundedResponseText: vi.fn((response) => response.text()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  // Session terminals were split from pending-counter decrements in 96205df5c.
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const FORCED = ["openai", "codex", "commandcode", "kimi-coding", "kimi-coding-apikey"];

function makeOptions(bodyStream) {
  const body = {
    model: "gpt-4.1",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function schemaTool(name = "find_files") {
  return {
    type: "function",
    function: {
      name,
      description: "Find matching files",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "literal property", pattern: "[" },
          valid: { type: "string", pattern: "^[a-z]+$", enum: ["ok"] },
          count: { type: "integer", pattern: 7, minimum: 1 },
          nested: {
            anyOf: [
              { type: "string", pattern: "(" },
              { type: "array", items: { type: "string", pattern: "^ok$" } },
            ],
          },
          composed: {
            allOf: [{ type: "string", pattern: "\\" }],
            oneOf: [{ type: "string", pattern: "^one$" }],
          },
          properties: {
            type: "object",
            pattern: "[",
            properties: {
              pattern: { type: "string", pattern: "(" },
            },
          },
          configured: {
            type: "object",
            pattern: "[",
            default: { pattern: "[" },
            const: { pattern: "(" },
            examples: [{ pattern: "[" }],
            enum: [{ pattern: "(" }],
          },
        },
        required: ["pattern"],
      },
    },
  };
}

function makeOpenRouterOptions(body) {
  return {
    body,
    modelInfo: { provider: "openrouter", model: "openai/gpt-4o-mini" },
    credentials: { apiKey: "sk-or-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json", "user-agent": "GitHubCopilotChat/1.0" },
    },
    connectionId: "test-openrouter-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeCrossFormatOptions(provider, model) {
  const body = {
    model,
    messages: [{ role: "user", content: "hello" }],
    stream: true,
  };

  return {
    body,
    modelInfo: { provider, model },
    credentials: {
      apiKey: "sk-test",
      accessToken: "token-test",
      providerSpecificData: { region: "us-east-1" },
    },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "text/event-stream" },
    },
    connectionId: `test-${provider}-connection`,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeNativeClaudeOptions() {
  const body = {
    model: "claude-sonnet-4.5",
    system: "You are concise.",
    max_tokens: 1024,
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  };

  return {
    body,
    modelInfo: { provider: "claude", model: "claude-sonnet-4.5" },
    credentials: { accessToken: "token-test", providerSpecificData: {} },
    clientRawRequest: {
      endpoint: "/v1/messages",
      body,
      headers: { accept: "application/json", "user-agent": "claude-cli/2.1.0" },
    },
    connectionId: "test-claude-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeGeminiOptions(provider, sourceFormatOverride) {
  const body = {
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: "hello" }] }],
    generationConfig: {},
  };

  return {
    body,
    modelInfo: { provider, model: "gemini-2.5-flash" },
    credentials: { accessToken: "token-test", providerSpecificData: {} },
    clientRawRequest: {
      endpoint: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
      body,
      headers: { accept: "text/event-stream", "user-agent": "gemini-cli/0.34.0" },
    },
    connectionId: `test-${provider}-connection`,
    sourceFormatOverride,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeNativeCodexOptions() {
  const body = {
    model: "gpt-5.4",
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    stream: false,
  };

  return {
    body,
    modelInfo: { provider: "codex", model: "gpt-5.4" },
    credentials: { accessToken: "token-test", providerSpecificData: {} },
    clientRawRequest: {
      endpoint: "/v1/responses",
      body,
      headers: { accept: "application/json", "user-agent": "codex-cli/0.144.1" },
    },
    connectionId: "test-codex-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeKimiOptions(provider, authType) {
  const body = {
    model: "k3",
    stream: false,
    messages: [{ role: "user", content: "hello" }],
  };

  return {
    body,
    modelInfo: { provider, model: "k3" },
    credentials: { apiKey: "kimi-test", authType },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "kimi-test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeAgyImageOptions() {
  const body = {
    model: "gemini-3-flash-image",
    stream: true,
    messages: [{ role: "user", content: "make an icon" }],
  };

  return {
    body,
    modelInfo: { provider: "agy", model: "gemini-3-flash-image" },
    credentials: { accessToken: "tok-test", refreshToken: "refresh-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "text/event-stream" },
    },
    connectionId: "agy-image-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeGaladrielOptions() {
  const body = {
    model: "galadriel-latest",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
  };

  return {
    body,
    modelInfo: { provider: "galadriel", model: "galadriel-latest" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "text/event-stream" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("forceStream provider config", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
    dedupeToolsMock.mockClear();
    detectClientToolMock.mockReset();
    detectClientToolMock.mockReturnValue(null);
    isNativePassthroughMock.mockReset();
    isNativePassthroughMock.mockReturnValue(false);
    normalizeClaudePassthroughMock.mockClear();
    translateRequestMock.mockClear();
  });

  it("forces streaming only for dedicated Kimi Code subscription providers", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    for (const id of ["kimi", "deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });

  it.each([undefined, false])(
    "keeps forced-stream providers streaming for JSON clients when body.stream is %s",
    async (bodyStream) => {
      const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

      await handleChatCore(makeOptions(bodyStream));

      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(executeMock.mock.calls[0][0].stream).toBe(true);
      expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
    },
  );

  it("forces a non-streaming Kimi Code subscription request to SSE upstream", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeKimiOptions("kimi-coding", "oauth"));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({
      stream: true,
      body: { stream: true },
      credentials: {
        runtimeTransport: { baseUrl: "https://api.kimi.com/coding/v1/messages" },
      },
    });
  });

  it("keeps the Kimi platform API-key transport non-forced", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeKimiOptions("kimi", "apikey"));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({
      stream: false,
      body: { stream: false },
      credentials: {
        runtimeTransport: { baseUrl: "https://api.moonshot.ai/v1/chat/completions" },
      },
    });
  });

  it("syncs negotiated streaming into native Codex passthrough bodies", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    isNativePassthroughMock.mockReturnValue(true);

    await handleChatCore(makeNativeCodexOptions());

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });

  it("syncs negotiated streaming into native Claude passthrough bodies", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    isNativePassthroughMock.mockReturnValue(true);

    await handleChatCore(makeNativeClaudeOptions());

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(Object.hasOwn(executeMock.mock.calls[0][0].body, "stream")).toBe(true);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(false);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
  });

  it("threads raw request headers through native Claude normalization", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const options = makeNativeClaudeOptions();
    options.clientRawRequest.headers["x-9router-assistant-prefill"] = "preserve";
    detectClientToolMock.mockReturnValue("claude");
    isNativePassthroughMock.mockReturnValue(true);

    await handleChatCore(options);

    expect(normalizeClaudePassthroughMock).toHaveBeenCalledWith(
      expect.any(Object),
      "claude-sonnet-4.5",
      "claude",
      null,
      { foldSystemTurns: true, rawHeaders: options.clientRawRequest.headers },
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
  ])("defaults a %s Claude tool type to custom", async (_label, type) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const options = makeNativeClaudeOptions();
    const tool = { name: "lookup", input_schema: { type: "object" } };
    if (type !== undefined) tool.type = type;
    options.body.tools = [tool];
    options.clientRawRequest.body = options.body;
    isNativePassthroughMock.mockReturnValue(true);

    await handleChatCore(options);

    expect(executeMock.mock.calls[0][0].body.tools[0]).toMatchObject({ name: "lookup", type: "custom" });
  });

  it("preserves a truthy Claude tool object by reference", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const options = makeNativeClaudeOptions();
    options.body.tools = [{ name: "computer", type: "computer_use", display_width: 1024 }];
    options.clientRawRequest.body = options.body;
    isNativePassthroughMock.mockReturnValue(true);
    await handleChatCore(options);

    const normalizedTools = dedupeToolsMock.mock.calls[0][0];
    expect(executeMock.mock.calls[0][0].body.tools[0]).toBe(normalizedTools[0]);
  });

  it("does not inject stream into native Gemini CLI passthrough bodies", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    isNativePassthroughMock.mockReturnValue(true);

    await handleChatCore(makeGeminiOptions("gemini-cli", "gemini-cli"));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body).toHaveProperty("contents");
    expect(Object.hasOwn(executeMock.mock.calls[0][0].body, "stream")).toBe(false);
  });

  it("does not inject stream into same-format Gemini bodies", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeGeminiOptions("gemini", "gemini"));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body).toHaveProperty("contents");
    expect(Object.hasOwn(executeMock.mock.calls[0][0].body, "stream")).toBe(false);
  });

  it("syncs negotiated streaming into same-format OpenAI bodies", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(isNativePassthroughMock).toHaveReturnedWith(false);
    expect(translateRequestMock.mock.calls[0][4]).toBe(true);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });

  it.each([
    ["Gemini", "gemini", "gemini-2.5-flash", "contents"],
    ["Kiro", "kiro", "claude-sonnet-4.5", "conversationState"],
  ])("does not inject stream into cross-format %s bodies", async (_name, provider, model, shapeKey) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeCrossFormatOptions(provider, model));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body).toHaveProperty(shapeKey);
    expect(Object.hasOwn(executeMock.mock.calls[0][0].body, "stream")).toBe(false);
  });

  it("does not write stream when same-format body already matches negotiation", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    let writes = 0;
    translateRequestMock.mockImplementationOnce((_source, _target, _model, body, stream) => {
      const translated = { ...body };
      let current = stream;
      Object.defineProperty(translated, "stream", {
        get: () => current,
        set: (value) => { writes += 1; current = value; },
        enumerable: true,
        configurable: true,
      });
      return translated;
    });

    await handleChatCore(makeOptions(true));

    expect(writes).toBe(0);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });

  it("forwards the detected client and catalog model to tool deduplication", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const options = makeOptions(false);
    options.body.model = "gpt-4.1(max)";
    options.modelInfo.model = "gpt-4.1(max)";
    options.clientRawRequest.body.model = "gpt-4.1(max)";
    options.body.tools = [
      { type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } },
    ];
    detectClientToolMock.mockReturnValue("claude");

    await handleChatCore(options);

    expect(dedupeToolsMock).toHaveBeenCalledWith(expect.any(Array), {
      clientTool: "claude",
      model: "gpt-4.1",
    });
  });

  it("normalizes malformed OpenRouter tool regexes only at final dispatch", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const body = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "find files" }],
      tools: [schemaTool(), schemaTool("second_tool")],
      stream: false,
    };
    const original = structuredClone(body);

    await handleChatCore(makeOpenRouterOptions(body));

    const outbound = executeMock.mock.calls[0][0].body;
    const parameters = outbound.tools[0].function.parameters;
    expect(parameters.properties).toHaveProperty("pattern");
    expect(parameters.properties.pattern).toEqual({ type: "string", description: "literal property" });
    expect(parameters.properties.valid).toEqual({ type: "string", pattern: "^[a-z]+$", enum: ["ok"] });
    expect(parameters.properties.count).toEqual({ type: "integer", pattern: 7, minimum: 1 });
    expect(parameters.properties.nested.anyOf).toEqual([
      { type: "string" },
      { type: "array", items: { type: "string", pattern: "^ok$" } },
    ]);
    expect(parameters.properties.composed).toEqual({
      allOf: [{ type: "string" }],
      oneOf: [{ type: "string", pattern: "^one$" }],
    });
    expect(parameters.required).toEqual(["pattern"]);
    expect(parameters.properties.properties).toEqual({
      type: "object",
      properties: { pattern: { type: "string" } },
    });
    expect(parameters.properties.configured).toEqual({
      type: "object",
      default: { pattern: "[" },
      const: { pattern: "(" },
      examples: [{ pattern: "[" }],
      enum: [{ pattern: "(" }],
    });
    expect(outbound.tools).toHaveLength(2);
    expect(body).toEqual(original);
  });

  it("does not add a tools key to a body without tools", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(executeMock.mock.calls[0][0].body).not.toHaveProperty("tools");
  });

  it("leaves malformed tool regexes unchanged for non-OpenRouter dispatch", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const options = makeOptions(false);
    options.body.tools = [schemaTool()];
    options.clientRawRequest.body = options.body;

    await handleChatCore(options);

    expect(executeMock.mock.calls[0][0].body.tools[0].function.parameters.properties.pattern.pattern).toBe("[");
  });

  it.each(["Claude", "Gemini"])("normalizes translated %s tools at the OpenRouter dispatch boundary", async (format) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const openaiTool = schemaTool();
    const body = format === "Claude" ? {
      model: "openai/gpt-4o-mini",
      system: "Be concise",
      messages: [{ role: "user", content: [{ type: "text", text: "find files" }] }],
      tools: [{
        name: openaiTool.function.name,
        description: openaiTool.function.description,
        input_schema: openaiTool.function.parameters,
      }],
    } : {
      model: "openai/gpt-4o-mini",
      contents: [{ role: "user", parts: [{ text: "find files" }] }],
      tools: [{ functionDeclarations: [openaiTool.function] }],
    };

    await handleChatCore(makeOpenRouterOptions(body));

    const outbound = executeMock.mock.calls[0][0].body;
    expect(outbound.tools[0]).toMatchObject({ type: "function", function: { name: "find_files" } });
    expect(outbound.tools[0].function.parameters.properties.pattern).not.toHaveProperty("pattern");
  });


  it("returns non-OpenRouter and non-array tool values by reference", async () => {
    const { normalizeOpenRouterToolSchemas } = await import("../../open-sse/translator/concerns/toolCall.js");
    const tools = [schemaTool()];
    const nonArray = { function: schemaTool().function };

    expect(normalizeOpenRouterToolSchemas("openai", tools)).toBe(tools);
    expect(normalizeOpenRouterToolSchemas("openrouter", nonArray)).toBe(nonArray);
  });
  it("synthesizes SSE for streaming clients when Galadriel is forced non-streaming upstream", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 123,
        model: "galadriel-latest",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "hello from json" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://api.galadriel.com/v1/verified/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const result = await handleChatCore(makeGaladrielOptions());
    const text = await result.response.text();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
    expect(result.response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(text).toContain("data: ");
    expect(text).toContain("hello from json");
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("\"object\":\"chat.completion\"");
  });

  it("forces agy image generation through non-streaming Google generateContent", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeAgyImageOptions());

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({
      model: "gemini-3-flash-image",
      stream: false,
    });
  });
});
