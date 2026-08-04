import { describe, expect, it, vi } from "vitest";
import { refreshWithRetry } from "../../open-sse/services/tokenRefresh.js";

describe("refreshWithRetry transient errors", () => {
  it("retries a network reset immediately without spending the normal budget", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ accessToken: "ok" });

    await expect(refreshWithRetry(refresh, 1)).resolves.toEqual({ accessToken: "ok" });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing delay for non-transient errors", async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("unauthorized"), { status: 401 }))
        .mockResolvedValueOnce({ accessToken: "ok" });
      const pending = refreshWithRetry(refresh, 2);
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ accessToken: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });
});