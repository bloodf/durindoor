import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getComboForModel: vi.fn(),
  getSettings: vi.fn(),
  handleChatCore: vi.fn(),
  recordTokenSaverEvent: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  hasValidCliToken: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
  getProjectIdForConnection: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: (connection) => connection,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: mocks.extractApiKey(request),
    auth: await mocks.evaluateApiKeyAuth(mocks.extractApiKey(request), { ...options, request }),
  }),
  hasValidCliToken: mocks.hasValidCliToken,
  isProviderConnectionModelLocked: () => false,
  providerAllowsPublicNoAuthFallback: () => false,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: mocks.getProjectIdForConnection,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboForModel: mocks.getComboForModel,
  getProxyPools: vi.fn(() => []),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/usageDb", () => ({
  recordTokenSaverEvent: mocks.recordTokenSaverEvent,
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));

function makeRequest(model = "combo-fallback") {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

async function loadHandler() {
  const { handleChat } = await import("../../src/sse/handlers/chat.js");
  return handleChat;
}

describe("combo token-saver telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
    });
    mocks.getComboForModel.mockImplementation(async (model) => {
      const models = await mocks.getComboModels(model);
      return models ? { name: model, models } : null;
    });
    mocks.getComboModels.mockImplementation(async (model) => {
      if (model === "combo-fallback") return ["first/bad", "second/ok"];
      if (model === "nested-combo") return ["nested/bad", "nested/ok"];
      if (model === "outer-combo") return ["nested-combo", "standalone/ok"];
      return null;
    });
    mocks.getModelInfo.mockImplementation(async (modelStr) => {
      if (modelStr === "nested-combo") return { provider: null, model: "nested-combo" };
      const [provider, name] = modelStr.split("/");
      return { provider, model: name };
    });
    mocks.getProviderCredentials.mockImplementation(async (provider, excludeConnectionIds) => {
      const excluded = new Set(excludeConnectionIds || []);
      if (excluded.has(`${provider}-1`)) return null;
      return {
        connectionId: `${provider}-1`,
        connectionName: `${provider}-1`,
        accessToken: "tok",
        _quotaPreflight: null,
      };
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0 });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, reason: null, stored: false });
    mocks.hasValidCliToken.mockResolvedValue(false);
  });

  it("persists one token-saver row after combo fallback succeeds (#306)", async () => {
    const handleChat = await loadHandler();

    mocks.handleChatCore.mockImplementation(async ({ modelInfo, onTokenSaverEvent }) => {
      if (modelInfo.provider === "first") {
        onTokenSaverEvent({ rtk: { bytesSaved: 10 }, headroom: { state: "disabled" } });
        return { success: false, status: 503, error: "down" };
      }
      onTokenSaverEvent({ rtk: { bytesSaved: 20 }, headroom: { state: "disabled" } });
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(makeRequest());
    expect(response.status).toBe(200);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledWith(
      expect.objectContaining({ rtk: expect.objectContaining({ bytesSaved: 20 }) })
    );
  });

  it("persists one token-saver row even when all combo models fail", async () => {
    const handleChat = await loadHandler();

    mocks.handleChatCore.mockImplementation(async ({ modelInfo, onTokenSaverEvent }) => {
      onTokenSaverEvent({
        rtk: { bytesSaved: modelInfo.provider === "first" ? 5 : 7 },
        headroom: { state: "disabled" },
      });
      return { success: false, status: 503, error: "down" };
    });

    const response = await handleChat(makeRequest());
    expect(response.status).toBe(503);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledWith(
      expect.objectContaining({ rtk: expect.objectContaining({ bytesSaved: 7 }) })
    );
  });

  it("does not double-count nested combo fallback rows", async () => {
    const handleChat = await loadHandler();
    const attemptedModels = [];

    mocks.handleChatCore.mockImplementation(async ({ modelInfo, onTokenSaverEvent }) => {
      const { provider, model } = modelInfo;
      attemptedModels.push(`${provider}/${model}`);
      const ok = provider === "standalone" && model === "ok";
      const bytes = ok ? 30 : 3;
      onTokenSaverEvent({ rtk: { bytesSaved: bytes }, headroom: { state: "disabled" } });
      if (ok) {
        return { success: true, response: new Response("ok", { status: 200 }) };
      }
      return { success: false, status: 503, error: "down" };
    });

    const response = await handleChat(makeRequest("outer-combo"));
    expect(response.status).toBe(200);
    expect(attemptedModels).toContain("nested/bad");
    expect(attemptedModels).toContain("nested/ok");
    expect(attemptedModels).toContain("standalone/ok");
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledWith(
      expect.objectContaining({ rtk: expect.objectContaining({ bytesSaved: 30 }) })
    );
  });
});
