import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ credentials: vi.fn(), mark: vi.fn(), usage: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(), markAccountUnavailable: m.mark, clearAccountError: vi.fn(),
  resolveClientApiKey: async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-6-sol-image" }),
  getComboModels: async () => null, getComboCanonicalName: async () => null
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: m.usage, recordApiKeyUsage: vi.fn()
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => {}, getRequestId: () => "fixture", withRequestCorrelation: (fn) => fn }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn() }));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

const now = 1800000000000;
const core = () => handleImageGenerationCore({ body: { prompt: "fixture" }, modelInfo: { provider: "codex", model: "gpt-6-sol-image" }, credentials: { accessToken: "fixture" } });
const failure = (error) => Response.json({ error }, { status: 429 });
const request = () => new Request("http://localhost/v1/images/generations", { method: "POST", body: JSON.stringify({ model: "codex/gpt-6-sol-image", prompt: "fixture" }) });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", vi.fn());
  m.credentials.mockReset(); m.mark.mockReset(); m.usage.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pinned image quota reset port", () => {
  it.each([
    [{ resets_at: now / 1000 + 600 }, now + 600000],
    [{ resets_in_seconds: 600 }, now + 600000]
  ])("retains a bounded Codex reset %#", async (fields, expected) => {
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", ...fields }));
    const result = await core();
    expect(result.rateLimitEvidence).toMatchObject({ state: "exhausted", resetAtMs: expected });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { type: "usage_limit_reached" },
    { type: "usage_limit_reached", resets_in_seconds: 999999999 },
    { type: "rate_limit_exceeded", resets_at: now / 1000 + 600 }
  ])("keeps ordinary fallback when exhaustion and a bounded reset are not both proven %#", async (error) => {
    fetch.mockResolvedValueOnce(failure(error));
    const result = await core();
    expect(result.rateLimitEvidence).toBeUndefined();
    expect(result.resetsAtMs).toBeUndefined();
  });
  it("locks only the failed account and model, then charges the successful fallback once", async () => {
    m.credentials.mockResolvedValueOnce({ connectionId: "a", accessToken: "fixture-a" }).mockResolvedValueOnce({ connectionId: "b", accessToken: "fixture-b" });
    m.mark.mockResolvedValue({ shouldFallback: true });
    m.usage.mockImplementation(async (_key, response) => response);
    fetch.mockResolvedValueOnce(failure({ type: "usage_limit_reached", resets_in_seconds: 600 }))
      .mockResolvedValueOnce(new Response('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"image_generation_call","result":"eA=="}]}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const response = await handleImageGeneration(request());
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(m.mark).toHaveBeenCalledTimes(1);
    expect(m.mark.mock.calls[0]).toMatchObject({ 0: "a", 1: 429, 3: "codex", 4: "gpt-6-sol-image", 5: now + 600000, 6: { rateLimitEvidence: { state: "exhausted", resetAtMs: now + 600000 }, usedCredential: "fixture-a" } });
    expect(m.credentials.mock.calls[1][1]).toEqual(new Set(["a"]));
    expect(m.usage).toHaveBeenCalledTimes(1);
  });
});
