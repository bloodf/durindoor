import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  isExactRoutableModelId: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  loadCustomCapabilities: vi.fn(),
  warmLiveModelLimits: vi.fn(),
  resolveClientApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  createRoutableModelIdChecker: vi.fn(() => mocks.isExactRoutableModelId),
  loadCustomCapabilities: mocks.loadCustomCapabilities,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "sk-test"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true, stored: true })),
  resolveClientApiKey: mocks.resolveClientApiKey,
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));
vi.mock("../../open-sse/services/liveModelLimits.js", () => ({
  warmLiveModelLimits: mocks.warmLiveModelLimits,
}));
vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
function chatRequest(content, overrides = {}) {
  return new Request(overrides.url || "http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
      ...(overrides.headers || {}),
    },
    body: JSON.stringify({
      model: overrides.model || "openai/gpt-4o",
      messages: [{ role: "user", content }],
      stream: false,
      ...overrides.body,
    }),
  });
}

describe("chat policy enforcement sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      comboStickyRoundRobinLimit: 0,
      hidePaidModels: false,
    });
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "key-id",
      key: "sk-test",
      allowedModels: null,
      allowedCombos: null,
    });
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.getApiKeyUsageTotals.mockResolvedValue({});
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isExactRoutableModelId.mockResolvedValue(false);
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null); // allow
    mocks.loadCustomCapabilities.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({ apiKey: "k" });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("{}", { status: 200 }) });
    mocks.warmLiveModelLimits.mockReturnValue(undefined);
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "sk-test", auth: { ok: true, stored: true } });
  });

  it("checks policy exactly once for a non-vision request (original model)", async () => {
    await handleChat(chatRequest("hello"));
    // Exactly one policy call on the original resolved target.
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledTimes(1);
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledWith(
      expect.any(Request),
      "openai/gpt-4o",
      "sk-test",
    );
  });

  it("warms live limits without delaying or failing dispatch", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "api-airforce", model: "x-ai/grok-3" });
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "catalog-key",
      providerSpecificData: {},
    });
    mocks.warmLiveModelLimits.mockImplementation(() => { throw new Error("warm failed"); });

    const response = await handleChat(chatRequest("hello", { model: "api-airforce/x-ai/grok-3" }));

    expect(response.status).toBe(200);
    expect(mocks.warmLiveModelLimits).toHaveBeenCalledWith(
      "api-airforce",
      expect.objectContaining({ apiKey: "catalog-key" }),
      expect.objectContaining({ endpoint: "https://api.airforce/v1/models" }),
    );
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
  });

  it("denied original model returns 403 without credentials or dispatch", async () => {
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(
      new Response(JSON.stringify({ error: "Model not allowed" }), { status: 403 }),
    );
    const res = await handleChat(chatRequest("hello"));
    expect(res.status).toBe(403);
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledOnce();
    expect(mocks.loadCustomCapabilities).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("does no routability work before the API-key gate", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: null, auth: { ok: false, reason: "invalid" } });

    const response = await handleChat(chatRequest("hello", {
      model: "claude-openai/gpt-5.5[1m]",
      url: "http://localhost/v1/messages",
      headers: { "anthropic-version": "2023-06-01" },
    }));

    expect(response.status).toBe(401);
    expect(mocks.isExactRoutableModelId).not.toHaveBeenCalled();
  });

  it("does not decode Claude-compatible spellings on OpenAI endpoints", async () => {
    const model = "claude-openai/gpt-5.5[1m]";
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model });
    mocks.isExactRoutableModelId.mockImplementation(async (candidate) => candidate === "openai/gpt-5.5");

    await handleChat(chatRequest("hello", { model }));

    expect(mocks.isExactRoutableModelId).not.toHaveBeenCalled();
    expect(mocks.getComboModels).toHaveBeenCalledWith(model, false);
    expect(mocks.getModelInfo).toHaveBeenCalledWith(model);
  });
  it("normalizes a projected Claude route before policy and preserves original identity", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-5.5" });
    mocks.isExactRoutableModelId.mockImplementation(async (candidate) => candidate === "openai/gpt-5.5");
    await handleChat(chatRequest("hello", {
      model: "claude-openai/gpt-5.5[1m]",
      url: "http://localhost/v1/messages",
      headers: { "anthropic-version": "2023-06-01" },
    }));

    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledWith(
      expect.any(Request),
      "openai/gpt-5.5",
      "sk-test",
    );
    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      clientRawRequest: expect.objectContaining({
        originalModel: "claude-openai/gpt-5.5[1m]",
        body: expect.objectContaining({ model: "claude-openai/gpt-5.5[1m]" }),
      }),
    }));
  });

  it("keeps Claude's context-1m beta in the outbound header overlay after decode", async () => {
    mocks.isExactRoutableModelId.mockImplementation(async (candidate) => candidate === "openai/gpt-5.5");
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-5.5" });
    await handleChat(chatRequest("hello", {
      model: "claude-openai/gpt-5.5[1m]",
      url: "http://localhost/v1/messages",
      headers: {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "context-1m-2025-08-07",
        "x-app": "cli",
      },
    }));

    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const headers = new DefaultExecutor("claude").buildHeaders({ apiKey: "k" }, false);
    expect(headers["anthropic-beta"]).toContain("context-1m-2025-08-07");
  });

  it("preserves the documented GLM bracket spelling through model resolution", async () => {
    const model = "glm/glm-5.3[1m]";
    mocks.isExactRoutableModelId.mockImplementation(async (candidate) => candidate === model);
    mocks.getModelInfo.mockResolvedValue({ provider: "zai", model: "glm-5.3[1m]" });

    await handleChat(chatRequest("hello", {
      model: `claude-${model}`,
      url: "http://localhost/v1/messages",
      headers: { "anthropic-version": "2023-06-01" },
    }));

    expect(mocks.getComboModels).toHaveBeenCalledWith(model, false);
    expect(mocks.getModelInfo).toHaveBeenCalledWith(model);
  });

  it("passes an unknown official Claude model through to resolution intact", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-unknown-xyz" });
    await handleChat(chatRequest("hello", {
      model: "claude-sonnet-unknown-xyz",
      headers: { "anthropic-version": "2023-06-01" },
      url: "http://localhost/v1/messages",
    }));

    expect(mocks.getComboModels).toHaveBeenCalledWith("claude-sonnet-unknown-xyz", false);
    expect(mocks.getModelInfo).toHaveBeenCalledWith("claude-sonnet-unknown-xyz");
  });
});
