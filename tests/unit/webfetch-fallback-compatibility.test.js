import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearProviderConnectionFallbackState: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
  getProviderConnections: vi.fn(),
  recordProviderConnectionFallbackState: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  clearProviderConnectionFallbackState: mocks.clearProviderConnectionFallbackState,
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: vi.fn(async () => ({})),
  recordProviderConnectionFallbackState: mocks.recordProviderConnectionFallbackState,
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(),
}));

vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: mocks.clearProviderRateLimitEvidence,
}));

const { clearAccountError, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const WEBFETCH_LOCK = new Date(NOW + 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearProviderConnectionFallbackState.mockRejectedValue(new Error("compatibility clear"));
  mocks.recordProviderConnectionFallbackState.mockRejectedValue(new Error("compatibility record"));
  mocks.getProviderConnections.mockResolvedValue([{
    id: "ollama-1",
    provider: "ollama",
    backoffLevel: 3,
  }]);
});

describe("web-fetch fallback compatibility updates", () => {
  it("records only the web-fetch lock when atomic persistence is unavailable", async () => {
    await markAccountUnavailable(
      "ollama-1",
      503,
      "fetch failed",
      "ollama",
      null,
      null,
      { attemptStartedAt: NOW, webFetch: true },
    );

    expect(mocks.updateProviderConnection).toHaveBeenCalledOnce();
    const patch = mocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(patch)).toEqual(["modelLock_webfetch:ollama"]);
    expect(Date.parse(patch["modelLock_webfetch:ollama"])).toBeGreaterThan(NOW);
  });

  it("clears only the web-fetch lock and preserves chat health", async () => {
    await clearAccountError("ollama-1", {
      provider: "ollama",
      "modelLock_webfetch:ollama": WEBFETCH_LOCK,
      "modelLock_gpt-oss:120b": new Date(NOW - 1_000).toISOString(),
      testStatus: "unavailable",
      lastError: "Chat failed",
      lastErrorAt: new Date(NOW - 1_000).toISOString(),
      backoffLevel: 3,
    }, null, { attemptStartedAt: NOW, provider: "ollama", webFetch: true });

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("ollama-1", {
      "modelLock_webfetch:ollama": null,
    });
  });

  it("restores chat health without clearing or counting the web-fetch lock", async () => {
    await clearAccountError("ollama-1", {
      provider: "ollama",
      "modelLock_webfetch:ollama": WEBFETCH_LOCK,
      "modelLock_gpt-oss:120b": new Date(NOW + 120_000).toISOString(),
      testStatus: "unavailable",
      lastError: "Chat failed",
      lastErrorAt: new Date(NOW - 1_000).toISOString(),
      backoffLevel: 3,
    }, "gpt-oss:120b", { attemptStartedAt: NOW, provider: "ollama" });

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("ollama-1", {
      "modelLock_gpt-oss:120b": null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
  });
});

describe("web-search fallback compatibility updates", () => {
  it("records search-only failure without changing chat health", async () => {
    await markAccountUnavailable("ollama-1", 429, "rate limited", "ollama", "websearch:ollama", null, {
      attemptStartedAt: NOW, webSearch: true,
    });
    const patch = mocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(patch).sort()).toEqual(["modelError_websearch:ollama", "modelLock_websearch:ollama"]);
    expect(Date.parse(patch["modelLock_websearch:ollama"])).toBeGreaterThan(NOW);
  });

  it("clears search only; chat success cannot clear an expired search lock", async () => {
    const expired = new Date(NOW - 1_000).toISOString();
    const connection = {
      provider: "ollama", testStatus: "unavailable", lastError: "Chat failed",
      "modelLock_websearch:ollama": expired,
      "modelLock_gpt-oss:120b": new Date(NOW + 60_000).toISOString(),
    };
    await clearAccountError("ollama-1", connection, "gpt-oss:120b", { attemptStartedAt: NOW, provider: "ollama" });
    expect(mocks.updateProviderConnection.mock.calls[0][1]).not.toHaveProperty("modelLock_websearch:ollama");
    await clearAccountError("ollama-1", connection, "websearch:ollama", {
      attemptStartedAt: NOW, provider: "ollama", webSearch: true,
    });
    expect(mocks.updateProviderConnection.mock.calls[1][1]).toEqual({ "modelLock_websearch:ollama": null, "modelError_websearch:ollama": null });
  });
});
