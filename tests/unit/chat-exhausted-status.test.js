import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });
const chatMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getModelInfo: vi.fn(async () => ({ provider: "status-test", model: "model" })),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })),
  handleChatCore: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: chatMocks.getSettings, getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(),
  getProviderConnections: vi.fn(async () => []), getQuotaReservationPressure: vi.fn(async () => new Map()),
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()), getModelInfo: chatMocks.getModelInfo, getComboModels: vi.fn(async () => null), loadCustomCapabilities: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: chatMocks.getProviderCredentials,
  projectProviderCredentials: vi.fn(), markAccountUnavailable: chatMocks.markAccountUnavailable,
  clearAccountError: vi.fn(), resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } })),
  isProviderConnectionModelLocked: vi.fn(() => false), providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: chatMocks.handleChatCore }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: chatMocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(),
}));

const log = { info() {}, warn() {} };

describe("exhausted response status", () => {
  it("keeps a non-model 4xx through combo exhaustion", async () => {
    const response = await handleComboChat({
      body: { stream: false },
      models: ["openai/first", "openai/second"],
      comboName: "status-test",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async () => new Response(
        JSON.stringify({ error: { message: "invalid temperature" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      ),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("invalid temperature");
  });

  it("preserves the existing Retry-After behavior for a retryable exhaustion", async () => {
    const retryAfter = new Date(Date.now() + 45_000).toISOString();
    const response = await handleComboChat({
      body: { stream: false },
      models: ["openai/first", "openai/second"],
      comboName: "status-test-retry",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async () => new Response(
        JSON.stringify({ error: { message: "rate limit reached" }, retryAfter }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      ),
    });

    expect(response.status).toBe(429);
    const retryAfterSec = Number(response.headers.get("Retry-After"));
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(45);
  });
});

describe("chatCore provider-error result preserves internal source status while client sees normalized 404", () => {
  it("keeps result.status === 401 internal, surfaces response.status === 404 to the client", async () => {
    chatMocks.execute.mockResolvedValue({
      response: new Response(JSON.stringify({ type: "ModelError", message: "model not found" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://provider.invalid/chat",
      headers: {},
      transformedBody: null,
    });
    const { handleChatCore } = await vi.importActual("../../open-sse/handlers/chatCore.js");
    const body = { model: "test", stream: false, messages: [{ role: "user", content: "hi" }] };
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "openai", model: "test" },
      credentials: { apiKey: "opaque-redacted", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(chatMocks.execute).toHaveBeenCalledOnce();
    expect(result.status).toBe(401);
    expect(result.response.status).toBe(404);
    await expect(result.response.json()).resolves.toMatchObject({
      type: "ModelError", message: "model not found",
    });
  });
});

describe("exhausted attempt-bound chat.js:995 uses shared helper when prior actionable lastStatus exists", () => {
  it("reaches the 1024-attempt bound after a prior 400 and returns 400 from lastError", async () => {
    const totalCoreCalls = { count: 0 };
    let n = 0;
    chatMocks.getProviderCredentials.mockImplementation(async () => {
      n += 1;
      return {
        connectionId: `conn-${n}`,
        connectionName: `conn-${n}`,
        accessToken: "opaque-redacted",
        providerSpecificData: {},
        _connection: { id: `conn-${n}`, authType: "api_key" },
        _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
      };
    });
    chatMocks.handleChatCore.mockImplementation(async (options) => {
      totalCoreCalls.count += 1;
      const attemptStartedAt = options.onProviderAttempt();
      return {
        success: false,
        status: 400,
        error: "model not found",
        response: new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 400 }),
        attemptStartedAt,
      };
    });
    chatMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, retryAt: null, retryAtKnown: false });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/test", stream: false, messages: [{ role: "user", content: "hi" }] }),
    }));

    // The loop dispatches exactly MAX_ACCOUNT_ATTEMPTS_PER_REQUEST times before the
    // bound trips; the 1025th selection never reaches handleChatCore.
    expect(totalCoreCalls.count).toBe(1024);
    // The shared status helper normalizes: stored 400 / lastError "model not found"
    // is a real wrong-model 400 (not the 401-with-ModelError trick), so the helper
    // returns 400 unchanged — clients see the stored actionable class.
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.message).toBe("model not found");
  });
});
