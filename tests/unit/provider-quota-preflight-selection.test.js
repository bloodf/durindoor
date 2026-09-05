import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { getProviderCredentialsWithQuotaPreflight } = await import("../../src/sse/services/auth.js");

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

// A snapshot whose `staleAt` is in the past forces the selector's cache
// inspection to mark the connection `shouldRefresh: true` (stale), so the
// wrapper performs the live upstream refresh this port adds.
function staleSnapshot(connectionId, { state } = {}) {
  return {
    identity: { connectionId, provider: "codex", accountKey: "scope:connection", resourceKey: "model:gpt-5.4", dimensionKey: "requests:runtime" },
    state,
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
    timing: {
      observedAt: new Date(NOW - 120_000).toISOString(),
      staleAt: new Date(NOW - 60_000).toISOString(),
      resetAt: null,
      cooldownUntil: null,
    },
    provenance: { sourceType: "response_headers", sourceId: "codex:runtime-test:v1", reasonCode: "rate_limited", metadata: {} },
  };
}

// Fresh exact-source snapshot returned by live refresh. All timestamps use the
// injected selection clock so the decision stays deterministic.
function freshSnapshot(connectionId, { state, resetAt = null } = {}) {
  return {
    identity: { connectionId, provider: "codex", accountKey: "scope:connection", resourceKey: "model:gpt-5.4", dimensionKey: "requests:runtime" },
    state,
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
    timing: {
      observedAt: new Date(NOW).toISOString(),
      staleAt: new Date(NOW + 60_000).toISOString(),
      resetAt: resetAt ? new Date(resetAt).toISOString() : null,
      cooldownUntil: null,
    },
    provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: null, metadata: {} },
  };
}

describe("getProviderCredentialsWithQuotaPreflight (OmniRoute #6742)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaFetchState.mockResolvedValue(null);
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
    mocks.getProviderConnectionById.mockImplementation(async (id) => connection(id, id === "one" ? 1 : 2));
    mocks.updateProviderConnection.mockImplementation(async (id, patch) => ({
      ...connection(id, id === "one" ? 1 : 2),
      ...patch,
      updatedAt: new Date(NOW).toISOString(),
    }));
  });

  it("blocks a live-exhausted first account and selects the next eligible account", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1), connection("two", 2)]);
    const reset = NOW + 30_000;

    // First pass: both accounts look stale (shouldRefresh). After the refresh
    // persists account "one" as exhausted, the reselect must see it blocked.
    const quotaSnapshotsLoader = vi
      .fn()
      .mockResolvedValueOnce([staleSnapshot("one", { state: "available" }), staleSnapshot("two", { state: "available" })])
      .mockResolvedValue([freshSnapshot("one", { state: "exhausted", resetAt: reset }), freshSnapshot("two", { state: "available" })]);

    const quotaRefresher = vi.fn().mockResolvedValue({
      outcome: "success",
      snapshots: [freshSnapshot("one", { state: "exhausted", resetAt: reset })],
    });

    const selected = await getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
      quotaRefresher,
    });

    expect(quotaRefresher).toHaveBeenCalledTimes(1);
    expect(selected.connectionId).toBe("two");
  });

  it("returns allRateLimited with retry metadata when the sole account is live-exhausted", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const reset = NOW + 45_000;

    const quotaSnapshotsLoader = vi
      .fn()
      .mockResolvedValueOnce([staleSnapshot("one", { state: "available" })])
      .mockResolvedValue([freshSnapshot("one", { state: "exhausted", resetAt: reset })]);

    const quotaRefresher = vi.fn().mockResolvedValue({
      outcome: "success",
      snapshots: [freshSnapshot("one", { state: "exhausted", resetAt: reset })],
    });

    const result = await getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
      quotaRefresher,
    });

    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 429 });
    // retry metadata comes from the persisted snapshot reset, not fabricated.
    expect(result.retryAfter).toBeTruthy();
  });

  it("fails open to the original credentials when the refresh throws", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const quotaSnapshotsLoader = vi.fn().mockResolvedValue([staleSnapshot("one", { state: "available" })]);
    const quotaRefresher = vi.fn().mockRejectedValue(new Error("network down"));

    const selected = await getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
      quotaRefresher,
    });

    expect(selected.connectionId).toBe("one");
  });

  it("does not refresh a connection more than once per call", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const reset = NOW + 30_000;
    // Loader NEVER reflects tracker persistence: always returns the account as
    // stale/eligible. The refresher reports the account exhausted. Without the
    // once-per-connection bound the wrapper would reselect the same account and
    // refresh it forever. The bound must cap refreshes at 1 and return a
    // bounded (fail-open) result.
    const quotaSnapshotsLoader = vi.fn().mockResolvedValue([staleSnapshot("one", { state: "available" })]);
    const quotaRefresher = vi.fn().mockResolvedValue({
      outcome: "success",
      snapshots: [freshSnapshot("one", { state: "exhausted", resetAt: reset })],
    });

    const selected = await getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
      quotaRefresher,
    });

    expect(quotaRefresher).toHaveBeenCalledTimes(1);
    // Reselect returned the same account (loader still stale) but did NOT
    // refresh it again — bounded fail-open, not an infinite loop.
    expect(selected.connectionId).toBe("one");
  });

  it("propagates AbortError instead of failing open", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const quotaSnapshotsLoader = vi.fn().mockResolvedValue([staleSnapshot("one", { state: "available" })]);
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const quotaRefresher = vi.fn().mockRejectedValue(abort);

    await expect(
      getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
        now: NOW,
        resourceKeys: ["model:gpt-5.4"],
        quotaSnapshotsLoader,
        quotaRefresher,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns rotated tokens from the persisted row after a usable refresh, without a second strategy commit", async () => {
    // round-robin is the strategy that commits lastUsedAt/consecutiveUseCount
    // on each selection; fill-first never does, which would make the commit
    // count assertion meaningless.
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "round-robin" });
    mocks.getProviderConnections.mockResolvedValue([connection("one", 1)]);
    const quotaSnapshotsLoader = vi.fn().mockResolvedValue([staleSnapshot("one", { state: "available" })]);

    // Tracker persisted rotated tokens before the (usable) quota fetch.
    mocks.getProviderConnectionById.mockResolvedValue({
      ...connection("one", 1),
      accessToken: "token-one-ROTATED",
      refreshToken: "refresh-one-ROTATED",
    });
    const quotaRefresher = vi.fn().mockResolvedValue({
      outcome: "success",
      snapshots: [freshSnapshot("one", { state: "available" })],
    });

    const selected = await getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
      now: NOW,
      resourceKeys: ["model:gpt-5.4"],
      quotaSnapshotsLoader,
      quotaRefresher,
    });

    // Fresh rotated tokens returned, not the stale pre-refresh projection.
    expect(selected.accessToken).toBe("token-one-ROTATED");
    expect(selected.refreshToken).toBe("refresh-one-ROTATED");
    // The selection committed once (initial pick); the fresh-token reload must
    // not run a second strategy commit.
    const commitCalls = mocks.updateProviderConnection.mock.calls.filter(
      ([, patch]) => patch && ("lastUsedAt" in patch || "consecutiveUseCount" in patch)
    );
    expect(commitCalls).toHaveLength(1);
  });
});
