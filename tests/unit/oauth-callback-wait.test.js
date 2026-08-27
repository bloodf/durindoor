import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as serverUtils from "../../src/lib/oauth/utils/server.js";
const { startLocalServer } = serverUtils;

describe("waitForCallbackParams", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with callback params and clears both timers", async () => {
    let params = null;
    const waiting = serverUtils.waitForCallbackParams(() => params, 300_000);

    await vi.advanceTimersByTimeAsync(250);
    params = { code: "abc", state: "xyz" };
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toEqual(params);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects on timeout without leaving its poll timer behind", async () => {
    const waiting = serverUtils.waitForCallbackParams(() => null, 300_000);
    const rejected = expect(waiting).rejects.toThrow("Authentication timeout (5 minutes)");

    await vi.advanceTimersByTimeAsync(300_000);

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reading callback params after settling", async () => {
    let calls = 0;
    const waiting = serverUtils.waitForCallbackParams(() => (++calls === 3 ? { code: "ok" } : null), 300_000);

    await vi.advanceTimersByTimeAsync(300);
    await waiting;
    const settledAt = calls;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toBe(settledAt);
  });
});

function canBind(port) {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

describe("startLocalServer", () => {
  it("releases its port and tolerates repeated cleanup", async () => {
    const { port, close } = await startLocalServer(() => {});

    close();
    expect(() => close()).not.toThrow();
    await expect(canBind(port)).resolves.toBe(true);
  });
});
