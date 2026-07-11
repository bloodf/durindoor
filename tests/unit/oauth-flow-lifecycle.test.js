import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_CALLBACK_FRESHNESS_MS,
  createOAuthFlowLifecycle,
  oauthProxySelection,
} from "@/shared/utils/oauthFlowLifecycle";

function createHarness(startAt = 1_000) {
  let time = startAt;
  const timers = new Map();
  let nextTimer = 0;
  const lifecycle = createOAuthFlowLifecycle({
    now: () => time,
    setTimer: (callback) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    lifecycle,
    timers,
    advance(ms) { time += ms; },
    fire(id) {
      const callback = timers.get(id);
      timers.delete(id);
      callback?.();
    },
    now() { return time; },
  };
}

describe("OAuth flow lifecycle", () => {
  it("uses explicit direct and strict-pool routing selections", () => {
    expect(oauthProxySelection("")).toEqual({ proxyMode: "direct" });
    expect(oauthProxySelection("pool-1")).toEqual({
      proxyMode: "strict-pool",
      proxyPoolId: "pool-1",
    });
  });

  it("aborts timers and closes the prior popup before replacing a flow", async () => {
    const { lifecycle } = createHarness();
    const first = lifecycle.begin().flow;
    const popup = { closed: false, close: vi.fn(function close() { this.closed = true; }) };
    lifecycle.bindPopup(first, popup);
    const waiting = lifecycle.wait(first, 500);

    const second = lifecycle.begin().flow;

    await expect(waiting).resolves.toBe(false);
    expect(first.controller.signal.aborted).toBe(true);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(lifecycle.isActive(first)).toBe(false);
    expect(lifecycle.isActive(second)).toBe(true);
    expect(first.ownerId).toBe(second.ownerId);
  });

  it("rejects stale continuations after a newer generation starts", () => {
    const { lifecycle } = createHarness();
    const first = lifecycle.begin().flow;
    const second = lifecycle.begin().flow;

    expect(lifecycle.bindFlowId(first, "old-flow")).toBe(false);
    expect(lifecycle.bindFlowId(second, "new-flow")).toBe(true);
    expect(lifecycle.current()).toBe(second);
  });

  it("accepts postMessage only from the exact origin, popup, and state", () => {
    const { lifecycle } = createHarness();
    const flow = lifecycle.begin().flow;
    const popup = { closed: false, close: vi.fn() };
    lifecycle.bindPopup(flow, popup);
    lifecycle.bindState(flow, "expected-state");
    const event = {
      origin: "https://dashboard.example",
      source: popup,
      data: { type: "oauth_callback", data: { state: "expected-state", code: "code" } },
    };

    expect(lifecycle.acceptsPostMessage(flow, event, "https://dashboard.example")).toBe(true);
    expect(lifecycle.acceptsPostMessage(flow, { ...event, origin: "https://dashboard.example.evil" }, "https://dashboard.example")).toBe(false);
    expect(lifecycle.acceptsPostMessage(flow, { ...event, source: {} }, "https://dashboard.example")).toBe(false);
    expect(lifecycle.acceptsPostMessage(flow, {
      ...event,
      data: { ...event.data, data: { ...event.data.data, state: "other" } },
    }, "https://dashboard.example")).toBe(false);
  });

  it("requires exact state and a fresh callback timestamp for shared channels", () => {
    const harness = createHarness();
    const { lifecycle } = harness;
    const flow = lifecycle.begin().flow;
    lifecycle.bindState(flow, "state-1");
    harness.advance(10);

    expect(lifecycle.acceptsCallback(flow, {
      state: "state-1",
      timestamp: harness.now(),
    }, { requireFresh: true })).toBe(true);
    expect(lifecycle.acceptsCallback(flow, {
      state: "state-2",
      timestamp: harness.now(),
    }, { requireFresh: true })).toBe(false);
    expect(lifecycle.acceptsCallback(flow, {
      state: "state-1",
      timestamp: harness.now() - OAUTH_CALLBACK_FRESHNESS_MS - 1,
    }, { requireFresh: true })).toBe(false);
    expect(lifecycle.acceptsCallback(flow, {
      state: "state-1",
      timestamp: harness.now() + 1,
    }, { requireFresh: true })).toBe(false);
  });

  it("admits one callback and settles success at most once", () => {
    const { lifecycle, now } = createHarness();
    const flow = lifecycle.begin().flow;
    lifecycle.bindState(flow, "state-1");
    const callback = { state: "state-1", timestamp: now() };
    const onSuccess = vi.fn();

    expect(lifecycle.claimCallback(flow, callback, { requireFresh: true })).toBe(true);
    expect(lifecycle.claimCallback(flow, callback, { requireFresh: true })).toBe(false);
    expect(lifecycle.settle(flow, onSuccess)).toBe(true);
    expect(lifecycle.settle(flow, onSuccess)).toBe(false);
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
