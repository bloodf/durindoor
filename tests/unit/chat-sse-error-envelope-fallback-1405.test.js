import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})), getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(),
  getProviderConnections: vi.fn(async () => []), getQuotaReservationPressure: vi.fn(async () => new Map()),
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()), getModelInfo: vi.fn(async () => ({ provider: "openai", model: "test" })),
  getComboModels: vi.fn(async () => null), loadCustomCapabilities: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: vi.fn(), markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(), resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } })),
  isProviderConnectionModelLocked: vi.fn(() => false), providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  recordTokenSaverEvent: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const sse = (text) => ({
  response: new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } }),
  url: "https://provider.invalid/chat", headers: {}, transformedBody: null,
});
const okSse = () => sse(
  frame({ id: "ok", model: "test", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] }) +
  frame({ id: "ok", model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) +
  "data: [DONE]\n\n",
);

function account(n) {
  return {
    connectionId: `conn-${n}`, connectionName: `conn-${n}`, accessToken: "opaque-redacted", providerSpecificData: {},
    _connection: { id: `conn-${n}`, authType: "api_key" },
    _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
  };
}

async function callChat() {
  const { handleChat } = await import("../../src/sse/handlers/chat.js");
  return handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/test", stream: false, messages: [{ role: "user", content: "hi" }] }),
  }));
}

describe("chat.js: SSE error envelope in a non-stream request cools the account and falls back (#1405)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
    let n = 0;
    mocks.getProviderCredentials.mockImplementation(async () => account(++n));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, retryAt: null, retryAtKnown: false });
  });

  it("passes the envelope's 429 (not 502) to markAccountUnavailable and serves the next account", async () => {
    mocks.execute
      .mockResolvedValueOnce(sse(frame({ error: { status: 429, message: "rate limited" } }) + "data: [DONE]\n\n"))
      .mockResolvedValueOnce(okSse());

    const response = await callChat();

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(1);
    const [connectionId, status, errorText] = mocks.markAccountUnavailable.mock.calls[0];
    expect(connectionId).toBe("conn-1");
    expect(status).toBe(429);
    expect(errorText).toContain("rate limited");
    expect((await response.json()).choices[0].message.content).toBe("hello");
  });

  it("passes 401 through so the rejected credential is flagged, then falls back", async () => {
    mocks.execute
      .mockResolvedValueOnce(sse(frame({ error: { status: 401, message: "invalid key" } })))
      .mockResolvedValueOnce(okSse());

    const response = await callChat();

    expect(response.status).toBe(200);
    expect(mocks.markAccountUnavailable.mock.calls[0].slice(0, 2)).toEqual(["conn-1", 401]);
  });

  it("falls back to 502 for an envelope without a valid status", async () => {
    mocks.execute
      .mockResolvedValueOnce(sse(frame({ error: { code: 502, message: "bad gateway" } })))
      .mockResolvedValueOnce(okSse());

    await callChat();

    expect(mocks.markAccountUnavailable.mock.calls[0].slice(0, 2)).toEqual(["conn-1", 502]);
  });
});
