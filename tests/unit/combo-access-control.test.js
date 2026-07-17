import { beforeEach, describe, expect, it, vi } from "vitest";

// Behavioral coverage for upstream #2203: per-key combo access control.
// The guard lives in src/sse/handlers/chat.js (and siblings) and must reject a
// request whose API key is not granted the requested combo BEFORE the combo
// engine runs. We stub handleComboChat itself so the test exercises only the
// gate: denied -> 403 and handleComboChat never called; allowed -> gate passes
// and handleComboChat drives the 200.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  extractApiKey: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  isValidApiKey: vi.fn(async () => true),
  getProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
  isModelAllowed: vi.fn(() => true),
  recordApiKeyUsage: vi.fn(),
  recordApiKeyUsageForResponse: vi.fn(),
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: vi.fn(),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const API_KEY = "sk-test-key";

function makeRequest(model = "combo-privileged") {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

describe("per-key combo access control (#2203)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractApiKey.mockReturnValue(API_KEY);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true });
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false, usedTokens: 0, limitTokens: 0 });
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.getComboModels.mockImplementation(async (model) =>
      model === "combo-privileged" ? ["prov/model-a", "prov/model-b"] : null
    );
    mocks.getModelInfo.mockImplementation(async (modelStr) => ({ provider: "prov", model: modelStr }));
    mocks.handleComboChat.mockResolvedValue(new Response("ok", { status: 200 }));
    mocks.handleFusionChat.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("denies (403) a key whose allowedCombos does not include the requested combo, and never runs the combo engine", async () => {
    mocks.getApiKeyByKey.mockResolvedValue({
      name: "limited-key",
      allowedCombos: ["combo-other"], // does NOT include combo-privileged
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const res = await handleChat(makeRequest("combo-privileged"));

    expect(res.status).toBe(403);
    // Guard must short-circuit before the combo engine.
    expect(mocks.handleComboChat).not.toHaveBeenCalled();
    expect(mocks.handleFusionChat).not.toHaveBeenCalled();
    expect(mocks.enforceApiKeyModelPolicy).not.toHaveBeenCalled();
  });

  it("allows a key whose allowedCombos includes the requested combo and runs the combo engine (200)", async () => {
    mocks.getApiKeyByKey.mockResolvedValue({
      name: "granted-key",
      allowedCombos: ["combo-privileged"],
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const res = await handleChat(makeRequest("combo-privileged"));

    expect(res.status).toBe(200);
    expect(mocks.handleComboChat).toHaveBeenCalled();
  });

  it("empty allowedCombos means unrestricted: key runs the combo engine", async () => {
    mocks.getApiKeyByKey.mockResolvedValue({
      name: "open-key",
      allowedCombos: [],
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const res = await handleChat(makeRequest("combo-privileged"));

    expect(res.status).toBe(200);
    expect(mocks.handleComboChat).toHaveBeenCalled();
  });

});
