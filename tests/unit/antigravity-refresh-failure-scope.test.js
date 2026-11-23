import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  parseRetryFromErrorMessage: vi.fn(),
  oauth: vi.fn(),
  handleStreamingResponse: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: false,
    execute: mocks.execute,
    refreshCredentials: (...args) => mocks.oauth(...args),
    parseRetryFromErrorMessage: mocks.parseRetryFromErrorMessage,
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
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));

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
}));

vi.mock("../../open-sse/services/tokenRefresh.js", async (original) => ({
  ...(await original()), refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  // Real capabilities stay so thinking translation is observable; unknown limits
  // keep the preflight out of the way.
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
  hasMediaBlocks: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((d) => d),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  saveUsageStats: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));


const providerFetch = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()), proxyAwareFetch: (...args) => providerFetch(...args),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");

it("characterizes a rejected OAuth refresh through normal credential and chat entry points", async () => {
  providerFetch.mockResolvedValue(new Response("invalid grant", { status: 400 }));
  const executor = new AntigravityExecutor("antigravity");
  const connection = { id: "failed-account", provider: "antigravity", accessToken: "expired", refreshToken: "synthetic-refresh", providerSpecificData: {} };
  const update = vi.fn();
  const result = await refreshAndUpdateCredentials(connection, true, null, {
    getExecutorImpl: () => executor, getProviderConnectionByIdImpl: async () => connection,
    updateProviderConnectionImpl: update, reconcileDelays: [0], log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  expect(result).toEqual({ connection, refreshed: false });
  expect(update).not.toHaveBeenCalled();
  expect(providerFetch).toHaveBeenCalled();
  providerFetch.mockResolvedValueOnce(Response.json({ access_token: "healthy-access", expires_in: 3600 }));
  const healthy = await executor.refreshCredentials({ refreshToken: "healthy-refresh", projectId: "healthy-project" });
  expect(healthy).toMatchObject({ accessToken: "healthy-access", projectId: "healthy-project" });

  mocks.oauth.mockImplementation((...args) => executor.refreshCredentials(...args));
  mocks.execute.mockResolvedValue({ response: Response.json({ error: { message: "original upstream rejection" } }, { status: 401 }), url: "https://example.invalid", headers: {}, transformedBody: {} });
  const body = { model: "antigravity/gemini-3-flash", stream: false, messages: [{ role: "user", content: "hi" }] };
  const response = await handleChatCore({ body, modelInfo: { provider: "antigravity", model: "gemini-3-flash" }, credentials: { ...connection, connectionId: connection.id }, connectionId: connection.id, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  expect(response.status).toBe(401);
  expect(JSON.stringify(response)).toContain("original upstream rejection");
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it("returns a local schema error before calling the provider", async () => {
  mocks.execute.mockClear();
  const body = { model: "antigravity/gemini-3-flash", stream: false, messages: [{ role: "user", content: "hi" }], response_format: { type: "json_schema", json_schema: { schema: { $ref: "#/$defs/missing" } } } };
  const result = await handleChatCore({ body, modelInfo: { provider: "antigravity", model: "gemini-3-flash" }, credentials: { accessToken: "test", connectionId: "test" }, connectionId: "test", clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  expect(result.status).toBe(400);
  expect(result.localSchemaError).toBe(true);
  expect(result.response[Symbol.for("durindoor.localSchemaError")]).toBe(true);
  expect(mocks.execute).not.toHaveBeenCalled();
});
