/**
 * Registered Responses translation must return a client HTTP 400 for scoped
 * image file IDs before provider dispatch. Keep the real HTTP error builder.
 */
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })),
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

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

// Spread the real module so main's enforceCursorCapabilities (and future
// exports) remain available after chatCore starts importing them.
vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCapabilitiesForModel: vi.fn(() => ({})),
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
  hasMediaBlocks: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async (importOriginal) => ({
  ...(await importOriginal()),
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  saveUsageStats: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  finishActiveSession: vi.fn(),
  recordTokenSaverEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ exceeded: false })),
  getProviderConnections: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => ({})),
  getApiKeyProviderConnectionIds: vi.fn(async () => null),
  getComboForModel: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: vi.fn(async () => null),
  getModelInfo: vi.fn(async (id) => id.startsWith("openai/")
    ? { provider: "openai", model: "gpt-4o" }
    : { provider: "groq", model: "llama-3.3-70b-versatile" }),
  createRoutableModelIdChecker: vi.fn(() => async () => true),
  loadCustomCapabilities: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, stored: false } })),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({ apiKey: "test-key", connectionId: "test-connection" })),
  projectProviderCredentials: vi.fn((credentials) => credentials),
  isProviderConnectionModelLocked: vi.fn(() => false),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn(async (_provider, credentials) => credentials) }));
vi.mock("../../open-sse/services/liveModelLimits.js", () => ({ warmLiveModelLimits: vi.fn(), getCachedLiveLimits: vi.fn(() => null) }));

const { POST } = await import("../../src/app/api/v1/responses/route.js");

describe("public Responses file-ID rejection", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])("rejects before executor dispatch through POST and handleChat (stream=%s)", async (stream) => {
    const response = await POST(new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "groq/llama-3.3-70b-versatile", stream, input: [
        { type: "message", role: "user", content: [{ type: "input_image", file_id: "file-abc" }] },
      ] }),
    }));
    const payload = await response.text();
    expect(payload).toContain("input_image.file_id is not supported");
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      expect(payload).toContain("400");
    } else {
      expect(response.status).toBe(400);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([true, false])("dispatches URL/data images and preserves native file IDs (stream=%s)", async (stream) => {
    for (const reference of [
      { image_url: "https://example.com/a.png", file_id: "file-abc" },
      { image_url: "data:image/png;base64,AAAA", file_id: "file-abc" },
      { file_id: "file-native" },
    ]) {
      mocks.execute.mockClear();
      const native = !reference.image_url;
      mocks.execute.mockImplementation(async ({ stream: upstreamStream }) => ({
        response: upstreamStream ? new Response(native
          ? `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp-test", object: "response", model: "gpt-4o" } })}\n\nevent: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { id: "msg-test", type: "message", role: "assistant", content: [] } })}\n\nevent: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg-test", output_index: 0, content_index: 0, delta: "image accepted" })}\n\nevent: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { id: "msg-test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "image accepted", annotations: [] }] } })}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp-test", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "image accepted" }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`
          : `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "image accepted" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } }) : new Response(JSON.stringify(native ? {
          id: "resp-test", object: "response", status: "completed", model: "gpt-4o",
          output: [{ id: "msg-test", type: "message", role: "assistant", status: "completed",
            content: [{ type: "output_text", text: "image accepted", annotations: [] }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        } : {
          id: "chatcmpl-test", object: "chat.completion", model: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "image accepted" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { headers: { "Content-Type": "application/json" } }),
        url: "https://provider.invalid/v1/chat/completions", headers: {}, transformedBody: null,
      }));
      const response = await POST(new Request("http://localhost/v1/responses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: native ? "openai/gpt-4o" : "groq/llama-3.3-70b-versatile", stream,
          input: [{ type: "message", role: "user", content: [{ type: "input_image", ...reference }] }],
        }),
      }));
      const payload = await response.text();
      expect(response.status, payload).toBe(200);
      expect(payload).toContain("image accepted");
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const dispatched = mocks.execute.mock.calls[0][0].body;
      if (native) {
        expect(dispatched.input[0].content).toEqual([{ type: "input_image", file_id: "file-native" }]);
      } else {
        expect(dispatched.messages[0].content).toEqual([{ type: "image_url", image_url: { url: reference.image_url, detail: "auto" } }]);
      }
    }
  });
});

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const image = { type: "input_image", file_id: "file-abc" };
const inputs = [
  [{ type: "message", role: "user", content: [image] }],
  [
    { type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: [image] },
  ],
];

describe("Responses image file IDs through chatCore", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])("returns HTTP 400 without upstream dispatch (stream=%s)", async (stream) => {
    for (const input of inputs) {
      const body = { model: "openai-compatible-test/vision-model", stream, input: structuredClone(input) };
      const result = await handleChatCore({
        body,
        modelInfo: { provider: "openai-compatible-test", model: "vision-model" },
        credentials: { apiKey: "test-key", providerSpecificData: { baseUrl: "https://provider.invalid/v1" } },
        clientRawRequest: { endpoint: "/v1/responses", body, headers: {} },
        log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      expect(result).toMatchObject({ success: false, status: 400 });
      expect(result.response.status).toBe(400);
      expect(result.response.headers.get("content-type")).toContain("application/json");
      const payload = await result.response.json();
      expect(payload.error.message).toContain("input_image.file_id is not supported");
      expect(payload.error.message).toContain("send image_url");
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  });
});
