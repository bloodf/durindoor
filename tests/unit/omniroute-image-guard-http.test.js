import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ exceeded: false, usedTokens: 0, limitTokens: 0 })),
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
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "test-key"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function makeRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "draw a cat" }] }),
  });
}

describe("#6525 /v1/chat/completions rejects image-only models before dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
    });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
  });

  it("returns 400 pointing at /v1/images/generations and never calls handleChatCore", async () => {
    // cloudflare-ai/@cf/black-forest-labs/flux-2-dev is registered kind:"image"
    // (registry line 43); the same provider also serves chat models (mixed).
    mocks.getModelInfo.mockResolvedValue({ provider: "cloudflare-ai", model: "@cf/black-forest-labs/flux-2-dev" });

    const res = await handleChat(makeRequest("cloudflare-ai/@cf/black-forest-labs/flux-2-dev"));

    expect(res.status).toBe(400);
    const body = await res.json();
    const msg = body?.error?.message || JSON.stringify(body);
    expect(msg).toMatch(/image-generation model/i);
    expect(msg).toMatch(/\/v1\/images\/generations/);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("does not fire for a chat model (guard is invisible)", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", "model": "gpt-4o" });
    mocks.getProviderCredentials.mockResolvedValue(null); // forces the unavailable path

    const res = await handleChat(makeRequest("openai/gpt-4o"));

    // Whatever the downstream result, it must NOT be the image-guard 400.
    if (res.status === 400) {
      const body = await res.json();
      const msg = body?.error?.message || JSON.stringify(body);
      expect(msg).not.toMatch(/image-generation model/i);
    }
  });
});
