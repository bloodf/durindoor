import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaIdentityKey } from "../../src/shared/utils/quotaSnapshot.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaFetchState: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: mocks.validateApiKey,
  getQuotaFetchState: mocks.getQuotaFetchState,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function connection(id, priority, provider = "codex") {
  return {
    id,
    provider,
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

function providerRow(connectionId, remaining, {
  provider = "codex",
  resourceKey = "model:gpt-5.4",
  dimensionKey = "requests:session",
  unit = "requests",
  sourceId = "codex:wham-usage:v1",
} = {}) {
  return {
    identity: {
      connectionId,
      provider,
      accountKey: "scope:connection",
      resourceKey,
      dimensionKey,
    },
    state: remaining / 100 <= 0.2 ? "low" : "available",
    amounts: {
      limitKind: "bounded",
      limit: 100,
      used: 100 - remaining,
      remaining,
      remainingRatio: remaining / 100,
      unit,
    },
    timing: {
      observedAt: new Date(NOW - 1000).toISOString(),
      staleAt: new Date(NOW + 60_000).toISOString(),
      resetAt: new Date(NOW + 60_000).toISOString(),
      cooldownUntil: null,
    },
    provenance: { sourceType: "provider_api", sourceId, reasonCode: null, metadata: {} },
  };
}

describe("quota-aware provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaFetchState.mockResolvedValue(null);
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
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

  it("lets fresh compatible quota dominate fill-first priority", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [providerRow("one", 10), providerRow("two", 90)],
    });
    expect(selected.connectionId).toBe("two");
    expect(mocks.getQuotaReservationPressure).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      connectionIds: ["one", "two"],
    }));
  });

  it("subtracts committed provisional demand before ranking a final observed slot", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const finalSlot = providerRow("one", 1);
    finalSlot.amounts = {
      limitKind: "bounded",
      limit: 1,
      used: 0,
      remaining: 1,
      remainingRatio: 1,
      unit: "requests",
    };
    finalSlot.state = "available";
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map([
      ["one", {
        activeCount: 0,
        lastSelectedAt: new Date(NOW - 1_000).toISOString(),
        debits: new Map([[
          quotaIdentityKey({
            connectionId: "one",
            provider: "codex",
            accountKey: "scope:connection",
            resourceKey: "model:gpt-5.4",
            dimensionKey: "requests:session",
          }),
          1,
        ]]),
      }],
      ["two", { activeCount: 0, lastSelectedAt: null, debits: new Map() }],
    ]));

    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [finalSlot, providerRow("two", 50)],
    });

    expect(selected.connectionId).toBe("two");
  });

  it("filters a below-floor account and selects a compatible account above its floor", async () => {
    mocks.getSettings.mockResolvedValue({ quotaSelection: { routingFloorEnabled: true, routingFloorRatio: 0.2 } });
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [providerRow("one", 10), providerRow("two", 90)],
    });

    expect(selected.connectionId).toBe("two");
  });

  it("returns a fixed local 503 when every comparable account is below its routing floor", async () => {
    mocks.getSettings.mockResolvedValue({ quotaSelection: { routingFloorEnabled: true, routingFloorRatio: 0.2 } });
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [providerRow("one", 10), providerRow("two", 20)],
    });

    expect(selected).toMatchObject({
      allRateLimited: true,
      localQuotaFloor: true,
      lastErrorCode: 503,
      lastError: "Provider quota routing floor reached",
      retryAfter: null,
    });
  });

  it("keeps an untracked sibling eligible when a comparable account is below floor", async () => {
    mocks.getSettings.mockResolvedValue({ quotaSelection: { routingFloorEnabled: true, routingFloorRatio: 0.2 } });
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader: async () => [providerRow("one", 10)],
    });

    expect(selected.connectionId).toBe("two");
    expect(selected._quotaPreflight.reason).toBe("missing");
  });

  it("enforces routing floors for ratio-only token windows", async () => {
    mocks.getSettings.mockResolvedValue({
      quotaSelection: {
        providers: {
          glm: {
            dimensions: {
              "tokens:session": { routingFloorEnabled: true, routingFloorRatio: 0.2 },
            },
          },
        },
      },
    });
    mocks.getProviderConnections.mockResolvedValue([
      connection("one", 1, "glm"),
      connection("two", 2, "glm"),
    ]);
    const selected = await getProviderCredentials("glm", null, "glm-5", {
      now: NOW,
      quotaSnapshotsLoader: async () => [
        providerRow("one", 10, {
          provider: "glm",
          resourceKey: "scope:account",
          dimensionKey: "tokens:session",
          unit: "tokens",
          sourceId: "glm:coding-plan-quota:v1",
        }),
        providerRow("two", 90, {
          provider: "glm",
          resourceKey: "scope:account",
          dimensionKey: "tokens:session",
          unit: "tokens",
          sourceId: "glm:coding-plan-quota:v1",
        }),
      ],
    });

    expect(selected.connectionId).toBe("two");
    expect(selected._quotaPreflight.quotaProfile.reservationAlternatives).toEqual([]);
  });

  it("preserves fill-first order when observations are stale or untracked", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const selected = await getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: async () => [],
    });
    expect(selected.connectionId).toBe("one");
    expect(mocks.getQuotaReservationPressure).not.toHaveBeenCalled();
  });

  it("does not serialize unrelated providers behind a slow quota lookup", async () => {
    let releaseCodex;
    const codexSnapshots = new Promise((resolve) => { releaseCodex = resolve; });
    const codexLoader = vi.fn(() => codexSnapshots);
    const claudeLoader = vi.fn().mockResolvedValue([]);
    mocks.getProviderConnections.mockImplementation(async ({ provider }) => [
      connection(`${provider}-one`, 1, provider),
    ]);

    const pendingCodex = getProviderCredentials("codex", null, "gpt-5.4", {
      now: NOW,
      quotaSnapshotsLoader: codexLoader,
    });
    await vi.waitFor(() => expect(codexLoader).toHaveBeenCalledOnce());

    const claude = await getProviderCredentials("claude", null, "claude-sonnet", {
      now: NOW,
      quotaSnapshotsLoader: claudeLoader,
    });
    expect(claude.connectionId).toBe("claude-one");
    expect(claudeLoader).toHaveBeenCalledOnce();

    releaseCodex([]);
    expect((await pendingCodex).connectionId).toBe("codex-one");
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
