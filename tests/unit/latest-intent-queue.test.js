import { describe, expect, it, vi } from "vitest";
import { createLatestIntentQueue } from "@/shared/utils/latestIntentQueue";

describe("latest-intent queue", () => {
  it("serializes rapid opposite writes and preserves the last intent", async () => {
    let releaseFirst;
    const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
    const writes = [];
    const optimistic = [];
    const confirmed = [];
    const queue = createLatestIntentQueue({
      write: vi.fn(async (_key, enabled) => {
        writes.push(enabled);
        if (writes.length === 1) await firstBarrier;
        return { enabled };
      }),
      onOptimistic: (_key, enabled) => optimistic.push(enabled),
      onConfirmed: (_key, enabled) => confirmed.push(enabled),
      onRollback: vi.fn(),
    });

    const first = queue.enqueue("conn-1", true);
    await vi.waitFor(() => expect(writes).toEqual([true]));
    await queue.enqueue("conn-1", false);
    releaseFirst();
    await first;

    expect(writes).toEqual([true, false]);
    expect(optimistic.at(-1)).toBe(false);
    expect(confirmed.at(-1)).toBe(false);
  });

  it("rolls a failed write back to the hydrated server value", async () => {
    const onRollback = vi.fn();
    const queue = createLatestIntentQueue({
      write: vi.fn().mockRejectedValue(new Error("offline")),
      onOptimistic: vi.fn(),
      onRollback,
    });
    queue.hydrate([["conn-1", true]]);

    await queue.enqueue("conn-1", false);

    expect(onRollback).toHaveBeenCalledWith("conn-1", true, undefined, expect.any(Error));
  });

  it("repairs display state after hydration overlaps a successful write", async () => {
    let releaseWrite;
    const writeBarrier = new Promise((resolve) => { releaseWrite = resolve; });
    let displayed = false;
    const queue = createLatestIntentQueue({
      write: async (_key, enabled) => {
        await writeBarrier;
        return { enabled };
      },
      onOptimistic: (_key, enabled) => { displayed = enabled; },
      onConfirmed: (_key, enabled) => { displayed = enabled; },
      onRollback: (_key, enabled) => { displayed = enabled; },
    });
    queue.hydrate([["conn-1", false]]);

    const pending = queue.enqueue("conn-1", true);
    queue.hydrate([["conn-1", false]]);
    displayed = false; // A settings refresh rendered stale server state.
    releaseWrite();
    await pending;

    expect(displayed).toBe(true);
  });

  it("does not let an older confirmation override a newer queued intent", async () => {
    let releaseFirst;
    const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
    const displayed = [];
    const queue = createLatestIntentQueue({
      write: vi.fn(async (_key, enabled) => {
        if (enabled === true) await firstBarrier;
        return { enabled };
      }),
      onOptimistic: (_key, enabled) => displayed.push(["optimistic", enabled]),
      onConfirmed: (_key, enabled) => displayed.push(["confirmed", enabled]),
      onRollback: vi.fn(),
    });

    const first = queue.enqueue("conn-1", true);
    await Promise.resolve();
    await queue.enqueue("conn-1", false);
    releaseFirst();
    await first;

    expect(displayed).not.toContainEqual(["confirmed", true]);
    expect(displayed.at(-1)).toEqual(["confirmed", false]);
  });

  it("does not make unrelated connections wait for each other", async () => {
    let releaseFirst;
    const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
    const completed = [];
    const queue = createLatestIntentQueue({
      write: async (key, enabled) => {
        if (key === "conn-1") await firstBarrier;
        completed.push(key);
        return { enabled };
      },
      onOptimistic: vi.fn(),
      onRollback: vi.fn(),
    });

    const first = queue.enqueue("conn-1", true);
    await queue.enqueue("conn-2", true);
    expect(completed).toEqual(["conn-2"]);
    releaseFirst();
    await first;
    expect(completed).toEqual(["conn-2", "conn-1"]);
  });
});
