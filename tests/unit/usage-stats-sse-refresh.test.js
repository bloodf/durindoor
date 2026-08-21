// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  emit(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.closed = true;
  }
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/components/Badge", () => ({ default: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/components/Card", () => ({ default: ({ children }) => React.createElement("div", null, children) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({
  default: ({ stats }) => React.createElement("div", {
    "data-total-requests": stats.totalRequests,
    "data-stats": JSON.stringify(stats),
  }),
}));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({
  default: () => null,
  fmt: String,
  fmtTime: String,
}));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageChart", () => ({
  default: ({ refreshKey }) => React.createElement("div", { "data-chart-refresh-key": refreshKey }),
}));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: () => null }));

import UsageStats from "@/shared/components/UsageStats.js";

const jsonResponse = (data) => ({ ok: true, json: async () => data });
const fullStats = (totalRequests, overrides = {}) => ({
  totalRequests,
  totalCost: 0,
  byProvider: {},
  byModel: {},
  byAccount: {},
  byApiKey: {},
  byEndpoint: {},
  activeRequests: [],
  activeSessions: [],
  recentRequests: [],
  pending: { byModel: {}, byAccount: {} },
  ...overrides,
});

describe("UsageStats period SSE refresh", () => {
  let container;
  let root;
  let resolveRest;
  let statsSignal;

  beforeEach(() => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource;
    globalThis.fetch = vi.fn((url, options = {}) => {
      if (String(url).startsWith("/api/usage/stats")) {
        statsSignal = options.signal;
        return new Promise((resolve) => { resolveRest = resolve; });
      }
      return Promise.resolve(jsonResponse({}));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lets the period-keyed SSE snapshot abort and supersede stale REST", async () => {
    await act(async () => {
      root.render(React.createElement(UsageStats, { period: "7d", hidePeriodSelector: true }));
      await Promise.resolve();
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/usage/stream?period=7d");
    expect(statsSignal.aborted).toBe(false);

    await act(async () => {
      FakeEventSource.instances[0].emit(fullStats(8));
    });

    expect(statsSignal.aborted).toBe(true);
    expect(container.querySelector("[data-total-requests]")?.getAttribute("data-total-requests")).toBe("8");
    expect(container.querySelector("[data-chart-refresh-key]")?.getAttribute("data-chart-refresh-key")).toBe("8");

    await act(async () => {
      resolveRest(jsonResponse(fullStats(3)));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-total-requests]")?.getAttribute("data-total-requests")).toBe("8");
  });

  it("preserves custom-range totals and breakdowns while applying the live SSE overlay", async () => {
    const customStats = fullStats(3, {
      totalCost: 1.25,
      byModel: { rangeModel: { requests: 3, rawModel: "rangeModel", provider: "range-provider" } },
      byAccount: { rangeAccount: { requests: 3 } },
      byApiKey: { rangeKey: { requests: 3 } },
      byEndpoint: { rangeEndpoint: { requests: 3 } },
    });
    const presetStats = fullStats(99, {
      totalCost: 42,
      byModel: { presetModel: { requests: 99, rawModel: "presetModel", provider: "preset-provider" } },
      byAccount: { presetAccount: { requests: 99 } },
      byApiKey: { presetKey: { requests: 99 } },
      byEndpoint: { presetEndpoint: { requests: 99 } },
      activeRequests: [{ model: "live" }],
    });

    await act(async () => {
      root.render(React.createElement(UsageStats, {
        period: "7d",
        customRange: { startDate: "2026-08-01", endDate: "2026-08-02" },
        isCustomRange: true,
        hidePeriodSelector: true,
      }));
      await Promise.resolve();
    });

    await act(async () => {
      FakeEventSource.instances[0].emit(presetStats);
    });
    expect(statsSignal.aborted).toBe(false);

    await act(async () => {
      resolveRest(jsonResponse(customStats));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      FakeEventSource.instances[0].emit(presetStats);
    });

    const renderedStats = JSON.parse(container.querySelector("[data-stats]").getAttribute("data-stats"));
    expect(renderedStats).toMatchObject({
      totalRequests: 3,
      totalCost: 1.25,
      byModel: customStats.byModel,
      byAccount: customStats.byAccount,
      byApiKey: customStats.byApiKey,
      byEndpoint: customStats.byEndpoint,
      activeRequests: presetStats.activeRequests,
    });
  });
});
