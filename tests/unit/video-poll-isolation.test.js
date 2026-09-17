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
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
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

const { clearAccountError, markAccountUnavailable, getProviderCredentials } =
  await import("../../src/sse/services/auth.js");
const { resolveFallbackModelScope } = await import("../../open-sse/services/fallbackScope.js");

const NOW = Date.parse("2026-09-16T12:00:00.000Z");

// A video job exists only on the account that created it. Polls carry no model,
// and an unscoped `model = null` resolves to the account-wide lock, so a failing
// poll would otherwise cool down chat and every other modality on the account.
describe("video poll cooldown isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearProviderConnectionFallbackState.mockRejectedValue(new Error("compatibility clear"));
    mocks.recordProviderConnectionFallbackState.mockRejectedValue(new Error("compatibility record"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "xai-1", provider: "xai", backoffLevel: 0 }]);
  });

  it("keeps a poll scope distinct from the account-wide scope", () => {
    expect(resolveFallbackModelScope("xai", null, { videoPoll: true })).toBe("videopoll:xai");
    // Without the flag a model-less request collapses to account-wide (null).
    expect(resolveFallbackModelScope("xai", null)).toBeNull();
    // The flag never displaces a real model scope for ordinary chat traffic.
    expect(resolveFallbackModelScope("xai", "grok-4")).not.toBe("videopoll:xai");
  });

  it("cools down only the poll scope when a poll fails", async () => {
    await markAccountUnavailable(
      "xai-1", 429, "rate limited", "xai", null, null,
      { attemptStartedAt: NOW, videoPoll: true },
    );

    expect(mocks.updateProviderConnection).toHaveBeenCalledOnce();
    const patch = mocks.updateProviderConnection.mock.calls[0][1];
    expect(patch).toHaveProperty("modelLock_videopoll:xai");
    // The account-wide lock must stay untouched, or chat goes down with polling.
    expect(patch).not.toHaveProperty("modelLock___all");
  });

  it("locks the whole account when the same failure is not poll-scoped", async () => {
    await markAccountUnavailable(
      "xai-1", 429, "rate limited", "xai", null, null,
      { attemptStartedAt: NOW },
    );

    const patch = mocks.updateProviderConnection.mock.calls[0][1];
    expect(patch).toHaveProperty("modelLock___all");
    expect(patch).not.toHaveProperty("modelLock_videopoll:xai");
  });

  it("clears the poll lock without clearing an unrelated chat lock", async () => {
    await clearAccountError("xai-1", {
      _connection: {
        id: "xai-1",
        provider: "xai",
        "modelLock_videopoll:xai": new Date(NOW + 60_000).toISOString(),
        "modelLock_grok-4": new Date(NOW + 60_000).toISOString(),
      },
    }, null, { attemptStartedAt: NOW, provider: "xai", videoPoll: true });

    expect(mocks.updateProviderConnection).toHaveBeenCalledOnce();
    const patch = mocks.updateProviderConnection.mock.calls[0][1];
    expect(patch["modelLock_videopoll:xai"]).toBeNull();
    expect(patch).not.toHaveProperty("modelLock_grok-4");
  });
});

// Selection must never substitute a different account for an account-bound
// resource: the job does not exist there, so the call cannot succeed and bills
// the wrong account.
describe("strict connection pinning for account-bound resources", () => {
  const connections = [
    { id: "xai-1", provider: "xai", isActive: true, authType: "apikey", apiKey: "k1" },
    { id: "xai-2", provider: "xai", isActive: true, authType: "apikey", apiKey: "k2" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockImplementation(async () => connections.map(c => ({ ...c })));
  });

  it("selects the pinned account when it is available", async () => {
    const credentials = await getProviderCredentials("xai", null, null, {
      preferredConnectionId: "xai-2",
      strictConnectionId: "xai-2",
    });
    expect(credentials?.connectionId).toBe("xai-2");
  });

  it("refuses to substitute another account when the pinned one is absent", async () => {
    const credentials = await getProviderCredentials("xai", null, null, {
      preferredConnectionId: "xai-missing",
      strictConnectionId: "xai-missing",
    });
    expect(credentials?.connectionId).not.toBe("xai-1");
    expect(credentials?.connectionId).not.toBe("xai-2");
  });

  it("still rotates to another account when pinning is not strict", async () => {
    const credentials = await getProviderCredentials("xai", null, null, {
      preferredConnectionId: "xai-missing",
    });
    // Non-strict callers keep the existing fallback behavior.
    expect(["xai-1", "xai-2"]).toContain(credentials?.connectionId);
  });
});
