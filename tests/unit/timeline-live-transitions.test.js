// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useWindowedTraces } from "@/app/(dashboard)/dashboard/timeline/useWindowedTraces.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.parse("2026-09-05T12:15:00Z");
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const trace = (id, status = "running", ago = 60_000) => ({ id, provider: "example-provider", model: "example-model", status, started_at: new Date(Date.now() - ago).toISOString(), total_ms: status === "running" ? null : 750 });

describe("live timeline authoritative transitions", () => {
  let container, root, state, initial, store, delayed;
  function Harness({ filterQuery = "" }) {
    state = useWindowedTraces({ enabled: true, live: true, filterQuery, windowMs: 900_000 });
    return React.createElement("pre", null, JSON.stringify(state.traces));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    initial = deferred();
    store = new Map();
    delayed = new Map();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/settings") return response({ enableProxyTimeline: true });
      if (url.startsWith("/api/timeline?")) return initial.promise;
      const id = decodeURIComponent(url.slice("/api/timeline/".length));
      if (delayed.has(id)) return delayed.get(id).promise;
      return store.has(id) ? response({ trace: store.get(id), events: [] }) : response({}, 404);
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const mount = async (filterQuery = "") => {
    await act(async () => root.render(React.createElement(Harness, { filterQuery })));
  };
  const load = async (rows) => {
    await act(async () => initial.resolve(response({ traces: rows })));
  };
  const notify = (id, type = "trace") => {
    act(() => state.liveRefresh.schedule({ data: JSON.stringify(type === "trace" ? { type, id } : { type, traceId: id, kind: "response" }) }));
  };
  const flush = async () => {
    await act(async () => vi.advanceTimersByTimeAsync(500));
  };

  it("updates a retained trace even after more than 100 newer traces displace it", async () => {
    await mount();
    const retained = trace("retained", "running", 300_000);
    await load([retained]);
    for (let index = 0; index < 101; index += 1) {
      const row = trace(`new-${index}`, "ok", 1000 + index);
      store.set(row.id, row);
      notify(row.id);
    }
    await flush();
    const complete = { ...retained, status: "ok", total_ms: 1234, event_count: 9 };
    store.set("retained", complete);
    notify("retained", "event");
    await flush();
    expect(state.traces.find((row) => row.id === "retained")).toEqual(complete);
    expect(state.traces).toHaveLength(102);
    expect(JSON.parse(container.textContent).find((row) => row.id === "retained").status).toBe("ok");
  });

  it("removes completed traces from a running filter and admits newly matching traces", async () => {
    await mount("status=running&provider=example-provider");
    const running = trace("running");
    await load([running]);
    store.set("running", { ...running, status: "error", total_ms: 500 });
    store.set("new-running", trace("new-running"));
    store.set("unrelated", { ...trace("unrelated"), provider: "other-provider" });
    notify("running");
    notify("new-running", "event");
    notify("unrelated");
    await flush();
    expect(state.traces.map((row) => row.id)).toEqual(["new-running"]);
    expect(JSON.parse(container.textContent)).toEqual([store.get("new-running")]);
  });

  it("retains a notification after the initial endDate with no subsequent traffic", async () => {
    await mount();
    vi.setSystemTime(NOW + 1000);
    store.set("late", trace("late", "running", 0));
    notify("late", "event");
    await flush(); // The initial response is still blocked.
    expect(state.loading).toBe(true);
    await load([]);
    await flush();
    expect(state.traces).toEqual([store.get("late")]);
    expect(state.error).toBe("");
  });

  it("reconciles a second notification arriving while the same ID refresh is in flight", async () => {
    await mount();
    const running = trace("changing");
    await load([running]);
    const first = deferred();
    delayed.set("changing", first);
    notify("changing");
    await flush();
    const completed = { ...running, status: "ok", total_ms: 990 };
    store.set("changing", completed);
    notify("changing", "event");
    delayed.delete("changing");
    await act(async () => first.resolve(response({ trace: running })));
    await flush();
    expect(state.traces).toEqual([completed]);
  });

  it("ignores a stale initial response after URL filters change", async () => {
    await mount();
    const old = initial;
    initial = deferred();
    await mount("status=error");
    const error = trace("current", "error");
    await load([error]);
    await act(async () => old.resolve(response({ traces: [trace("stale")] })));
    expect(state.traces).toEqual([error]);
    expect(state.loading).toBe(false);
  });

  it("removes deleted traces and prunes updates outside the time window", async () => {
    await mount();
    await load([trace("deleted"), trace("aged")]);
    store.set("aged", trace("aged", "ok", 900_001));
    notify("deleted");
    notify("aged");
    await flush();
    expect(state.traces).toEqual([]);
  });
});
