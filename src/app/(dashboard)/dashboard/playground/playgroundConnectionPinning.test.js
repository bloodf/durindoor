import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  getProviderConnections: vi.fn(),
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
  getProviderConnections: mocks.getProviderConnections,
  getQuotaReservationPressure: vi.fn(async () => new Map()),
}));

vi.mock("../../../../sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../../../sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: null,
    auth: await mocks.evaluateApiKeyAuth(null, { ...options, request }),
  }),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
  isProviderConnectionModelLocked: vi.fn(() => false),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
}));

vi.mock("../../../../sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../../../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../../../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("../../../../sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));

const { handleChat } = await import("../../../../sse/handlers/chat.js");

function request(body, { headers = {} } = {}) {
  const mergedHeaders = { "Content-Type": "application/json", ...headers };
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: mergedHeaders,
    body: JSON.stringify({
      model: "codex/gpt-5.4",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
      ...body,
    }),
  });
}

function connection(id, { isActive = true } = {}) {
  return { id, provider: "codex", isActive, name: id, email: `${id}@example.com` };
}

function selected(connectionId) {
  return {
    connectionId,
    connectionName: connectionId,
    accessToken: `access-${connectionId}`,
    providerSpecificData: {},
    _connection: connection(connectionId),
    _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
  };
}

const activeConnections = [connection("conn-one"), connection("conn-two")];

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
  mocks.getProviderConnections.mockImplementation(async ({ provider }) => {
    if (provider === "codex") return activeConnections;
    return [];
  });
  mocks.getProviderCredentials.mockImplementation(async (_provider, _excluded, _model, { preferredConnectionId }) => {
    if (preferredConnectionId) return selected(preferredConnectionId);
    return selected("conn-one");
  });
  mocks.projectProviderCredentials.mockImplementation(async (conn, quota) => ({
    ...selected(conn.id),
    _connection: conn,
    _quotaPreflight: quota,
  }));
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
  mocks.clearAccountError.mockResolvedValue();
  mocks.handleChatCore.mockImplementation(async (options) => {
    await options.onRequestSuccess();
    return {
      success: true,
      response: new Response("data: {\"ok\":true}\n\ndata: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    };
  });
  mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
  mocks.refreshProviderQuota.mockResolvedValue({});
});

describe("connection pinning", () => {
  it("passes x-connection-id header to preflight as preferredConnectionId", async () => {
    await handleChat(request({}, { headers: { "x-connection-id": "conn-two" } }));
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "codex",
      expect.any(Set),
      "gpt-5.4",
      expect.objectContaining({ preferredConnectionId: "conn-two" }),
    );
  });

  it("accepts connectionId in body for backwards compatibility", async () => {
    await handleChat(request({ connectionId: "conn-two" }));
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "codex",
      expect.any(Set),
      "gpt-5.4",
      expect.objectContaining({ preferredConnectionId: "conn-two" }),
    );
  });

  it("accepts connection_id in body for backwards compatibility", async () => {
    await handleChat(request({ connection_id: "conn-two" }));
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "codex",
      expect.any(Set),
      "gpt-5.4",
      expect.objectContaining({ preferredConnectionId: "conn-two" }),
    );
  });

  it("returns 400 when the requested connection id is not active for the provider", async () => {
    const response = await handleChat(request({}, { headers: { "x-connection-id": "unknown" } }));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.message).toContain("unknown");
    expect(payload.error.message).toContain("codex");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("returns 400 when the requested connection id belongs to a different provider", async () => {
    const response = await handleChat(request({}, { headers: { "x-connection-id": "openai-only" } }));
    expect(response.status).toBe(400);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("strips connectionId and connection_id from body before upstream dispatch", async () => {
    await handleChat(request({ connectionId: "conn-two", connection_id: "conn-two", extra: "keep" }));
    const coreCall = mocks.handleChatCore.mock.calls[0][0];
    const upstreamBody = coreCall.body;
    expect(upstreamBody).not.toHaveProperty("connectionId");
    expect(upstreamBody).not.toHaveProperty("connection_id");
    expect(upstreamBody.extra).toBe("keep");
  });

  it("does not rotate to another connection when pinned connection fails", async () => {
    mocks.handleChatCore.mockImplementation(async () => ({
      success: false,
      status: 429,
      error: "rate limit",
      response: new Response(JSON.stringify({ error: "rate limit" }), { status: 429 }),
    }));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
    const response = await handleChat(request({}, { headers: { "x-connection-id": "conn-two" } }));
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    const coreCall = mocks.handleChatCore.mock.calls[0][0];
    expect(coreCall.connectionId).toBe("conn-two");
    expect(response.status).toBe(429);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("does not rotate on local quota capacity race for a pinned connection", async () => {
    mocks.handleChatCore.mockImplementation(async () => ({
      success: false,
      status: 503,
      quotaCapacityUnavailable: true,
      error: "capacity unavailable",
      response: new Response(JSON.stringify({ error: "capacity unavailable" }), { status: 503 }),
    }));
    const response = await handleChat(request({}, { headers: { "x-connection-id": "conn-two" } }));
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns unavailable response when all pinned connections are rate limited", async () => {
    mocks.getProviderCredentials.mockImplementation(async () => ({
      allRateLimited: true,
      lastError: "Rate limit exceeded",
      lastErrorCode: 429,
      retryAfter: 1234567890,
    }));
    const response = await handleChat(request({}, { headers: { "x-connection-id": "conn-two" } }));
    expect(response.status).toBe(429);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("returns 400 when selected credential does not match the pin", async () => {
    mocks.getProviderCredentials.mockImplementation(async () => selected("conn-one"));
    const response = await handleChat(request({}, { headers: { "x-connection-id": "conn-two" } }));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.message).toContain("conn-two");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
