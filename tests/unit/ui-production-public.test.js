import { describe, expect, it, vi } from "vitest";
import { deliverOAuthCallback } from "@/app/callback/callbackDelivery.js";

function makeRuntime(overrides = {}) {
  const postMessage = vi.fn();
  const broadcastPosts = [];
  const storage = (() => {
    const store = new Map();
    return {
      setItem: vi.fn((k, v) => store.set(k, v)),
      removeItem: vi.fn((k) => store.delete(k)),
      snapshot: () => Object.fromEntries(store),
    };
  })();
  const close = vi.fn();
  const log = vi.fn();
  const statuses = [];
  const failures = [];
  const now = vi.fn(() => 1700000000000);

  let clock = 0;
  let nextId = 1;
  const timers = new Map(); // id -> { fn, due }

  const runtime = {
    now,
    window: { location: { origin: "https://app.test" }, opener: { postMessage }, close },
    BroadcastChannel: class {
      constructor(name) { this.name = name; }
      postMessage(data) { broadcastPosts.push({ channel: this.name, data }); }
      close() {}
    },
    localStorage: storage,
    getLocalStorage: () => storage,
    setTimeout: vi.fn((fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: clock + ms });
      return id;
    }),
    clearTimeout: vi.fn((id) => timers.delete(id)),
    setStatus: vi.fn((s) => statuses.push(s)),
    setFailureMessage: vi.fn((m) => failures.push(m)),
    log,
    statuses,
    failures,
    broadcastPosts,
    // Advances the virtual clock and fires only timers due by the new time,
    // in due-time order, picking up timers scheduled by earlier callbacks
    // (e.g. the nested 500ms "done" timer scheduled inside the 1500ms one).
    advance(ms) {
      clock += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= clock).sort((a, b) => a[1].due - b[1].due);
        if (due.length === 0) break;
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    ...overrides,
  };
  return runtime;
}

const SP = (params) => ({ get: (k) => params[k] ?? null });

describe("callback delivery (transport + timing)", () => {
  it("success path: posts to opener per origin, BroadcastChannel, then runs success → close → done in order", () => {
    const runtime = makeRuntime();
    deliverOAuthCallback(SP({ code: "abc", state: "xyz" }), runtime);
    expect(runtime.window.opener.postMessage).toHaveBeenCalledWith(
      { type: "oauth_callback", data: expect.objectContaining({ code: "abc", state: "xyz" }) },
      "https://app.test",
    );
    expect(runtime.broadcastPosts).toEqual([{ channel: "oauth_callback", data: expect.objectContaining({ code: "abc" }) }]);
    expect(runtime.localStorage.setItem).toHaveBeenCalledWith("oauth_callback", expect.any(String));
    expect(runtime.localStorage.removeItem).toHaveBeenCalledWith("oauth_callback");

    // t=0: the immediate "success" timer fires.
    runtime.advance(0);
    expect(runtime.statuses).toEqual(["success"]);
    expect(runtime.window.close).not.toHaveBeenCalled();

    // t=1500: window.close() fires and schedules the nested 500ms "done" timer.
    runtime.advance(1500);
    expect(runtime.window.close).toHaveBeenCalledTimes(1);
    expect(runtime.statuses).toEqual(["success"]);

    // t=2000 (1500 + 500): the nested timer fires.
    runtime.advance(500);
    expect(runtime.statuses).toEqual(["success", "done"]);
  });

  it("error path: closes with failure message and never calls window.close", () => {
    const runtime = makeRuntime();
    deliverOAuthCallback(SP({ error: "access_denied", error_description: "User denied" }), runtime);
    runtime.advance(0);
    expect(runtime.statuses).toEqual(["error"]);
    expect(runtime.failures).toEqual(["User denied"]);
    expect(runtime.window.close).not.toHaveBeenCalled();
  });

  it("manual fallback when no code/token/error is present", () => {
    const runtime = makeRuntime();
    deliverOAuthCallback(SP({}), runtime);
    runtime.advance(0);
    expect(runtime.statuses).toEqual(["manual"]);
    expect(runtime.window.close).not.toHaveBeenCalled();
  });

  it("opener postMessage failure does not break BroadcastChannel or localStorage transports", () => {
    const runtime = makeRuntime({ window: { location: { origin: "https://app.test" }, opener: { postMessage: () => { throw new Error("denied"); } }, close: vi.fn() } });
    deliverOAuthCallback(SP({ code: "abc" }), runtime);
    expect(runtime.log).toHaveBeenCalledWith("postMessage failed:", expect.any(Error));
    expect(runtime.broadcastPosts).toHaveLength(1);
    expect(runtime.localStorage.setItem).toHaveBeenCalled();
  });

  it("cleanup after the 1500ms close callback still cancels the nested 500ms done timer", () => {
    const runtime = makeRuntime();
    const cleanup = deliverOAuthCallback(SP({ code: "abc" }), runtime);
    runtime.advance(0); // "success"
    runtime.advance(1500); // window.close() fires, schedules nested 500ms "done" timer
    expect(runtime.window.close).toHaveBeenCalledTimes(1);
    cleanup(); // must cancel the nested timer even though it was scheduled after mount
    runtime.advance(500);
    expect(runtime.statuses).toEqual(["success"]);
  });

  it("cleanup called before any timer fires clears everything", () => {
    const runtime = makeRuntime();
    const cleanup = deliverOAuthCallback(SP({ code: "abc" }), runtime);
    cleanup();
    runtime.advance(5000);
    expect(runtime.statuses).toEqual([]);
  });
});
