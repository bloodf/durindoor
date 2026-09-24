/**
 * Providers with no chat transport (Laya, media-only providers) must never be
 * dispatched on the chat endpoints: the executor lookup would fall back to the
 * OpenAI default and send the prompt and the connection key there.
 */
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
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "test-key", auth: { ok: true } })),
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

const { handleChat, isNonChatModel } = await import("../../src/sse/handlers/chat.js");

function makeRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }] }),
  });
}

describe("chat endpoints reject non-chat models before credentials or dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback", comboStickyRoundRobinLimit: 1 });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
  });

  it("refuses a Laya checkpoint, so the prompt and key never reach the OpenAI fallback", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "laya", model: "english" });
    const res = await handleChat(makeRequest("laya/english"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/not a chat model/);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("refuses models of media-only providers without a chat transport", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "local-whisper", model: "whisper-1" });
    const res = await handleChat(makeRequest("local-whisper/whisper-1"));
    expect(res.status).toBe(400);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});

describe("isNonChatModel", () => {
  it("flags decision models and transport-less non-llm providers only", () => {
    expect(isNonChatModel("laya", "english")).toBe(true);
    expect(isNonChatModel("laya", "unknown-checkpoint")).toBe(true);
    expect(isNonChatModel("tavily", "search")).toBe(true);
    expect(isNonChatModel("openai", "gpt-4o")).toBe(false);
    expect(isNonChatModel("cloudflare-ai", "@cf/meta/llama-3.3-70b-instruct")).toBe(false);
    expect(isNonChatModel("does-not-exist", "nope")).toBe(false);
  });
});
