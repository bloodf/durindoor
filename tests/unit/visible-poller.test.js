import { describe, expect, it, vi } from "vitest";
import { createVisiblePoller } from "@/shared/utils/visiblePoller.js";

describe("visible poller", () => {
  it("pauses while hidden and refreshes on visibility resume", async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const documentRef = {
      hidden: true,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    };
    const callback = vi.fn();
    const poller = createVisiblePoller({ callback, intervalMs: 1000, jitter: 0, documentRef });
    poller.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(callback).not.toHaveBeenCalled();
    documentRef.hidden = false;
    listeners.get("visibilitychange")();
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);
    poller.stop();
    vi.useRealTimers();
  });
});
