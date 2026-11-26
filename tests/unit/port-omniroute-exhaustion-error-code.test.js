import { beforeEach, describe, expect, it, vi } from "vitest";

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

const exhaust = async (errorBodies) => {
  const queue = [...errorBodies];
  let n = 0;
  chatMocks.getProviderCredentials.mockImplementation(async () => {
    if (n >= errorBodies.length) return null;
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
    const errorBody = queue.shift();
    return {
      success: false,
      status: 401,
      error: "Gemini Web session is signed out",
      ...(errorBody ? { errorBody } : null),
      response: new Response("{}", { status: 401 }),
      attemptStartedAt: options.onProviderAttempt(),
    };
  });
  const { handleChat } = await import("../../src/sse/handlers/chat.js");
  const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/test", stream: false, messages: [{ role: "user", content: "hi" }] }),
  }));
  expect(response.status).toBe(401);
  return (await response.json()).error;
};

const signedOut = { error: { message: "signed out", code: "gemini_web_signed_out" } };

describe("OmniRoute #21119 (149516b12d4d) account exhaustion keeps the upstream error code", () => {
  beforeEach(() => {
    chatMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, retryAt: null, retryAtKnown: false });
  });

  it("keeps the code after every account failed", async () => {
    const error = await exhaust([signedOut, signedOut]);
    expect(error.code).toBe("gemini_web_signed_out");
    expect(error.message).toContain("signed out");
  });

  it("keeps the status default when the last failure sent no code", async () => {
    expect((await exhaust([signedOut, null])).code).toBe("invalid_api_key");
  });
});
