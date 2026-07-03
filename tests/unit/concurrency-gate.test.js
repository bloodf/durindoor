import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireSlot,
  releaseSlot,
  getConcurrencyLimit,
  getGateStats,
  _resetGates,
  ConcurrencyGateTimeoutError,
} from "../../open-sse/services/concurrencyGate.js";

beforeEach(() => {
  _resetGates();
});

describe("getConcurrencyLimit", () => {
  it("returns 0 when no map provided", () => {
    expect(getConcurrencyLimit("openai", undefined)).toBe(0);
    expect(getConcurrencyLimit("openai", null)).toBe(0);
  });

  it("returns 0 when provider not in map", () => {
    expect(getConcurrencyLimit("umans", { openai: 2 })).toBe(0);
  });

  it("returns the limit when provider is in map", () => {
    expect(getConcurrencyLimit("umans", { umans: 4 })).toBe(4);
    expect(getConcurrencyLimit("openai", { openai: 2, umans: 4 })).toBe(2);
  });

  it("returns 0 for invalid values", () => {
    expect(getConcurrencyLimit("x", { x: 0 })).toBe(0);
    expect(getConcurrencyLimit("x", { x: -1 })).toBe(0);
    expect(getConcurrencyLimit("x", { x: NaN })).toBe(0);
    expect(getConcurrencyLimit("x", { x: 1.5 })).toBe(1);
    expect(getConcurrencyLimit("x", { x: "3" })).toBe(0);
  });
});

describe("acquireSlot / releaseSlot", () => {
  it("resolves immediately when limit is 0 (no limit)", async () => {
    await expect(acquireSlot("test", 0)).resolves.toBeUndefined();
    // No slot was acquired, so release should be a no-op
    releaseSlot("test");
    expect(getGateStats()).toEqual({});
  });

  it("allows up to N concurrent requests", async () => {
    // Acquire 3 slots for limit=3
    await acquireSlot("p1", 3);
    await acquireSlot("p1", 3);
    await acquireSlot("p1", 3);

    const stats = getGateStats();
    expect(stats.p1.current).toBe(3);
    expect(stats.p1.queued).toBe(0);
  });

  it("blocks the 4th request when limit=3", async () => {
    await acquireSlot("p2", 3);
    await acquireSlot("p2", 3);
    await acquireSlot("p2", 3);

    let resolved = false;
    const p = acquireSlot("p2", 3).then(() => { resolved = true; });

    // Give microtasks a chance to resolve
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Release one slot — the 4th should now proceed
    releaseSlot("p2");
    await p;
    expect(resolved).toBe(true);

    // Stats should show current=3 (slot was handed off, not decremented)
    expect(getGateStats().p2.current).toBe(3);
  });

  it("cleans up gate when all slots released", async () => {
    await acquireSlot("p3", 2);
    releaseSlot("p3");
    expect(getGateStats()).toEqual({});
  });

  it("decrements correctly with sequential acquire/release", async () => {
    await acquireSlot("p4", 2);
    await acquireSlot("p4", 2);
    releaseSlot("p4");
    expect(getGateStats().p4.current).toBe(1);
    releaseSlot("p4");
    expect(getGateStats()).toEqual({});
  });

  it("isolates providers — each has its own gate", async () => {
    await acquireSlot("provider-a", 1);
    await acquireSlot("provider-b", 1);

    const stats = getGateStats();
    expect(stats["provider-a"].current).toBe(1);
    expect(stats["provider-b"].current).toBe(1);

    releaseSlot("provider-a");
    releaseSlot("provider-b");
    expect(getGateStats()).toEqual({});
  });
});

describe("acquireSlot timeout", () => {
  it("rejects with ConcurrencyGateTimeoutError after timeout", async () => {
    await acquireSlot("timeout-p", 1);

    const p = acquireSlot("timeout-p", 1, 50); // 50ms timeout
    await expect(p).rejects.toThrow(ConcurrencyGateTimeoutError);
    await expect(p).rejects.toMatchObject({
      provider: "timeout-p",
      limit: 1,
      timeoutMs: 50,
    });

    // The timed-out entry should be removed from the queue
    expect(getGateStats()["timeout-p"].queued).toBe(0);

    releaseSlot("timeout-p");
  });

  it("removed waiter does not cause over-release", async () => {
    // Acquire the only slot
    await acquireSlot("p5", 1);

    // Start a waiter that will timeout
    const waiter = acquireSlot("p5", 1, 50).catch(() => {});
    await new Promise(r => setTimeout(r, 80)); // wait for timeout

    // Now release — should decrement to 0, not underflow
    releaseSlot("p5");
    expect(getGateStats()).toEqual({});

    await waiter;
  });
});

describe("getGateStats", () => {
  it("returns empty object when no gates exist", () => {
    expect(getGateStats()).toEqual({});
  });

  it("shows queued count when requests are waiting", async () => {
    await acquireSlot("p6", 1);
    // Queue two waiters (don't await — they'll block)
    const w1 = acquireSlot("p6", 1, 5000).catch(() => {});
    const w2 = acquireSlot("p6", 1, 5000).catch(() => {});
    await new Promise(r => setTimeout(r, 10));

    const stats = getGateStats();
    expect(stats.p6.current).toBe(1);
    expect(stats.p6.queued).toBe(2);

    releaseSlot("p6"); // resolves w1 (slot handed off, current stays 1)
    await new Promise(r => setTimeout(r, 10));
    expect(getGateStats().p6.queued).toBe(1);

    releaseSlot("p6"); // resolves w2 (slot handed off, current stays 1)
    await new Promise(r => setTimeout(r, 10));
    expect(getGateStats().p6.queued).toBe(0);
    expect(getGateStats().p6.current).toBe(1);

    // Final release — now w2 owns the slot, release it to clean up
    releaseSlot("p6");
    await new Promise(r => setTimeout(r, 10));
    expect(getGateStats()).toEqual({});

    await Promise.allSettled([w1, w2]);
  });
});
