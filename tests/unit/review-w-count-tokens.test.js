import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), resolveKey: vi.fn(), modelInfo: vi.fn(), credentials: vi.fn(),
  policy: vi.fn(), core: vi.fn(), markUnavailable: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.settings }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.modelInfo }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.resolveKey,
  getProviderCredentials: mocks.credentials,
  markAccountUnavailable: mocks.markUnavailable,
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: mocks.policy }));
vi.mock("open-sse/handlers/countTokensCore.js", () => ({
  deriveCountTokensUrl: () => null,
  estimateTokens: () => 7,
  handleCountTokensCore: mocks.core,
}));

const { handleCountTokens } = await import("@/sse/handlers/countTokens.js");

function request() {
  return new Request("http://localhost/v1/messages/count_tokens", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet", messages: [{ role: "user", content: "hello" }] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ requireApiKey: true });
  mocks.resolveKey.mockResolvedValue({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "key-id" } });
  mocks.modelInfo.mockResolvedValue({ provider: "antigravity", model: "claude-sonnet" });
  mocks.credentials.mockResolvedValue({ connectionId: "shared-account", accessToken: "token" });
  mocks.policy.mockResolvedValue(null);
  mocks.markUnavailable.mockResolvedValue({ shouldFallback: false });
});

describe("count_tokens native admission and failure handling", () => {
  it("enforces windowed API key limits before native counting", async () => {
    mocks.core.mockResolvedValue({ success: true, response: Response.json({ input_tokens: 9 }) });

    const response = await handleCountTokens(request());

    expect(response.status).toBe(200);
    expect(mocks.policy).toHaveBeenCalledWith(expect.any(Request), "antigravity/claude-sonnet", "caller-key", { limits: true });
    expect(mocks.core).toHaveBeenCalledOnce();
  });

  it("leaves windowed limits off when counting stays local", async () => {
    mocks.modelInfo.mockResolvedValue({ provider: "openai", model: "gpt-test" });
    mocks.core.mockResolvedValue({ success: true, response: Response.json({ input_tokens: 7, approximate: true }) });

    const response = await handleCountTokens(request());

    expect(response.status).toBe(200);
    expect(mocks.policy).toHaveBeenCalledWith(expect.any(Request), "openai/gpt-test", "caller-key", { limits: false });
  });

  it("falls back to an estimate on upstream 429 without marking the shared account unavailable", async () => {
    mocks.core.mockResolvedValue({ success: false, status: 429, error: "limited" });

    const response = await handleCountTokens(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ input_tokens: 7, approximate: true });
    expect(mocks.markUnavailable).not.toHaveBeenCalled();
  });
});
