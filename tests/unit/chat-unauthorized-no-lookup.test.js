import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
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
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "sk-test"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true, stored: true })),
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

describe("unauthorized chat request performs no provider dispatch", () => {
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
    // Policy denies the resolved model
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(
      new Response(JSON.stringify({ error: "Model not allowed" }), { status: 403 }),
    );
    mocks.loadCustomCapabilities.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({ apiKey: "k" });
    mocks.handleChatCore.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("denied model policy returns 403 without capability lookup, credentials, or dispatch", async () => {
    const res = await handleChat(chatRequest("hello"));

    expect(res.status).toBe(403);

    // Model resolution runs to resolve the policy target.
    expect(mocks.getModelInfo).toHaveBeenCalled();

    // Capability DB lookup must not run for a denied request.
    expect(mocks.loadCustomCapabilities).not.toHaveBeenCalled();
    // Policy was checked exactly once on the resolved target.
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledOnce();

    // No credentials fetched, no provider dispatch after denial.
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
