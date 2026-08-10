// The scheduler's own suite injects `refreshConnection`, so the default
// `refreshOne` path — the one production actually runs — is never exercised.
// That leaves the whole point of the feature untested: `refreshOne` must call
// checkAndRefreshToken with force=true so a token inside the scheduler's 30m
// lead is refreshed even though the provider's on-request lead is only 5m.
// Without force the tick would select the connection, call through, and quietly
// do nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshProviderCredentials: vi.fn(),
  updateProviderConnection: vi.fn(async () => true),
}));

// Mock only the network call and the DB write; the lead/force decision under
// test stays real, as does tokenRefresh's own persistence logic.
vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshProviderCredentials: mocks.refreshProviderCredentials };
});

// Partial mock: localDb has many other exports that sibling suites rely on, and
// replacing the whole module leaks across the run. Only the persistence call
// this test observes is swapped out.
vi.mock("../../src/lib/localDb.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateProviderConnection: mocks.updateProviderConnection };
});

const { runBackgroundTokenRefreshTick, selectConnectionsNeedingRefresh, BACKGROUND_REFRESH_LEAD_MS } =
  await import("../../src/sse/services/backgroundTokenRefresh.js");
const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");
const { shouldRefreshCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");

// github's on-request lead is 5 minutes; the scheduler's is 30. A token 10
// minutes out sits between the two, which is exactly the window force exists for.
const PROVIDER = "github";
const TEN_MINUTES = 10 * 60 * 1000;

function connectionExpiringIn(ms) {
  return {
    id: "conn-integration",
    connectionId: "conn-integration",
    provider: PROVIDER,
    authType: "oauth",
    refreshToken: "refresh-token",
    accessToken: "old-access-token",
    expiresAt: new Date(Date.now() + ms).toISOString(),
    providerSpecificData: {},
  };
}

describe("background refresh: real refreshOne path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(true);
  });

  // Pins the premise: if these leads ever converge, the test below stops
  // proving anything and this assertion says so loudly.
  it("sits in the gap between the provider lead and the scheduler lead", () => {
    const providerLead = getRefreshLeadMs(PROVIDER);
    expect(providerLead).toBeLessThan(TEN_MINUTES);
    expect(BACKGROUND_REFRESH_LEAD_MS).toBeGreaterThan(TEN_MINUTES);

    const conn = connectionExpiringIn(TEN_MINUTES);
    // The scheduler wants it refreshed...
    expect(selectConnectionsNeedingRefresh([conn])).toHaveLength(1);
    // ...but the on-request check alone would skip it.
    expect(shouldRefreshCredentials(PROVIDER, conn)).toBe(false);
  });

  it("refreshes and persists a token the on-request lead would have skipped", async () => {
    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 3600,
    });

    // No refreshConnection injected — this drives the real refreshOne.
    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [connectionExpiringIn(TEN_MINUTES)],
    });

    expect(mocks.refreshProviderCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.refreshProviderCredentials.mock.calls[0][0]).toBe(PROVIDER);

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [connectionId, persisted] = mocks.updateProviderConnection.mock.calls[0];
    expect(connectionId).toBe("conn-integration");
    expect(persisted.accessToken).toBe("new-access-token");
  });

  it("still refreshes a token already inside the provider's own lead", async () => {
    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "new-access-token",
      expiresIn: 3600,
    });

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [connectionExpiringIn(60 * 1000)],
    });

    expect(mocks.refreshProviderCredentials).toHaveBeenCalledTimes(1);
  });

  // Selection, not force, is what keeps healthy tokens alone: force is only
  // applied to connections the scheduler already chose.
  it("leaves a token outside the scheduler lead untouched", async () => {
    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [connectionExpiringIn(24 * 60 * 60 * 1000)],
    });

    expect(mocks.refreshProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("swallows an upstream refresh failure so one bad connection cannot kill the tick", async () => {
    mocks.refreshProviderCredentials.mockRejectedValue(new Error("upstream 503"));

    await expect(runBackgroundTokenRefreshTick({
      loadConnections: async () => [connectionExpiringIn(TEN_MINUTES)],
    })).resolves.toBeUndefined();

    expect(mocks.refreshProviderCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
