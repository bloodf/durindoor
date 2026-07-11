import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaFetchState: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: mocks.validateApiKey,
  getQuotaFetchState: mocks.getQuotaFetchState,
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function connection(id, priority) {
  return {
    id,
    provider: "codex",
    authType: "oauth",
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    priority,
    isActive: true,
    updatedAt: new Date(NOW - 60_000).toISOString(),
  };
}

function snapshot(connectionId, {
  state,
  resourceKey = "model:gpt-5.4",
  resetAt = null,
  cooldownUntil = null,
  staleAt = NOW + 60_000,
} = {}) {
  return {
    identity: { connectionId, provider: "codex", accountKey: "scope:connection", resourceKey, dimensionKey: "requests:runtime" },
    state,
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
    timing: {
      observedAt: new Date(NOW - 1000).toISOString(),
      staleAt: new Date(staleAt).toISOString(),
      resetAt: resetAt ? new Date(resetAt).toISOString() : null,
      cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
    },
    provenance: { sourceType: "response_headers", sourceId: "codex:runtime-test:v1", reasonCode: "rate_limited", metadata: {} },
  };
}

describe("quota-aware provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaFetchState.mockResolvedValue(null);
    mocks.updateProviderConnection.mockImplementation(async (id, patch) => ({
      ...connection(id, id === "one" ? 1 : 2),
      ...patch,
      updatedAt: new Date(NOW).toISOString(),
    }));
  });

  it("skips a fresh exhausted account and preserves fill-first order among eligible accounts", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2), connection("three", 3)]);
    const reset = NOW + 30_000;
    const quotaSnapshotsLoader = vi.fn().mockResolvedValue([
      snapshot("one", { state: "exhausted", resetAt: reset }),
      snapshot("two", { state: "available" }),
    ]);

    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
    });

    expect(selected.connectionId).toBe("two");
    expect(selected._quotaPreflight).toMatchObject({ eligible: true, skip: false, reason: "stale" });
    expect(quotaSnapshotsLoader).toHaveBeenCalledTimes(1);
  });

  it("keeps stale and unknown accounts eligible and marks them for shared refresh", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [snapshot("one", { state: "exhausted", resetAt: NOW, staleAt: NOW })],
    });
    expect(selected.connectionId).toBe("one");
    expect(selected._quotaPreflight).toMatchObject({ reason: "stale", shouldRefresh: true });
  });

  it("returns allRateLimited without fabricating Retry-After when a blocker has no reset", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [snapshot("one", { state: "exhausted" })],
    });
    expect(result).toMatchObject({ allRateLimited: true, retryAfter: null, retryAfterHuman: "", lastErrorCode: 429 });
  });

  it("preserves legacy authentication status instead of rewriting it as quota", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      ...connection("one", 1),
      "modelLock_gpt-5.4": new Date(NOW + 30_000).toISOString(),
      errorCode: 401,
      lastError: "Authentication failed",
    }]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: async () => [],
    });
    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 401, lastError: "Authentication failed", retryAfter: null });
  });

  it("keeps a legacy 429 deadline and rate-limit message", async () => {
    const retryAfter = new Date(NOW + 30_000).toISOString();
    mocks.getProviderConnections.mockResolvedValue([{
      ...connection("one", 1),
      "modelLock_gpt-5.4": retryAfter,
      errorCode: 429,
      lastError: "Rate limited",
    }]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: async () => [],
    });
    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 429, lastError: "Rate limited", retryAfter });
  });

  it("does not expose a local legacy deadline for no-reset plan exhaustion", async () => {
    const localBreaker = new Date(NOW + 30_000).toISOString();
    mocks.getProviderConnections.mockResolvedValue([{
      ...connection("one", 1),
      "modelLock_gpt-5.4": localBreaker,
      errorCode: 429,
      lastError: "Rate limited",
    }]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [snapshot("one", { state: "exhausted" })],
    });
    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 429, retryAfter: null });
  });

  it("prioritizes a legacy authentication blocker over an earlier legacy 429", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        ...connection("rate", 1),
        "modelLock_gpt-5.4": new Date(NOW + 30_000).toISOString(),
        errorCode: 429,
      },
      {
        ...connection("auth", 2),
        "modelLock_gpt-5.4": new Date(NOW + 30_000).toISOString(),
        errorCode: 401,
      },
    ]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: async () => [],
    });
    expect(result).toMatchObject({
      allRateLimited: true,
      lastErrorCode: 401,
      lastError: "Authentication failed",
      retryAfter: null,
    });
  });

  it("deterministically prefers a legacy auth blocker over a mixed quota blocker", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("quota", 1),
      {
        ...connection("auth", 2),
        "modelLock_gpt-5.4": new Date(NOW + 30_000).toISOString(),
        errorCode: 403,
      },
    ]);
    const result = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [snapshot("quota", { state: "exhausted", resetAt: NOW + 30_000 })],
    });
    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 403, lastError: "Access forbidden", retryAfter: null });
  });

  it("projects the committed round-robin revision instead of the stale selected row", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 });
    mocks.getProviderConnections.mockResolvedValue([
      { ...connection("one", 1), lastUsedAt: new Date(NOW - 1000).toISOString(), consecutiveUseCount: 1 },
      connection("two", 2),
    ]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: async () => [],
    });
    expect(selected.connectionId).toBe("one");
    expect(selected._connection.updatedAt).toBe(new Date(NOW).toISOString());
    expect(selected._connection.consecutiveUseCount).toBe(2);
  });

  it("performs no credential or quota work for a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const quotaSnapshotsLoader = vi.fn();
    await expect(getProviderCredentials("codex", null, "gpt-5.4", {
      signal: controller.signal,
      quotaSnapshotsLoader,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
    expect(quotaSnapshotsLoader).not.toHaveBeenCalled();
  });
});
