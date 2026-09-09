/**
 * Background OAuth token-refresh scheduler.
 *
 * Covers pure selection (selectConnectionsNeedingRefresh) and tick orchestration
 * with an INJECTED refreshConnection — so it verifies which connections are
 * chosen and that per-connection failures are swallowed, but never the real
 * refreshOne path. That path (force=true reaching checkAndRefreshToken) is
 * covered by background-token-refresh-integration.test.js.
 *
 * The "anti-abuse sequential spacing" block covers the upstream #3813 port:
 * due connections are refreshed sequentially (not via Promise.allSettled) with
 * an injected `sleep` between accounts — a long jittered base delay for the
 * Google-sensitive providers (antigravity, gemini-cli) and a short fixed delay
 * for everyone else, both overridable via env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function conn(overrides = {}) {
  return {
    id: "c1",
    provider: "grok-cli",
    authType: "oauth",
    refreshToken: "rt-1",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
    ...overrides,
  };
}

describe("selectConnectionsNeedingRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("selects oauth grok-cli connection expiring in 10 minutes", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("c1");
  });

  it("skips connection expiring in 2 hours", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("never selects apikey connections", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [
        conn({ authType: "apikey", refreshToken: "rt" }),
        conn({ id: "c2", authType: "api_key", refreshToken: "rt" }),
      ],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("skips oauth connection without refreshToken", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ refreshToken: null }), conn({ id: "c2", refreshToken: undefined })],
      NOW
    );
    expect(list).toHaveLength(0);
  });

  it("selects already-expired oauth connection", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const list = selectConnectionsNeedingRefresh(
      [conn({ expiresAt: new Date(NOW - 60 * 1000).toISOString() })],
      NOW
    );
    expect(list).toHaveLength(1);
  });
});

describe("runBackgroundTokenRefreshTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls refresh only for due connections and swallows per-connection errors", async () => {
    const due = conn({
      id: "due",
      expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    });
    const notDue = conn({
      id: "not-due",
      expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    });
    const apikey = conn({
      id: "key",
      authType: "apikey",
      expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    });

    const refreshConnection = vi.fn(async (c) => {
      if (c.id === "due") throw new Error("boom");
      return c;
    });
    const loadConnections = vi.fn(async () => [due, notDue, apikey]);

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await expect(
      runBackgroundTokenRefreshTick({ loadConnections, refreshConnection })
    ).resolves.toBeUndefined();

    expect(loadConnections).toHaveBeenCalledTimes(1);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(refreshConnection.mock.calls[0][0].id).toBe("due");
  });

  it("does not call refresh when nothing is due", async () => {
    const refreshConnection = vi.fn();
    const loadConnections = vi.fn(async () => [
      conn({
        expiresAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it("swallows top-level load errors", async () => {
    const refreshConnection = vi.fn();
    const loadConnections = vi.fn(async () => {
      throw new Error("db down");
    });

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    await expect(
      runBackgroundTokenRefreshTick({ loadConnections, refreshConnection })
    ).resolves.toBeUndefined();
    expect(refreshConnection).not.toHaveBeenCalled();
  });
});

describe("anti-abuse sequential spacing (upstream #3813)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("refreshes due connections sequentially with a sleep between accounts, never after the last", async () => {
    const conns = [
      conn({ id: "a1", provider: "antigravity" }),
      conn({ id: "g1", provider: "gemini-cli" }),
      conn({ id: "n1", provider: "grok-cli" }),
    ];
    const order = [];
    const refreshConnection = vi.fn(async (c) => {
      order.push(c.id);
    });
    const loadConnections = vi.fn(async () => conns);
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection, sleep });

    expect(order).toEqual(["a1", "g1", "n1"]);
    expect(sleep).toHaveBeenCalledTimes(conns.length - 1);
  });

  it("uses the long jittered Google base delay for sensitive providers and the short fixed delay otherwise", async () => {
    const conns = [
      conn({ id: "a1", provider: "antigravity" }),
      conn({ id: "a2", provider: "antigravity" }),
      conn({ id: "n1", provider: "grok-cli" }),
      conn({ id: "n2", provider: "grok-cli" }),
    ];
    const refreshConnection = vi.fn(async () => {});
    const loadConnections = vi.fn(async () => conns);
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection, sleep });

    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays).toHaveLength(3);
    // Delay after a sensitive provider: 12_000 base + jitter in [0, 4000)
    expect(delays[0]).toBeGreaterThanOrEqual(12_000);
    expect(delays[0]).toBeLessThan(16_000);
    expect(delays[1]).toBeGreaterThanOrEqual(12_000);
    expect(delays[1]).toBeLessThan(16_000);
    // Delay after a normal provider: exactly 1_500 + 200
    expect(delays[2]).toBe(1_700);
  });

  it("honors BG_REFRESH_GOOGLE_DELAY_MS / BG_REFRESH_DELAY_MS overrides", async () => {
    vi.stubEnv("BG_REFRESH_GOOGLE_DELAY_MS", "30000");
    vi.stubEnv("BG_REFRESH_DELAY_MS", "500");

    const conns = [
      conn({ id: "a1", provider: "antigravity" }),
      conn({ id: "n1", provider: "grok-cli" }),
      conn({ id: "n2", provider: "grok-cli" }),
    ];
    const refreshConnection = vi.fn(async () => {});
    const loadConnections = vi.fn(async () => conns);
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection, sleep });

    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays[0]).toBeGreaterThanOrEqual(30_000);
    expect(delays[0]).toBeLessThan(34_000);
    expect(delays[1]).toBe(700);
  });

  it("does not sleep when only one connection is due", async () => {
    const refreshConnection = vi.fn(async () => {});
    const loadConnections = vi.fn(async () => [conn({ id: "a1", provider: "antigravity" })]);
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection, sleep });

    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("start/stop guards", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    const mod = await import("../../src/sse/services/backgroundTokenRefresh.js");
    mod.stopBackgroundTokenRefresh();
    vi.resetModules();
  });

  it("honors DISABLE_BACKGROUND_TOKEN_REFRESH kill-switch", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_TOKEN_REFRESH", "1");
    const { startBackgroundTokenRefresh, stopBackgroundTokenRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    expect(startBackgroundTokenRefresh()).toBe(false);
    stopBackgroundTokenRefresh();
  });

  it("is idempotent: second start is no-op", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_TOKEN_REFRESH", "");
    const { startBackgroundTokenRefresh, stopBackgroundTokenRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const first = startBackgroundTokenRefresh({ intervalMs: 60_000 });
    const second = startBackgroundTokenRefresh({ intervalMs: 60_000 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    stopBackgroundTokenRefresh();
  });
});
