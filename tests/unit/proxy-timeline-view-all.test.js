import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimelineHref, createLiveReloadScheduler } from "../../src/app/(dashboard)/dashboard/timeline/href.js";

afterEach(() => vi.useRealTimers());

describe("buildTimelineHref", () => {
  it("builds provider View all", () => {
    expect(buildTimelineHref({ provider: "openai" })).toBe("/dashboard/timeline?provider=openai");
  });
  it("builds connection View all with connectionId", () => {
    expect(buildTimelineHref({ provider: "openai", connectionId: "c1" }))
      .toBe("/dashboard/timeline?provider=openai&connectionId=c1");
  });

  it("coalesces bursty live writes into one reload", async () => {
    vi.useFakeTimers();
    const load = vi.fn();
    const scheduler = createLiveReloadScheduler(load, 500);
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(1);
    scheduler.cancel();
  });
});
