import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function agyConnection(id) {
  return {
    id,
    provider: "agy",
    authType: "oauth",
    refreshToken: `refresh-${id}`,
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
  };
}

describe("agy background refresh spacing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the Google-sensitive delay between agy account refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("BG_REFRESH_GOOGLE_DELAY_MS", "12000");
    vi.stubEnv("BG_REFRESH_DELAY_MS", "1500");
    vi.spyOn(Math, "random").mockReturnValue(0);

    const refreshConnection = vi.fn(async () => {});
    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const tick = runBackgroundTokenRefreshTick({
      loadConnections: async () => [agyConnection("agy-1"), agyConnection("agy-2")],
      refreshConnection,
    });

    await vi.advanceTimersByTimeAsync(1_700);
    expect(refreshConnection).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_299);
    expect(refreshConnection).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await tick;
    expect(refreshConnection).toHaveBeenCalledTimes(2);
  });
});
