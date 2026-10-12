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

vi.mock("../../open-sse/providers/capabilities.js", () => ({
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

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
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
}));

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
