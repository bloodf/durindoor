import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  loadCustomCapabilities: vi.fn(),
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
  loadCustomCapabilities: mocks.loadCustomCapabilities,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "sk-test"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true, stored: true })),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "sk-test", auth: { ok: true, stored: true } })),
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
vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(content, overrides = {}) {
  return new Request("http://localhost/v1/chat/completions", {
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
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null); // allow
    mocks.loadCustomCapabilities.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({ apiKey: "k" });
    mocks.handleChatCore.mockResolvedValue(new Response("{}", { status: 200 }));
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
});
