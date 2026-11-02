// #1100: chatCore forwards the operator budget config and the RESOLVED model's
// output reservation to the compression seam; the bypass header skips it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock, reserveMock, runCompressionSeam } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  reserveMock: vi.fn(() => 8192),
  runCompressionSeam: vi.fn(async (body) => ({ body, headerValue: null })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock, resolveEffectiveOutputReservation: reserveMock }),
}));
vi.mock("../../open-sse/handlers/chatCore/compressionHook.js", () => ({ runCompressionSeam }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const args = (over = {}) => ({
  body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
  modelInfo: { provider: "openai", model: "gpt-4o" },
  credentials: { apiKey: "k", providerSpecificData: {} },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  connectionId: "c",
  compressionEnabled: true,
  compressionEngines: { caveman: { enabled: true } },
  compressionAdaptive: { mode: "floor", policy: "percentage", pct: 0.5, outputReserve: -5 },
  modelCapabilities: { contextWindow: 64_000 },
  clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
  ...over,
});

describe("chatCore adaptive budget wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.openai.com/v1/chat/completions", headers: {}, transformedBody: null,
    });
  });

  it("passes the validated budget, model context and resolved output reservation", async () => {
    await handleChatCore(args());
    expect(runCompressionSeam).toHaveBeenCalledTimes(1);
    const cfg = runCompressionSeam.mock.calls[0][2];
    expect(cfg.adaptive).toMatchObject({ mode: "floor", policy: "percentage", pct: 0.5, outputReserve: 4096, modelContextLimit: 64_000, requestMaxTokens: 8192 });
    expect(cfg.engines).toEqual({ caveman: { enabled: true } });
    const [reserveBody, reserveCtx] = reserveMock.mock.calls.at(-1);
    expect(reserveBody.messages).toBeDefined();
    expect(reserveCtx.modelCapabilities.contextWindow).toBe(64_000);
  });

  it("defaults to adaptive off when the setting is absent", async () => {
    await handleChatCore(args({ compressionAdaptive: undefined }));
    expect(runCompressionSeam.mock.calls[0][2].adaptive.mode).toBe("off");
  });

  it("the per-request bypass header outranks every plan layer", async () => {
    await handleChatCore(args({ clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json", "x-durindoor-token-saver": "off" } } }));
    expect(runCompressionSeam).not.toHaveBeenCalled();
  });
});
