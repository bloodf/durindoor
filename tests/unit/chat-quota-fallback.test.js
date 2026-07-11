import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  handleChatCore: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function request(signal = null) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "codex/gpt-5.4",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
    ...(signal ? { signal } : {}),
  });
}

function selected(id) {
  const connection = {
    id,
    provider: "codex",
    authType: "oauth",
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    providerSpecificData: {},
  };
  return {
    connectionId: id,
    connectionName: id,
    accessToken: connection.accessToken,
    providerSpecificData: {},
    _connection: connection,
    _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
  };
}

describe("chat quota fallback orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
    });
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, stored: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.4" });
    mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
    mocks.projectProviderCredentials.mockImplementation(async (connection, quota) => ({
      ...selected(connection.id),
      _connection: connection,
      _quotaPreflight: quota,
    }));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
    mocks.clearAccountError.mockResolvedValue();
  });

  it("persists the first 429 context, attempts each account once, and returns one winning stream", async () => {
    const first = selected("conn-one");
    const second = selected("conn-two");
    const selectionExcludes = [];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
      selectionExcludes.push([...(excluded || [])]);
      if (!excluded?.has("conn-one")) return first;
      if (!excluded.has("conn-two")) return second;
      return null;
    });
    mocks.handleChatCore
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        return {
          success: false,
          status: 429,
          error: "[429]: Rate limit exceeded",
          resetsAtMs: Date.now() + 60_000,
          rateLimitEvidence: { state: "cooldown", resetAtMs: Date.now() + 60_000, source: "retry_after" },
          response: new Response("first-error-canary", { status: 429 }),
          attemptStartedAt,
        };
      })
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        await options.onRequestSuccess();
        return {
          success: true,
          attemptStartedAt,
          response: new Response("data: {\"ok\":true}\n\ndata: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        };
      });

    const response = await handleChat(request());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text.match(/\[DONE\]/g)).toHaveLength(1);
    expect(text).not.toContain("first-error-canary");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(selectionExcludes).toEqual([[], ["conn-one"]]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "conn-one",
      429,
      "[429]: Rate limit exceeded",
      "codex",
      "gpt-5.4",
      expect.any(Number),
      expect.objectContaining({
        attemptStartedAt: expect.any(Number),
        rateLimitEvidence: expect.objectContaining({ state: "cooldown" }),
      }),
    );
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "conn-two",
      expect.objectContaining({ connectionId: "conn-two" }),
      "gpt-5.4",
      expect.objectContaining({ provider: "codex", attemptStartedAt: expect.any(Number) }),
    );
  });

  it("returns before auth, quota, or database work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await handleChat(request(controller.signal));
    expect(response.status).toBe(499);
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.refreshProviderQuota).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("returns 499 when cancellation wins while credential selection is pending", async () => {
    const controller = new AbortController();
    mocks.getProviderCredentials.mockImplementation((_provider, _excluded, _model, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const pending = handleChat(request(controller.signal));
    await vi.waitFor(() => expect(mocks.getProviderCredentials).toHaveBeenCalledOnce());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns one final 429 without fabricating a deadline when any account reset is unknown", async () => {
    const accounts = [selected("conn-one"), selected("conn-two")];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      accounts.find((account) => !excluded?.has(account.connectionId)) || null,
    );
    mocks.handleChatCore.mockImplementation(async (options) => ({
      success: false,
      status: 429,
      error: "[429]: Rate limit exceeded",
      rateLimitEvidence: { state: "exhausted", resetAtMs: null, source: "local_policy" },
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));
    mocks.markAccountUnavailable.mockResolvedValue({
      shouldFallback: true,
      cooldownMs: 2_000,
      status: 429,
      retryAt: null,
      retryAtKnown: false,
    });

    const response = await handleChat(request());
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(payload.error.retry_after).toBeUndefined();
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
  });

  it("preserves the earliest complete retry deadline across attempted accounts", async () => {
    const accounts = [selected("conn-one"), selected("conn-two")];
    const first = new Date(Date.now() + 60_000).toISOString();
    const second = new Date(Date.now() + 30_000).toISOString();
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      accounts.find((account) => !excluded?.has(account.connectionId)) || null,
    );
    mocks.handleChatCore.mockImplementation(async (options) => ({
      success: false,
      status: 429,
      error: "[429]: Rate limit exceeded",
      rateLimitEvidence: { state: "cooldown", resetAtMs: Date.now() + 60_000, source: "retry_after" },
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));
    mocks.markAccountUnavailable
      .mockResolvedValueOnce({ shouldFallback: true, status: 429, retryAt: first, retryAtKnown: true })
      .mockResolvedValueOnce({ shouldFallback: true, status: 429, retryAt: second, retryAtKnown: true });

    const response = await handleChat(request());
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(payload.error.retry_after).toBe(second);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
