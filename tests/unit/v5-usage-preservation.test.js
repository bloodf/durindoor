// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { USAGE_WIDGETS, USAGE_LAYOUT_KEY, moveUsageWidget, normalizeUsageLayout, readUsageLayout, updateUsageWidget } from "../../src/shared/ui/v5/usage/layout.js";
import { usageFixture, usageStats } from "../../src/shared/ui/v5/usage/fixtures.js";
import { KEY_USAGE_POLL_MS } from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";
import { installStoryNetwork } from "../../.storybook/network.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/components", () => ({ RequestLogger: () => null, CardSkeleton: () => React.createElement("div", null, "Loading") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab", () => ({ default: () => null }));
const { originalOverviewPlay } = vi.hoisted(() => ({ originalOverviewPlay: vi.fn() }));
vi.mock("../../src/app/(dashboard)/dashboard/usage/page.stories.jsx", () => ({ default: { parameters: { storyFixture: { routes: { "GET /api/keys": { body: { keys: [] } } } } } }, Overview: { play: originalOverviewPlay } }));
vi.mock("../../src/shared/ui/v5/ReviewFrame.jsx", () => ({ reviewDecorator: (Story) => React.createElement(Story) }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children, footer }) => open ? React.createElement("div", { role: "dialog", "aria-label": title }, children, footer) : null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ options, value, onChange, ...rest }) => React.createElement("select", { "aria-label": rest["aria-label"], value, onChange: (event) => onChange(options.find((option) => String(option.value) === event.target.value)?.value) }, options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: ({ stats }) => React.createElement("div", { "data-stats": JSON.stringify(stats) }) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({ default: (props) => React.createElement("div", { "data-groups": JSON.stringify(props.groupedData), "data-value-mode": props.valueMode }), fmt: String, fmtTime: String }));
vi.mock("../../src/shared/ui/v5/usage/ReviewUsageChart.jsx", () => ({ default: ({ refreshKey }) => React.createElement("div", { "data-chart-refresh": refreshKey }) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: ({ activeSessions }) => React.createElement("div", { "data-sessions": JSON.stringify(activeSessions) }) }));
import ReviewUsageStats from "../../src/shared/ui/v5/usage/ReviewUsageStats.jsx";
import UsageWidgetLayout from "../../src/shared/ui/v5/usage/UsageWidgetLayout.jsx";
import ReviewUsagePage from "../../src/shared/ui/v5/usage/ReviewUsagePage.jsx";
import ReviewApiKeyLimitsCard from "../../src/shared/ui/v5/usage/ReviewApiKeyLimitsCard.jsx";
const { default: ActualReviewUsageChart } = await vi.importActual("../../src/shared/ui/v5/usage/ReviewUsageChart.jsx");
import canonicalUsageMeta, { Overview as CanonicalUsageOverview } from "../../src/shared/ui/v5/stories/src-app-dashboard-dashboard-usage-page.stories.jsx";

describe("review usage layout", () => {
  it("starts with every existing section visible and reconciles old saved layouts without losing sections", () => {
    const layout = normalizeUsageLayout([{ id: "keys", title: "Key policy", span: 6, visible: false }]);
    expect(layout.map((widget) => widget.id)).toEqual(["keys", ...USAGE_WIDGETS.filter((widget) => widget.id !== "keys").map((widget) => widget.id)]);
    expect(layout[0]).toMatchObject({ title: "Key policy", visible: false, span: 6 });
    expect(normalizeUsageLayout(null).every((widget) => widget.visible)).toBe(true);
  });
  it("rejects unknown or duplicate identities and malformed presentation fields", () => {
    const layout = normalizeUsageLayout([{ id: "topology", title: " ", span: 99, visible: "false" }, { id: "topology", visible: false }, { id: "unknown" }]);
    expect(layout).toHaveLength(8);
    expect(layout.map((widget) => widget.id)).toContain("monitoring");
    expect(layout[0]).toMatchObject(USAGE_WIDGETS[1]);
    expect(new Set(layout.map((widget) => widget.id)).size).toBe(8);
  });
  it("moves visible widgets without deleting hidden widgets or mutating the saved layout", () => {
    const saved = updateUsageWidget(normalizeUsageLayout(null), "chart", { visible: false });
    const draft = moveUsageWidget(saved, "topology", "overview");
    expect(draft[0].id).toBe("topology");
    expect(saved[0].id).toBe("overview");
    expect(draft.find((widget) => widget.id === "chart").visible).toBe(false);
    expect(moveUsageWidget(saved, "topology", "unknown")).toBe(saved);
  });
  it("edits only presentation and preserves widget identity", () => {
    const saved = normalizeUsageLayout(null);
    const draft = updateUsageWidget(saved, "overview", { id: "replacement", title: " My totals ", span: 6, visible: false });
    expect(draft[0]).toEqual({ id: "overview", title: "My totals", span: 6, visible: false });
    expect(saved[0]).toMatchObject(USAGE_WIDGETS[0]);
  });
  it("recovers corrupt or unavailable browser storage", () => {
    expect(readUsageLayout({ getItem: () => "{broken" })).toEqual(normalizeUsageLayout(null));
    expect(readUsageLayout({ getItem: () => { throw new Error("blocked"); } })).toEqual(normalizeUsageLayout(null));
    expect(readUsageLayout({ getItem: (key) => { expect(key).toBe(USAGE_LAYOUT_KEY); return JSON.stringify([{ ...USAGE_WIDGETS[1], title: "Saved graph" }]); } })[0].title).toBe("Saved graph");
  });
});

class ReviewEventSource {
  static instances = [];
  constructor(url) { this.url = url; ReviewEventSource.instances.push(this); }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.closed = true; }
}
let container;
let root;
const json = (body) => ({ ok: true, json: async () => body });
const click = async (name) => {
  const button = [...container.querySelectorAll("button")].find((node) => {
    const label = node.cloneNode(true);
    label.querySelectorAll('[aria-hidden="true"]').forEach((child) => child.remove());
    return node.getAttribute("aria-label") === name || label.textContent.trim() === name;
  });
  expect(button, name).toBeTruthy();
  await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const render = async (element) => { await act(async () => { root.render(element); await Promise.resolve(); }); };

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  ReviewEventSource.instances = [];
  vi.stubGlobal("EventSource", ReviewEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).startsWith("/api/usage/stats") ? json(usageStats) : json({ connections: [], nodes: [], disabledFreeProviders: [] })));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("review usage composition", () => {
  it("avoids repeated card titles while retaining renamed headings and editing controls", async () => {
    const sections = Object.fromEntries(USAGE_WIDGETS.map((widget) => [widget.id, React.createElement("p", null, widget.title)]));
    await render(React.createElement(UsageWidgetLayout, { sections, persistLayout: false }));
    const keyWidget = () => container.querySelector('[data-widget-id="keys"]');
    expect(keyWidget().querySelector("h2").textContent).toBe("API key limits");
    expect(keyWidget().querySelector("h2").className).toBe("sr-only");
    expect(keyWidget().querySelector(".v5-usage-widget-heading")).toBeNull();
    await click("Customize dashboard");
    expect(keyWidget().querySelector("h2").textContent).toBe("API key limits");
    expect(keyWidget().querySelector('button[aria-label="Edit API key limits"]')).not.toBeNull();
    await click("Cancel layout changes");
    expect(keyWidget().querySelector("h2").textContent).toBe("API key limits");
    expect(keyWidget().querySelector(".v5-usage-widget-heading")).toBeNull();
    await render(null);
    await render(React.createElement(UsageWidgetLayout, { sections, persistLayout: false, initialLayout: [{ id: "keys", title: "Team budgets" }] }));
    expect(keyWidget().querySelector("h2").textContent).toBe("Team budgets");
    expect(keyWidget().querySelector("p").textContent).toBe("API key limits");
  });

  it("exposes chart request failure, retries the same period contract and retains loaded intervals after a later failure", async () => {
    let resolveChart;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveChart = resolve; }));
    await render(React.createElement(ActualReviewUsageChart, { period: "60d" }));
    expect(container.querySelector('[role="status"]').textContent).toBe("Loading…");
    await act(async () => resolveChart({ ok: false, status: 503 }));
    expect(container.querySelector('[role="alert"]').textContent).toContain("Unable to load usage chart.");
    expect(container.textContent).not.toContain("No data for this period");
    fetch.mockResolvedValueOnce(json(usageFixture.routes["GET /api/usage/chart"].body));
    await click("Retry chart");
    expect(container.querySelector('[aria-label="Usage totals per interval"]').textContent).toContain("2.4K tokens, $0.1500");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fetch.mock.calls.slice(0, 2).every(([url]) => String(url).includes("period=60d&tz="))).toBe(true);
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await render(React.createElement(ActualReviewUsageChart, { period: "90d" }));
    expect(container.querySelector('[role="alert"]').textContent).toContain("Showing the last loaded chart data.");
    expect(container.querySelector('[aria-label="Usage totals per interval"]').textContent).toContain("3.6K tokens, $0.2300");
  });
  it("shows key-limit loading/failure, reads back configured limits on retry and retains rows when the poll fails", async () => {
    vi.useFakeTimers();
    let resolveUsage;
    let usageCalls = 0;
    fetch.mockImplementation((url) => {
      if (url === "/api/keys") return Promise.resolve(json(usageFixture.routes["GET /api/keys"].body));
      usageCalls += 1;
      if (usageCalls === 1) return new Promise((resolve) => { resolveUsage = resolve; });
      return Promise.resolve(usageCalls === 2 ? json(usageFixture.routes["GET /api/keys/usage"].body) : { ok: false, status: 503 });
    });
    try {
      await render(React.createElement(ReviewApiKeyLimitsCard));
      expect(container.querySelector('[role="status"]').textContent).toBe("Loading API key limits…");
      expect(container.textContent).not.toContain("No limits set");
      await act(async () => resolveUsage({ ok: false, status: 503 }));
      expect(container.querySelector('[role="alert"]').textContent).toContain("Unable to load API key limits.");
      await click("Retry key limits");
      const rows = [...container.querySelectorAll("tbody tr")];
      expect(container.querySelector('[role="region"][aria-label="API key rate and budget limits"]').tabIndex).toBe(0);
      expect(rows).toHaveLength(3);
      expect(rows[0].textContent).toContain("Requests / minute");
      expect(rows[0].children[1].textContent).toBe("2 / 30");
      expect(rows[0].children[2].textContent).toBe("28");
      expect(rows[2].children[1].textContent).toBe("6,000 / 100,000");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      const snapshotRows = () => [...container.querySelectorAll("tbody tr")].map((row) => [...row.children].slice(0, 4).map((cell) => cell.textContent));
      const previous = snapshotRows();
      await act(async () => vi.advanceTimersByTimeAsync(KEY_USAGE_POLL_MS));
      expect(container.querySelector('[role="alert"]').textContent).toContain("Showing the last loaded key limits.");
      expect(snapshotRows()).toEqual(previous);
      expect(fetch.mock.calls.filter(([url]) => url === "/api/keys/usage")).toHaveLength(3);
    } finally { vi.useRealTimers(); }
  });
  it("disables reset while pending and keeps the snapshot, period and retry controls after a failed request", async () => {
    let resolveReset;
    fetch.mockImplementation((url) => String(url) === "/api/usage/reset"
      ? new Promise((resolve) => { resolveReset = resolve; })
      : Promise.resolve(json(String(url).startsWith("/api/usage/stats") ? usageStats : {})));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render(React.createElement(ReviewUsagePage, { persistLayout: false }));
      const previous = container.querySelector("[data-stats]").dataset.stats;
      await click("Reset");
      const periodSelect = container.querySelector('[aria-label="Usage reset period"]');
      await act(async () => { periodSelect.value = "1h"; periodSelect.dispatchEvent(new Event("change", { bubbles: true })); });
      const modal = container.querySelector('[role="dialog"][aria-label="Reset usage data"]');
      const resetButton = [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Reset");
      await act(async () => resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(resetButton.disabled).toBe(true);
      expect(resetButton.getAttribute("aria-busy")).toBe("true");
      expect(modal.querySelector('[role="status"]').textContent).toBe("Resetting usage data…");
      expect(container.querySelector("[data-stats]").dataset.stats).toBe(previous);
      await act(async () => resolveReset({ ok: false, status: 503 }));
      expect(modal.querySelector('[role="alert"]').textContent).toBe("Reset failed. Your displayed usage is unchanged. Try again.");
      expect(resetButton.disabled).toBe(false);
      expect(periodSelect.value).toBe("1h");
      expect(container.querySelector("[data-stats]").dataset.stats).toBe(previous);
      expect(fetch.mock.calls.filter(([url]) => String(url).startsWith("/api/usage/stats"))).toHaveLength(1);
    } finally { consoleError.mockRestore(); }
  });
  it("gives the canonical generated usage overview complete key-limit and reset contracts while retaining its original play", async () => {
    expect(CanonicalUsageOverview.play).toBeInstanceOf(Function);
    const canvasElement = document.createElement("div");
    const content = document.createElement("section");
    content.dataset.v5StoryCanvas = "";
    canvasElement.append(content);
    const context = { canvasElement, args: { persistLayout: false }, parameters: CanonicalUsageOverview.parameters };
    await CanonicalUsageOverview.play(context);
    expect(originalOverviewPlay).toHaveBeenLastCalledWith({ ...context, canvasElement: content });
    const fixture = CanonicalUsageOverview.parameters.storyFixture;
    expect(canonicalUsageMeta.parameters.storyFixture).toEqual(fixture);
    expect(fixture.routes["GET /api/keys"].body.keys[0].id).toBe("usage-review-key");
    expect(fixture.routes["GET /api/keys/usage"].body.usage["usage-review-key"].rpm.limit).toBe(30);
    const cleanup = installStoryNetwork(fixture);
    const requests = vi.spyOn(globalThis, "fetch");
    try {
      await render(CanonicalUsageOverview.render());
      expect(container.textContent).toContain("Requests / minute");
      await click("Reset");
      const periodSelect = container.querySelector('[aria-label="Usage reset period"]');
      await act(async () => { periodSelect.value = "1h"; periodSelect.dispatchEvent(new Event("change", { bubbles: true })); });
      const resetButton = [...container.querySelector('[role="dialog"][aria-label="Reset usage data"]').querySelectorAll("button")].find((button) => button.textContent.trim() === "Reset");
      await act(async () => resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(requests.mock.calls).toContainEqual(["/api/usage/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: "1h" }) }]);
      expect(container.querySelector('[role="dialog"][aria-label="Reset usage data"]')).toBeNull();
      expect(requests.mock.calls.filter(([url]) => String(url).startsWith("/api/usage/stats"))).toHaveLength(2);
    } finally {
      await act(async () => root.render(null));
      requests.mockRestore();
      await cleanup();
    }
  });
  it("cancel restores visibility and order while saving survives reopening the layout editor", async () => {
    const sections = Object.fromEntries(USAGE_WIDGETS.map((widget) => [widget.id, React.createElement("p", null, `${widget.id} data`)]));
    await render(React.createElement(UsageWidgetLayout, { sections, persistLayout: false }));
    expect(container.querySelectorAll("[data-widget-id]")).toHaveLength(8);
    await click("Customize dashboard"); await click("Hide Provider connections"); await click("Move Recent requests and sessions earlier");
    expect(container.querySelectorAll("[data-widget-id]")).toHaveLength(USAGE_WIDGETS.length - 1);
    await click("Cancel layout changes");
    expect([...container.querySelectorAll("[data-widget-id]")].map((node) => node.dataset.widgetId)).toEqual(USAGE_WIDGETS.map((widget) => widget.id));
    await click("Customize dashboard"); await click("Hide API key limits"); await click("Move Provider connections earlier"); await click("Save layout");
    expect(container.querySelector("[data-widget-id]").dataset.widgetId).toBe("topology");
    await click("Customize dashboard"); await click("Add widgets");
    const keySwitch = [...container.querySelectorAll('[role="switch"]')].find((node) => document.querySelector(`label[for="${node.id}"]`)?.textContent === "API key limits");
    expect(keySwitch.getAttribute("aria-checked")).toBe("false");
    await click("Cancel layout changes");
    expect(container.querySelector('[data-widget-id="keys"]')).toBeNull();
  });
  it("preserves cost categories, pending grouped usage and the actual session payload", async () => {
    await render(React.createElement(ReviewUsageStats, { period: "60d", hidePeriodSelector: true }));
    expect(ReviewEventSource.instances[0].url).toBe("/api/usage/stream?period=60d");
    const groups = JSON.parse(container.querySelector("[data-groups]").dataset.groups);
    expect(groups[0].summary).toMatchObject({ pending: 2, cachedTokens: 1800, cacheCreationTokens: 200, reasoningTokens: 100, inputCost: 0.15, cachedCost: 0.03, reasoningCost: 0.02, unsplitCost: 0.02, cost: 0.38 });
    expect(JSON.parse(container.querySelector("[data-sessions]").dataset.sessions)).toEqual(usageStats.activeSessions);
  });
  it("uses custom-range REST totals while SSE updates live sessions and pending activity", async () => {
    await render(React.createElement(ReviewUsageStats, { period: "7d", customRange: { startDate: "2026-09-01", endDate: "2026-09-30" }, isCustomRange: true, hidePeriodSelector: true }));
    await act(async () => ReviewEventSource.instances[0].emit({ ...usageStats, totalRequests: 999, activeSessions: [{ ...usageStats.activeSessions[0], clientId: "stream-client" }] }));
    expect(JSON.parse(container.querySelector("[data-stats]").dataset.stats).totalRequests).toBe(12);
    expect(JSON.parse(container.querySelector("[data-sessions]").dataset.sessions)[0].clientId).toBe("stream-client");
    expect(container.textContent).toContain("Chart shows preset ranges only");
    expect(container.querySelector("[data-chart-refresh]")).toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes("startDate=2026-09-01&endDate=2026-09-30"))).toBe(true);
  });
  it("allows a preset SSE snapshot to supersede and abort stale REST without late overwrite", async () => {
    let resolveRest; let signal;
    fetch.mockImplementation((url, options) => String(url).startsWith("/api/usage/stats") ? new Promise((resolve) => { resolveRest = resolve; signal = options.signal; }) : Promise.resolve(json({})));
    await render(React.createElement(ReviewUsageStats, { period: "365d", hidePeriodSelector: true }));
    await act(async () => ReviewEventSource.instances[0].emit({ ...usageStats, totalRequests: 44 }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolveRest(json({ ...usageStats, totalRequests: 1 })));
    expect(JSON.parse(container.querySelector("[data-stats]").dataset.stats).totalRequests).toBe(44);
    expect(container.querySelector("[data-chart-refresh]").dataset.chartRefresh).toBe("44");
  });
});
