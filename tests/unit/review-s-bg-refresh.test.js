/**
 * Regression for durindoor#2280:
 * Background token refresh must not force-refresh from a stale tick snapshot
 * after another path rotated the refresh token, and unrecoverable refresh
 * results must pin reauth_required the same way the request path does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
  refreshProviderCredentials: vi.fn(),
  updateProviderConnection: vi.fn(async () => true),
}));

vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshProviderCredentials: mocks.refreshProviderCredentials };
});

vi.mock("../../src/lib/localDb.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateProviderConnection: mocks.updateProviderConnection };
});

function dueConn(overrides = {}) {
  return {
    id: "conn-a",
    provider: "codex",
    authType: "oauth",
    refreshToken: "R1",
    accessToken: "A1",
    lastRefreshAt: "2026-08-01T11:00:00.000Z",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
    ...overrides,
  };
}

describe("durindoor#2280 background refresh stale snapshot / reauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
    mocks.updateProviderConnection.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips a due connection when refreshToken rotated since the tick snapshot", async () => {
    const snapshotA = dueConn({ id: "a", refreshToken: "R1A", lastRefreshAt: "2026-08-01T11:00:00.000Z" });
    const snapshotB = dueConn({ id: "b", refreshToken: "R1B", lastRefreshAt: "2026-08-01T11:00:00.000Z" });
    // While the tick sleeps after A, a request path rotates B (R1B → R3B).
    const live = {
      a: snapshotA,
      b: {
        ...snapshotB,
        refreshToken: "R3B",
        lastRefreshAt: "2026-08-01T12:00:05.000Z",
        accessToken: "A3B",
      },
    };

    const refreshConnection = vi.fn(async (c) => c);
    const getConnectionById = vi.fn(async (id) => live[id]);
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [snapshotA, snapshotB],
      refreshConnection,
      getConnectionById,
      sleep,
    });

    expect(getConnectionById).toHaveBeenCalledWith("a");
    expect(getConnectionById).toHaveBeenCalledWith("b");
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(refreshConnection.mock.calls[0][0].id).toBe("a");
    expect(refreshConnection.mock.calls.some((call) => call[0].refreshToken === "R1B")).toBe(false);
  });

  it("skips when only lastRefreshAt changed (same refreshToken string)", async () => {
    const snapshot = dueConn({
      id: "solo",
      refreshToken: "R-same",
      lastRefreshAt: "2026-08-01T11:00:00.000Z",
    });
    const refreshConnection = vi.fn(async (c) => c);
    const getConnectionById = vi.fn(async () => ({
      ...snapshot,
      lastRefreshAt: "2026-08-01T11:55:00.000Z",
    }));

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [snapshot],
      refreshConnection,
      getConnectionById,
      sleep: async () => {},
    });

    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it("refreshes the live row when credentials still match the snapshot", async () => {
    const snapshot = dueConn({ id: "ok", refreshToken: "R1", lastRefreshAt: "t0" });
    const live = { ...snapshot, accessToken: "A-live" };
    const refreshConnection = vi.fn(async (c) => c);
    const getConnectionById = vi.fn(async () => live);

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [snapshot],
      refreshConnection,
      getConnectionById,
    });

    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(refreshConnection.mock.calls[0][0]).toEqual(live);
  });

  it("pins reauth_required when force refresh returns refresh_token_reused", async () => {
    mocks.refreshProviderCredentials.mockResolvedValue({
      error: "refresh_token_reused",
      code: "invalid_grant",
    });

    const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");

    const credentials = {
      id: "conn-reauth",
      connectionId: "conn-reauth",
      provider: "codex",
      authType: "oauth",
      refreshToken: "R1B",
      accessToken: "A1B",
      lastRefreshAt: "2026-08-01T11:00:00.000Z",
      expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    };

    await expect(
      checkAndRefreshToken("codex", credentials, null, { force: true })
    ).rejects.toMatchObject({ code: "PROVIDER_REAUTH_REQUIRED" });

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [id, patch, opts] = mocks.updateProviderConnection.mock.calls[0];
    expect(id).toBe("conn-reauth");
    expect(patch).toMatchObject({
      testStatus: "reauth_required",
      errorCode: "REAUTH",
      lastError: "OAuth session expired. Reconnect this account.",
    });
    expect(patch).toHaveProperty("lastErrorAt");
    expect(patch).not.toHaveProperty("accessToken");
    expect(patch).not.toHaveProperty("refreshToken");
    expect(opts).toMatchObject({ expectedRefreshContext: expect.any(Object) });
  });

  it("pins reauth_required for invalid_grant on the background force path", async () => {
    mocks.refreshProviderCredentials.mockResolvedValue({ error: "invalid_grant" });

    const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");

    await expect(
      checkAndRefreshToken(
        "claude",
        {
          id: "conn-claude",
          refreshToken: "rt",
          accessToken: "at",
          expiresAt: new Date(NOW + 60 * 1000).toISOString(),
        },
        null,
        { force: true }
      )
    ).rejects.toMatchObject({ code: "PROVIDER_REAUTH_REQUIRED" });

    expect(mocks.updateProviderConnection.mock.calls[0][1]).toMatchObject({
      testStatus: "reauth_required",
      errorCode: "REAUTH",
    });
  });

  it("export refreshCredentialsChangedSinceSnapshot detects token and lastRefreshAt drift", async () => {
    const { refreshCredentialsChangedSinceSnapshot } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const snap = { refreshToken: "R1", lastRefreshAt: "t0" };
    expect(refreshCredentialsChangedSinceSnapshot(snap, null)).toBe(false);
    expect(refreshCredentialsChangedSinceSnapshot(snap, snap)).toBe(false);
    expect(
      refreshCredentialsChangedSinceSnapshot(snap, { refreshToken: "R2", lastRefreshAt: "t0" })
    ).toBe(true);
    expect(
      refreshCredentialsChangedSinceSnapshot(snap, { refreshToken: "R1", lastRefreshAt: "t1" })
    ).toBe(true);
  });
});
