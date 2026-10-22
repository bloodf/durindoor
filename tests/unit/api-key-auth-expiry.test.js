import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeyByKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getBillingEpoch: vi.fn(),
  captureRequestBillingEpoch: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: mocks.getBillingEpoch }));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: mocks.captureRequestBillingEpoch,
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
  getProviderConnections: vi.fn(),
  getProxyPools: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
}));

const { evaluateApiKeyAuth, extractApiKey, extractApiKeyCandidates, resolveClientApiKey } = await import("../../src/sse/services/auth.js");

describe("API-key authentication expiry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("operator-token");
    // Keep both admission paths isolated from the database and request cache.
    mocks.getBillingEpoch.mockResolvedValue("direct-epoch");
    mocks.captureRequestBillingEpoch.mockResolvedValue("request-epoch");
  });

  it("accepts only the valid operator token without borrowing a stored API key", async () => {
    const request = new Request("http://localhost/v1/chat", { headers: { "x-9r-cli-token": "operator-token" } });
    await expect(evaluateApiKeyAuth(null, { required: true, request })).resolves.toMatchObject({ ok: true, operator: true, stored: false });
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();

    const invalid = new Request("http://localhost/v1/chat", { headers: { "x-9r-cli-token": "wrong" } });
    await expect(evaluateApiKeyAuth(null, { required: true, request: invalid })).resolves.toMatchObject({ ok: false, reason: "missing" });
  });

  it("rejects a credentialless request without borrowing a stored API key", async () => {
    const storedApiKey = "sk-valid-stored";
    mocks.getApiKeyByKey.mockImplementation(async (key) => key === storedApiKey
      ? { isActive: true, expiresAt: null }
      : null);
    const request = new Request("http://localhost/v1/chat");

    expect(extractApiKeyCandidates(request)).toEqual([]);
    await expect(resolveClientApiKey(request, { required: true })).resolves.toMatchObject({
      apiKey: null,
      auth: { ok: false, reason: "missing", stored: false },
    });
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalledWith(storedApiKey);
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();
  });

  it.each([
    ["authorization", { Authorization: "Bearer sk-bearer" }, "http://localhost/v1/chat", "sk-bearer"],
    ["Anthropic", { "x-api-key": "sk-anthropic" }, "http://localhost/v1/messages", "sk-anthropic"],
    ["Gemini header", { "x-goog-api-key": "sk-google" }, "http://localhost/v1beta/models", "sk-google"],
    ["Gemini query", {}, "http://localhost/v1beta/models?key=sk-query", "sk-query"],
  ])("extracts the %s credential shape", (_label, headers, url, expected) => {
    expect(extractApiKey(new Request(url, { headers }))).toBe(expected);
  });

  it("resolves a valid x-api-key when the Bearer credential is stale", async () => {
    mocks.getApiKeyByKey.mockImplementation(async (key) => key === "sk-valid"
      ? { id: "valid-key-id", isActive: true, expiresAt: null }
      : null);
    const request = new Request("http://localhost/v1/messages", {
      headers: {
        Authorization: "Bearer stale-session-token",
        "x-api-key": "sk-valid",
      },
    });

    expect(extractApiKeyCandidates(request)).toEqual(["stale-session-token", "sk-valid"]);
    await expect(resolveClientApiKey(request, { required: true })).resolves.toMatchObject({
      apiKey: "sk-valid",
      auth: { ok: true, stored: true, apiKeyId: "valid-key-id", billingEpoch: "request-epoch" },
    });
    expect(mocks.captureRequestBillingEpoch).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.captureRequestBillingEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getApiKeyByKey.mock.invocationCallOrder[0],
    );
    expect(mocks.getBillingEpoch).not.toHaveBeenCalled();
  });

  it("rejects when every presented credential is invalid", async () => {
    mocks.getApiKeyByKey.mockResolvedValue(null);
    const request = new Request("http://localhost/v1/messages", {
      headers: {
        Authorization: "Bearer stale-session-token",
        "x-api-key": "sk-invalid",
      },
    });

    await expect(resolveClientApiKey(request, { required: true })).resolves.toMatchObject({
      apiKey: "stale-session-token",
      auth: { ok: false, reason: "invalid", stored: false },
    });
  });

  it("requires a key only when configured", async () => {
    await expect(evaluateApiKeyAuth(null, { required: false, now: 1 })).resolves.toMatchObject({
      ok: true,
      reason: null,
      stored: false,
    });
    await expect(evaluateApiKeyAuth(null, { required: true, now: 1 })).resolves.toMatchObject({
      ok: false,
      reason: "missing",
      stored: false,
    });
  });

  it("allows unknown local placeholders only while enforcement is disabled", async () => {
    mocks.getApiKeyByKey.mockResolvedValue(null);

    await expect(evaluateApiKeyAuth("sk_durindoor", { required: false, now: 1 })).resolves.toMatchObject({ ok: true, stored: false });
    await expect(evaluateApiKeyAuth("sk_durindoor", { required: true, now: 1 })).resolves.toMatchObject({ ok: false, reason: "invalid", stored: false });
  });

  it.each([
    ["inactive", { isActive: false, expiresAt: null }],
    ["inactive and expired", { isActive: false, expiresAt: "2029-12-31T23:59:59.999Z" }],
    ["expired", { isActive: true, expiresAt: "2029-12-31T23:59:59.999Z" }],
    ["exact boundary", { isActive: true, expiresAt: "2030-01-01T00:00:00.000Z" }],
    ["malformed", { isActive: true, expiresAt: "not-a-date" }],
    ["empty", { isActive: true, expiresAt: "" }],
  ])("rejects a stored %s key even when enforcement is disabled", async (_label, record) => {
    mocks.getApiKeyByKey.mockResolvedValue(record);

    await expect(evaluateApiKeyAuth("sk-stored", {
      required: false,
      now: Date.parse("2030-01-01T00:00:00.000Z"),
    })).resolves.toMatchObject({ ok: false, reason: "invalid", stored: true });
  });

  it("accepts an active future or non-expiring stored key", async () => {
    mocks.getApiKeyByKey
      .mockResolvedValueOnce({ id: "never-key-id", isActive: true, expiresAt: null })
      .mockResolvedValueOnce({ id: "future-key-id", isActive: true, expiresAt: "2030-01-01T00:00:00.001Z" });

    await expect(evaluateApiKeyAuth("sk-never", { required: true, now: Date.parse("2030-01-01T00:00:00Z") })).resolves.toMatchObject({ ok: true, stored: true, apiKeyId: "never-key-id", billingEpoch: "direct-epoch" });
    await expect(evaluateApiKeyAuth("sk-future", { required: true, now: Date.parse("2030-01-01T00:00:00Z") })).resolves.toMatchObject({ ok: true, stored: true, apiKeyId: "future-key-id", billingEpoch: "direct-epoch" });
    expect(mocks.getBillingEpoch).toHaveBeenCalledTimes(2);
    expect(mocks.captureRequestBillingEpoch).not.toHaveBeenCalled();
  });
});
