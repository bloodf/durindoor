// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({ default: () => null, fmt: String, fmtTime: String }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageChart", () => ({ default: () => null }));
// UsageStats and RequestsPanel mount unchanged; only unrelated widgets and I/O are inert.
import UsageStats from "@/shared/components/UsageStats.js";

const stats = (model) => ({
  totalRequests: model ? 1 : 0, totalCost: 0,
  byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  pending: { byModel: {}, byAccount: {} }, activeRequests: [], activeSessions: [],
  recentRequests: model ? [{ requestId: model, model, status: "ok", promptTokens: 2, completionTokens: 3 }] : [],
});
const response = (model) => ({ ok: true, json: async () => stats(model) });
let container, root, streams, readStats;
const render = async (period) => { await act(async () => root.render(React.createElement(UsageStats, { period, hidePeriodSelector: true }))); };
const retry = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry usage");
beforeEach(() => {
  streams = [];
  vi.stubGlobal("EventSource", class {
    constructor(url) { this.url = url; this.close = vi.fn(); streams.push(this); }
  });
  readStats = vi.fn(async () => response());
  vi.stubGlobal("fetch", vi.fn((url, options) => String(url).startsWith("/api/usage/stats")
    ? readStats(url, options)
    : Promise.resolve({ ok: true, json: async () => ({ connections: [], nodes: [], disabledFreeProviders: [] }) })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("production RequestsPanel filtered-read feedback", () => {

  it.each(["today", "7d"])("keeps live %s snapshots current when the caller also supplies preset dates", async (period) => {
    await act(async () => root.render(React.createElement(UsageStats, {
      period, hidePeriodSelector: true, isCustomRange: false,
      customRange: { startDate: "2026-11-01", endDate: "2026-11-07" },
    })));
    await act(async () => streams[0].onmessage({ data: JSON.stringify(stats("current-live-model")) }));
    expect(container.textContent).toContain("current-live-model");
    expect(container.textContent).not.toContain("Showing previous");
    expect(container.textContent).not.toContain("Waiting for the selected period");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a custom date range authoritative while SSE updates its live overlay", async () => {
    readStats.mockResolvedValueOnce(response("custom-rest-model"));
    await act(async () => root.render(React.createElement(UsageStats, {
      period: "7d", hidePeriodSelector: true, isCustomRange: true,
      customRange: { startDate: "2026-11-01", endDate: "2026-11-07" },
    })));
    await act(async () => streams[0].onmessage({ data: JSON.stringify(stats()) }));
    expect(container.textContent).not.toContain("Showing previous");
    expect(container.textContent).not.toContain("Waiting for the selected period");
    expect(readStats.mock.calls[0][0]).toBe("/api/usage/stats?period=7d&startDate=2026-11-01&endDate=2026-11-07");
  });

  it.each([
    [undefined, "http"], ["previous-model", "http"],
    [undefined, "network"], ["previous-model", "network"],
  ])("retains %s after a %s failure and retries the current period", async (model, failure) => {
    readStats.mockResolvedValueOnce(response(model));
    await render("today");
    expect(container.textContent).toContain(model || "No requests yet");
    let fail;
    readStats.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = () => failure === "http" ? resolve({ ok: false }) : reject(new Error("inert network failure")); }));
    await render("7d");
    expect(container.textContent).toContain("Showing previous Today usage. Updating selected period…");
    await act(async () => fail());
    expect(container.querySelector('[role="alert"]').textContent).toBe("Usage statistics could not be refreshed. Last received usage remains visible.Retry usage");
    expect(container.textContent).toContain("Showing previous Today usage. Waiting for the selected period.");
    expect(container.textContent).toContain(model || "No requests yet");
    readStats.mockResolvedValueOnce(response("current-model"));
    await act(async () => retry().click());
    expect(readStats.mock.calls.at(-1)[0]).toBe("/api/usage/stats?period=7d");
    expect(container.textContent).toContain("current-model");
    expect(container.textContent).not.toContain("previous-model");
    expect(container.textContent).not.toContain("Showing previous");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps initial loading and failure distinct from a successful empty result", async () => {
    let finish;
    readStats.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render("today");
    expect(container.textContent).toContain("Loading usage statistics");
    expect(container.textContent).not.toContain("No requests yet");
    await act(async () => finish({ ok: false }));
    expect(container.querySelector('[role="alert"]').textContent).toBe("Failed to load usage statistics.Retry usage");
    expect(container.textContent).not.toContain("No requests yet");
    await act(async () => retry().click());
    expect(container.textContent).toContain("No requests yet");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("ignores late canceled REST and closed-stream callbacks after a filter change", async () => {
    let finishOld, oldSignal;
    readStats.mockImplementationOnce((url, options) => { oldSignal = options.signal; return new Promise((resolve) => { finishOld = resolve; }); });
    await render("today");
    const oldStream = streams[0];
    readStats.mockResolvedValueOnce(response("current-model"));
    await render("7d");
    expect(oldSignal.aborted).toBe(true);
    expect(oldStream.close).toHaveBeenCalledOnce();
    await act(async () => {
      finishOld(response("obsolete-rest"));
      oldStream.onmessage({ data: JSON.stringify(stats("obsolete-stream")) });
      oldStream.onerror();
    });
    expect(container.textContent).toContain("current-model");
    expect(container.textContent).not.toContain("obsolete");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
