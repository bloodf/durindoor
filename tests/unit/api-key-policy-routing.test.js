import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  enforce: vi.fn(),
  record: vi.fn(async (_apiKey, response) => response),
  moderationCore: vi.fn(),
  rerankCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: vi.fn(() => "sk-test"),
  isValidApiKey: vi.fn(async () => true),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforce,
  recordApiKeyUsageForResponse: mocks.record,
}));
vi.mock("../../open-sse/handlers/moderationsCore.js", () => ({ handleModerationsCore: mocks.moderationCore }));
vi.mock("../../open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: mocks.rerankCore }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true }) }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));

const { handleModerations } = await import("../../src/sse/handlers/moderations.js");
const { handleRerank } = await import("../../src/sse/handlers/rerank.js");

function request(path, body) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
    body: JSON.stringify(body),
  });
}

function coreResult(status = 200) {
  return status < 300
    ? { success: true, status, response: new Response("ok", { status }) }
    : { success: false, status, error: "upstream failed", response: new Response("failed", { status }) };
}

describe("resolved-target API-key policy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, modelFallbacks: {} });
    mocks.getModelInfo.mockImplementation(async (name) => ({ provider: "openai", model: `${name}-resolved` }));
    mocks.enforce.mockResolvedValue(null);
    mocks.moderationCore.mockResolvedValue(coreResult());
    mocks.rerankCore.mockResolvedValue(coreResult());
  });

  it("blocks a denied canonical alias before moderation core execution", async () => {
    mocks.enforce.mockResolvedValue(new Response("denied", { status: 403 }));
    const response = await handleModerations(request("/v1/moderations", { model: "friendly-alias", input: "hello" }));

    expect(response.status).toBe(403);
    expect(mocks.enforce).toHaveBeenCalledWith(expect.any(Request), "openai/friendly-alias-resolved");
    expect(mocks.moderationCore).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("can skip a denied primary fallback target and records the allowed winner once", async () => {
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      modelFallbacks: { primary: { enabled: true, fallbacks: ["allowed"] } },
    });
    mocks.enforce.mockImplementation(async (_request, canonical) => (
      canonical === "openai/primary-resolved" ? new Response("denied", { status: 403 }) : null
    ));

    const response = await handleRerank(request("/v1/rerank", {
      model: "primary", query: "q", documents: ["one", "two"],
    }));

    expect(response.status).toBe(200);
    expect(mocks.rerankCore).toHaveBeenCalledOnce();
    expect(mocks.rerankCore.mock.calls[0][0].modelInfo.model).toBe("allowed-resolved");
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it.each([
    ["moderation", handleModerations, "/v1/moderations", { model: "safe", input: "hello" }, mocks.moderationCore],
    ["rerank", handleRerank, "/v1/rerank", { model: "safe", query: "q", documents: ["doc"] }, mocks.rerankCore],
  ])("accounts %s only after upstream success", async (_label, handler, path, body, core) => {
    core.mockResolvedValueOnce(coreResult(500));
    expect((await handler(request(path, body))).status).toBe(500);
    expect(mocks.record).not.toHaveBeenCalled();

    core.mockResolvedValueOnce(coreResult(200));
    expect((await handler(request(path, body))).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledOnce();
  });
});
