import { afterEach, describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const m = vi.hoisted(() => ({ credentials: vi.fn(), mark: vi.fn(), usage: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials, getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: m.mark, clearAccountError: vi.fn(),
  resolveClientApiKey: async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-6-sol-image" }),
  getComboModels: async () => null, getComboCanonicalName: async () => null
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: m.usage, recordApiKeyUsage: vi.fn() }));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => {}, getRequestId: () => "fixture", withRequestCorrelation: (fn) => fn }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn() }));
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
const parse = (text) => codex.parseResponse(sse(text), {}).catch((error) => error);

afterEach(() => vi.unstubAllGlobals());

describe("9router #3870 - Codex image stream failures keep their status", () => {
  it.each([
    ["response.failed", { response: { error: { code: "rate_limit_exceeded", message: "slow down" } } }, 429],
    ["response.failed", { response: { error: { type: "usage_limit_reached", message: "limit" } } }, 429],
    ["error", { code: "model_not_found", message: "no such model" }, 404],
    ["error", { error: { code: "invalid_api_key", message: "bad key" } }, 401],
    ["error", { message: "The 'x' model requires a newer version of Codex." }, 400],
    ["error", { status_code: 503, message: "busy" }, 503],
    ["response.failed", { response: { error: { code: "server_error", message: "boom" } } }, undefined],
  ])("classifies %s %j", async (event, data, status) => {
    expect((await parse(frame(event, data))).status).toBe(status);
  });

  it("returns that status from the buffered image handler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(frame("response.failed", { response: { error: { code: "rate_limit_exceeded", message: "slow down" } } }))));
    const result = await handleImageGenerationCore({
      body: { prompt: "a square" },
      modelInfo: { provider: "codex", model: "gpt-5.4-image" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    expect(result).toMatchObject({ success: false, status: 429 });
  });

  it.each([["rate_limit_exceeded", 429, true], ["invalid_api_key", 401, true], ["model_not_found", 404, true], ["request_rejected", 400, false]])(
    "settles streamed %s in-band and updates account health only when appropriate", async (code, status, penalized) => {
      m.credentials.mockReset().mockResolvedValue({ connectionId: "account", accessToken: "sent-token", _connection: { accessToken: "sent-token" } });
      m.mark.mockReset().mockResolvedValue({ shouldFallback: true });
      m.usage.mockReset().mockImplementation(async (_key, response) => response);
      vi.stubGlobal("fetch", vi.fn(async () => sse(frame("error", { error: { code, status_code: status, message: "provider failure" } }))));
      const response = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
        method: "POST", headers: { accept: "text/event-stream" },
        body: JSON.stringify({ model: "codex/gpt-6-sol-image", prompt: "square" })
      }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("event: error");
      expect(m.mark).toHaveBeenCalledTimes(penalized ? 1 : 0);
      if (penalized) expect(m.mark).toHaveBeenCalledWith("account", status, "provider failure", "codex", "gpt-6-sol-image", null,
        expect.objectContaining({ usedCredential: "sent-token", credentialFingerprint: expect.any(String), dispatchedAt: expect.any(Number) }));
      expect(m.usage).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["success", "cancel"])("settles a streamed %s at most once", async (kind) => {
    m.credentials.mockReset().mockResolvedValue({ connectionId: "account", accessToken: "sent-token" });
    m.mark.mockReset();
    m.usage.mockReset().mockImplementation(async (_key, response) => response);
    vi.stubGlobal("fetch", vi.fn(async () => sse(frame("response.completed", { response: { status: "completed", output: [{ type: "image_generation_call", result: "eA==" }] } }))));
    const response = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST", headers: { accept: "text/event-stream" },
      body: JSON.stringify({ model: "codex/gpt-6-sol-image", prompt: "square" })
    }));
    if (kind === "cancel") await response.body.cancel();
    else expect(await response.text()).toContain("event: done");
    expect(m.mark).not.toHaveBeenCalled();
    expect(m.usage).toHaveBeenCalledTimes(kind === "success" ? 1 : 0);
  });
});
