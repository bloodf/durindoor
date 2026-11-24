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
    vi.stubEnv("BG_REFRESH_GOOGLE_DELAY_MS", "12000");
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshConnection.mock.calls.map(([connection]) => connection.id)).toEqual(["agy-1"]);

    await vi.advanceTimersByTimeAsync(13_999);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await tick;

    expect(refreshConnection.mock.calls.map(([connection]) => connection.id)).toEqual(["agy-1", "next"]);
  });
});
