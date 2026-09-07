// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let currentSearchParams = new URLSearchParams();
const replace = vi.fn((url) => {
  currentSearchParams = new URLSearchParams(url.split("?")[1] || "");
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({ replace }),
}));

import TimelinePage from "@/app/(dashboard)/dashboard/timeline/page.js";

function trace(id, model) {
  return {
    id,
    started_at: "2026-09-05T12:00:00.000Z",
    status: "ok",
    provider: "codex",
    model,
    connection_id: "fixture-connection",
    event_count: 1,
    fallback_count: 0,
    total_ms: 10,
  };
}

describe("TimelinePage 'all' rows-per-page batching", () => {
  let container;
  let root;

  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    replace.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accumulates every bounded 100-row page into one rendered table when pageSize=all", async () => {
    currentSearchParams = new URLSearchParams("pageSize=all&page=1");
    const calls = [];
    globalThis.EventSource = class {
      close() {}
    };
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith("/api/timeline?")) {
        const params = new URLSearchParams(String(url).split("?")[1]);
        const page = Number(params.get("page"));
        if (page === 1) {
          return { ok: true, json: async () => ({ traces: [trace("t1", "gpt-5-a"), trace("t2", "gpt-5-b")], pagination: { page: 1, pageSize: 100, totalItems: 3, totalPages: 1 } }) };
        }
        return { ok: true, json: async () => ({ traces: [trace("t3", "gpt-5-c")], pagination: { page: 2, pageSize: 100, totalItems: 3, totalPages: 1 } }) };
      }
      return { ok: true, json: async () => ({ enableProxyTimeline: true }) };
    });

    await act(async () => {
      root.render(React.createElement(TimelinePage));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("gpt-5-a");
    expect(container.textContent).toContain("gpt-5-b");
    expect(container.textContent).toContain("gpt-5-c");
    // Every /api/timeline request must request the server-bounded pageSize=100,
    // never a literal pageSize=all — the server rejects non-numeric pageSize.
    for (const url of calls.filter((u) => u.startsWith("/api/timeline?"))) {
      expect(url).toContain("pageSize=100");
    }
  });

  it("terminates the batching loop on an empty page even if reported totalItems overcounts", async () => {
    currentSearchParams = new URLSearchParams("pageSize=all&page=1");
    const timelineCalls = [];
    globalThis.EventSource = class {
      close() {}
    };
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).startsWith("/api/timeline?")) {
        const params = new URLSearchParams(String(url).split("?")[1]);
        const page = Number(params.get("page"));
        timelineCalls.push(page);
        if (page === 1) return { ok: true, json: async () => ({ traces: [trace("t1", "gpt-5-a"), trace("t2", "gpt-5-b")], pagination: { page: 1, pageSize: 100, totalItems: 4, totalPages: 1 } }) };
        if (page === 2) return { ok: true, json: async () => ({ traces: [trace("t3", "gpt-5-c")], pagination: { page: 2, pageSize: 100, totalItems: 4, totalPages: 1 } }) };
        // Server reports totalItems=4 but only 3 rows ever exist — page 3 is
        // empty. The loop must stop here (not spin forever) via the
        // `(page.traces || []).length === 0` break condition.
        return { ok: true, json: async () => ({ traces: [], pagination: { page: 3, pageSize: 100, totalItems: 4, totalPages: 1 } }) };
      }
      return { ok: true, json: async () => ({ enableProxyTimeline: true }) };
    });

    await act(async () => {
      root.render(React.createElement(TimelinePage));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(timelineCalls).toEqual([1, 2, 3]);
    expect(container.textContent).toContain("gpt-5-a");
    expect(container.textContent).toContain("gpt-5-b");
    expect(container.textContent).toContain("gpt-5-c");
  });

  it("does not commit a stale in-flight response after a newer request supersedes it", async () => {
    currentSearchParams = new URLSearchParams("page=1");
    globalThis.EventSource = class {
      close() {}
    };
    let resolveFirst;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    let requestCount = 0;
    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).startsWith("/api/timeline?")) {
        requestCount += 1;
        const isFirst = requestCount === 1;
        const settled = isFirst ? await firstResponse : { traces: [trace("t-second", "second-response-model")], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return { ok: true, json: async () => settled };
      }
      return { ok: true, json: async () => ({ enableProxyTimeline: true }) };
    });

    let rerender;
    await act(async () => {
      root.render(React.createElement(TimelinePage));
      rerender = () => root.render(React.createElement(TimelinePage));
      await Promise.resolve();
    });

    // Trigger a second, distinct request before the first resolves.
    currentSearchParams = new URLSearchParams("page=2");
    await act(async () => {
      rerender();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now let the stale first request resolve with data that must never appear.
    await act(async () => {
      resolveFirst({ traces: [trace("t-stale", "stale-response-model")], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("second-response-model");
    expect(container.textContent).not.toContain("stale-response-model");
  });
});
