// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageStats } from "../../src/shared/ui/v5/usage/fixtures.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: ({ stats }) => React.createElement("output", { "aria-label": "Usage total" }, stats.totalRequests) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({ default: () => null, fmt: String, fmtTime: String }));
vi.mock("../../src/shared/ui/v5/usage/ReviewUsageChart.jsx", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: () => null }));
import ReviewUsageStats from "../../src/shared/ui/v5/usage/ReviewUsageStats.jsx";

let container, root, streams;
const response = (totalRequests) => ({ ok: true, json: async () => ({ ...usageStats, totalRequests }) });
const render = async (period, extra = {}) => { await act(async () => root.render(React.createElement(ReviewUsageStats, { period, hidePeriodSelector: true, ...extra }))); };
const total = () => container.querySelector('[aria-label="Usage total"]').textContent;
beforeEach(() => {
  streams = [];
  vi.stubGlobal("EventSource", class {
    constructor(url) { this.url = url; this.close = vi.fn(); streams.push(this); }
    emit(value) { this.onmessage?.({ data: JSON.stringify({ ...usageStats, totalRequests: value }) }); }
  });
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).startsWith("/api/usage/stats") ? response(12) : ({ ok: true, json: async () => ({ connections: [], nodes: [], disabledFreeProviders: [] }) })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("usage snapshot feedback with a shared dashboard period", () => {
  it("labels retained totals during a period change and clears the notice when that period arrives", async () => {
    await render("today");
    let resolveNext;
    fetch.mockImplementation((url) => String(url).startsWith("/api/usage/stats") ? new Promise((resolve) => { resolveNext = resolve; }) : Promise.resolve(response(0)));
    await render("7d");
    expect(total()).toBe("12");
    expect(container.textContent).toContain("Showing previous Today usage.");
    expect(container.textContent).toContain("Updating selected period");
    await act(async () => resolveNext(response(70)));
    expect(total()).toBe("70");
    expect(container.textContent).not.toContain("Showing previous");
  });

  it("reports failed refreshes, keeps the previous period labeled and retries the selected period", async () => {
    await render("today");
    fetch.mockImplementation(async (url) => String(url).startsWith("/api/usage/stats") ? ({ ok: false }) : response(0));
    await render("7d");
    expect(total()).toBe("12");
    expect(container.textContent).toContain("Showing previous Today usage.");
    expect(container.querySelector('[role="alert"]').textContent).toContain("could not be refreshed");
    fetch.mockImplementation(async (url) => String(url).startsWith("/api/usage/stats") ? response(70) : response(0));
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry usage");
    await act(async () => retry.click());
    expect(fetch.mock.calls.at(-1)[0]).toBe("/api/usage/stats?period=7d");
    expect(total()).toBe("70");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Showing previous");
  });

  it("ignores messages and errors from closed period streams", async () => {
    await render("today");
    const previous = streams[0];
    await render("7d");
    expect(previous.close).toHaveBeenCalledOnce();
    await act(async () => { streams[1].emit(70); previous.emit(999); previous.onerror(); });
    expect(total()).toBe("70");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => streams[1].onerror());
    expect(container.querySelector('[role="alert"]').textContent).toContain("Live usage updates are unavailable");
    expect(total()).toBe("70");
    await act(async () => streams[1].emit(71));
    expect(total()).toBe("71");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("labels the actual custom-date snapshot while live events preserve REST totals", async () => {
    const custom = { customRange: { startDate: "2026-09-01", endDate: "2026-09-30" }, isCustomRange: true };
    await render("7d", custom);
    await act(async () => streams[0].emit(999));
    expect(total()).toBe("12");
    fetch.mockImplementation(async (url) => String(url).startsWith("/api/usage/stats") ? ({ ok: false }) : response(0));
    await render("today");
    expect(total()).toBe("12");
    expect(container.textContent).toContain("Showing previous 2026-09-01 to 2026-09-30 usage.");
  });

  it("waits for custom-range REST totals when live events arrive first", async () => {
    let resolveRest;
    fetch.mockImplementation((url) => String(url).startsWith("/api/usage/stats") ? new Promise((resolve) => { resolveRest = resolve; }) : Promise.resolve(response(0)));
    await render("7d", { customRange: { startDate: "2026-09-01", endDate: "2026-09-30" }, isCustomRange: true });
    await act(async () => streams[0].emit(999));
    expect(container.querySelector('[aria-label="Usage total"]')).toBeNull();
    expect(container.textContent).toContain("Loading usage statistics");
    await act(async () => resolveRest(response(12)));
    expect(total()).toBe("12");
  });
});
