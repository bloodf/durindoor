import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function conn(id, provider) {
  return {
    id,
    provider,
    authType: "oauth",
    refreshToken: `refresh-${id}`,
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
  };
}

describe("agy background refresh spacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("waits the Google refresh interval before starting the next account", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const refreshConnection = vi.fn(async () => {});
    const loadConnections = vi.fn(async () => [
      conn("agy-1", "agy"),
      conn("next", "grok-cli"),
    ]);
    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );

    const tick = runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(refreshConnection.mock.calls.map(([connection]) => connection.id)).toEqual(["agy-1"]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(13_999);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await tick;

    expect(refreshConnection.mock.calls.map(([connection]) => connection.id)).toEqual(["agy-1", "next"]);
  });
});
