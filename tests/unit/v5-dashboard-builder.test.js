// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeWorkspace, moveDashboardWidget, normalizeDashboardLayout, normalizeWorkspaces, readDashboardLayout, readWorkspaces, SAVER_LAYOUT_KEY, SAVER_WIDGETS, updateDashboardWidget, WORKSPACE_WIDGETS, WORKSPACES_KEY } from "../../src/shared/ui/v5/dashboards/model.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../src/shared/ui/v5/motion/MotionIcon.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children, footer }) => open ? React.createElement("div", { role: "dialog", "aria-label": title }, children, footer) : null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ value, options, onChange, ...rest }) => React.createElement("select", { "aria-label": rest["aria-label"], value, onChange: (event) => onChange(options.find((option) => String(option.value) === event.target.value)?.value) }, options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits", () => ({ default: () => React.createElement("p", null, "Quota source") }));
vi.mock("../../src/shared/ui/v5/dashboards/MonitoringWidget.jsx", () => ({ default: () => React.createElement("p", null, "Monitoring source") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ComboUsageReport", () => ({ default: () => null }));
vi.mock("../../src/shared/ui/v5/usage/ReviewApiKeyLimitsCard.jsx", () => ({ default: () => null }));
vi.mock("../../src/shared/ui/v5/usage/ReviewUsageStats.jsx", () => ({ default: ({ renderSections }) => renderSections({ overview: React.createElement("p", null, "Usage source") }) }));
vi.mock("../../src/shared/ui/v5/dashboards/SaverWidgets.jsx", () => ({ default: ({ renderSections }) => renderSections({ "saver-bytes": React.createElement("p", null, "Actual byte source") }) }));
vi.mock("../../src/shared/ui/v5/dashboards/PxpipeWidgets.jsx", () => ({ default: ({ renderSections }) => renderSections({}) }));
import DashboardCanvas from "../../src/shared/ui/v5/dashboards/DashboardCanvas.jsx";
import WorkspacesPage from "../../src/shared/ui/v5/dashboards/WorkspacesPage.jsx";
let root;
let container;
afterEach(async () => { if (root) await act(() => root.unmount()); container?.remove(); root = null; vi.restoreAllMocks(); });
async function render(element) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(() => root.render(element)); }
async function click(label) { const button = [...container.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent.trim().endsWith(label)); expect(button, label).toBeTruthy(); await act(() => button.click()); }
async function fill(label, value) { const input = [...container.querySelectorAll("input")].find((item) => container.querySelector(`label[for="${item.id}"]`)?.textContent === label); expect(input).toBeTruthy(); await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
const catalog = [{ id: "first", title: "First source", span: 8, visible: true }, { id: "second", title: "Second source", span: 4, visible: true }];
const sections = { first: React.createElement("p", null, "First payload"), second: React.createElement("p", null, "Second payload") };

describe("dashboard preference contract", () => {
  it("retains all nine source-backed saver sections and each operational widget family", () => {
    expect(SAVER_WIDGETS).toHaveLength(9);
    expect(SAVER_WIDGETS.map((item) => item.id)).toContain("pxpipe-history");
    expect(SAVER_WIDGETS.map((item) => item.id)).toContain("pxpipe-events");
    expect(WORKSPACE_WIDGETS.map((item) => item.id)).toEqual(expect.arrayContaining(["topology", "keys", "quota", "monitoring", "saver-bytes", "saver-estimate"]));
    expect(SAVER_LAYOUT_KEY.startsWith("durindoor:v5-review:")).toBe(true);
    expect(WORKSPACES_KEY.startsWith("durindoor:v5-review:")).toBe(true);
  });
  it("reconciles saved layouts without losing missing sources or allowing identity overwrite", () => {
    const result = normalizeDashboardLayout([{ id: "first", title: " New name ", span: 6, visible: false }, { id: "retired", title: "Old source", visible: true }, { id: "first" }], catalog);
    expect(result.map((widget) => widget.id)).toEqual(["first", "retired", "second"]);
    expect(result[0]).toMatchObject({ title: "New name", span: 6, visible: false });
    expect(updateDashboardWidget(result, "first", { id: "other", span: 99 }, catalog)[0]).toMatchObject({ id: "first", span: 8 });
  });
  it("moves widgets immutably while preserving hidden members", () => {
    const saved = normalizeDashboardLayout(null, catalog);
    const hidden = updateDashboardWidget(saved, "first", { visible: false }, catalog);
    expect(moveDashboardWidget(hidden, "second", "first")[0].id).toBe("second");
    expect(hidden[0]).toMatchObject({ id: "first", visible: false });
    expect(saved[0].visible).toBe(true);
  });
  it("recovers corrupt preferences and always keeps one named dashboard", () => {
    expect(readDashboardLayout({ getItem: () => "{bad" }, SAVER_LAYOUT_KEY, catalog)).toEqual(catalog);
    expect(readWorkspaces({ getItem: () => { throw new Error("Storage blocked"); } }).dashboards[0].name).toBe("Operations");
    const current = normalizeWorkspaces(null);
    expect(changeWorkspace(current, { type: "delete", id: "operations" })).toEqual(current);
  });
  it("isolates saved layouts across multiple named dashboards", () => {
    const first = normalizeWorkspaces(null);
    const created = changeWorkspace(first, { type: "create", id: "second", name: "Team" });
    expect(created.activeId).toBe("second");
    expect(created.dashboards[1].layout.every((widget) => !widget.visible)).toBe(true);
    const saved = changeWorkspace(created, { type: "layout", id: "second", layout: updateDashboardWidget(created.dashboards[1].layout, "saver-bytes", { visible: true, title: "My bytes" }, WORKSPACE_WIDGETS) });
    expect(saved.dashboards[0]).toEqual(first.dashboards[0]);
    expect(saved.dashboards[1].layout.find((widget) => widget.id === "saver-bytes")).toMatchObject({ title: "My bytes", visible: true });
    expect(changeWorkspace(saved, { type: "select", id: "operations" }).activeId).toBe("operations");
  });
});

describe("dashboard editing workflow", () => {
  it("commits rename, move and visibility together and cancel restores saved preferences", async () => {
    const onSave = vi.fn();
    await render(React.createElement(DashboardCanvas, { catalog, sections, onSave }));
    await click("Customize dashboard"); await click("Edit First source"); await fill("Widget name", "My source"); await click("Apply changes");
    await click("Move My source later"); await click("Hide Second source"); await click("Save layout");
    expect(onSave).toHaveBeenCalledWith([{ ...catalog[1], visible: false }, { ...catalog[0], title: "My source" }]);
    expect(container.querySelector("[data-widget-id]").getAttribute("data-widget-id")).toBe("first");
    expect(container.textContent).toContain("My source"); expect(container.textContent).not.toContain("Second payload");
    await click("Customize dashboard"); await click("Reset layout"); await click("Cancel layout changes");
    expect(container.textContent).toContain("My source"); expect(container.textContent).not.toContain("Second payload");
  });
  it("restores hidden widgets through the library and shows unavailable source recovery", async () => {
    await render(React.createElement(DashboardCanvas, { catalog, sections, initialLayout: [{ id: "retired", title: "Retired", visible: true }, ...catalog.map((widget) => ({ ...widget, visible: false }))] }));
    expect(container.textContent).toContain("This widget source is unavailable");
    await click("Customize dashboard"); await click("Add widgets");
    const label = [...container.querySelectorAll("label")].find((item) => item.textContent === "First source");
    await act(() => container.querySelector(`#${CSS.escape(label.htmlFor)}`).click());
    await click("Done"); await click("Save layout"); expect(container.textContent).toContain("First payload");
  });
  it("reports browser storage failure while retaining the current saved view", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await render(React.createElement(DashboardCanvas, { catalog, sections, persistLayout: true, storageKey: SAVER_LAYOUT_KEY }));
    await click("Customize dashboard"); await click("Hide First source"); await click("Save layout");
    expect(container.textContent).toContain("Layout saved for this view. Browser storage is unavailable.");
    expect(container.textContent).not.toContain("First payload");
  });
  it("creates an empty named dashboard and keeps the existing dashboard available", async () => {
    await render(React.createElement(WorkspacesPage));
    expect(container.textContent).toContain("Usage source");
    await click("New dashboard"); await fill("Dashboard name", "Team review"); await click("Create dashboard");
    expect(container.querySelector('select[aria-label="Active dashboard"]').value).toBe("dashboard-2");
    expect(container.textContent).toContain("No dashboard widgets are visible.");
    const picker = container.querySelector('select[aria-label="Active dashboard"]');
    await act(() => { picker.value = "operations"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("Usage source");
    expect(container.textContent).toContain("Team review");
  });
});

const { default: ActualSaverWidgets } = await vi.importActual("../../src/shared/ui/v5/dashboards/SaverWidgets.jsx");
const { default: ActualPxpipeWidgets } = await vi.importActual("../../src/shared/ui/v5/dashboards/PxpipeWidgets.jsx");

describe("source-backed dashboard data lifecycle", () => {
  it("retains the last aggregate snapshot on stream failure, retries and closes each period stream", async () => {
    const streams = [];
    const originalStream = globalThis.EventSource;
    class Stream {
      constructor(url) { this.url = url; this.close = vi.fn(); streams.push(this); }
    }
    vi.stubGlobal("EventSource", Stream);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ installed: true }) })));
    await render(React.createElement(ActualSaverWidgets, { renderSections: (content) => React.createElement("div", null, content["saver-summary"], content["saver-estimate"]) }));
    expect(streams[0].url).toBe("/api/token-saver/stream?period=30d");
    await act(() => streams[0].onmessage({ data: JSON.stringify({ requestsObserved: 5, rtk: { bytesSaved: 2048, requestsWithHits: 3, hits: 7 }, headroom: { tokensSaved: 100, compressed: 2 }, totals: { actualBytesSaved: 3072 }, pxpipe: { tokensSavedEst: 88, applied: 1, imageCount: 2 } }) }));
    expect(container.textContent).toContain("2.0 KB");
    expect(container.textContent).toContain("3.0 KB");
    for (const metric of container.querySelectorAll(".v5-dashboard-metrics > div")) expect([...metric.children].map((child) => child.tagName)).toEqual(["DT", "DD"]);
    expect(container.textContent).toContain("88");
    expect(container.textContent).toContain("Separate from actual bytes.");
    await act(() => streams[0].onerror());
    expect(container.querySelector('[role="alert"]').textContent).toContain("Previously received metrics remain visible");
    expect(container.textContent).toContain("2.0 KB");
    await click("Retry Token Saver stream");
    expect(streams[0].close).toHaveBeenCalledOnce();
    expect(streams).toHaveLength(2);
    await act(() => root.unmount()); root = null;
    expect(streams[1].close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals(); globalThis.EventSource = originalStream;
  });
  it("shows invalid aggregate payload recovery rather than displaying fabricated zero metrics", async () => {
    let stream;
    vi.stubGlobal("EventSource", class { constructor() { stream = this; } close() {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await render(React.createElement(ActualSaverWidgets, { renderSections: (content) => content["saver-summary"] }));
    await act(() => stream.onmessage({ data: "{broken" }));
    expect(container.querySelector('[role="alert"]').textContent).toContain("invalid metrics snapshot");
    expect(container.textContent).toContain("Token Saver metrics unavailable.");
    vi.unstubAllGlobals();
  });
  it("refreshes PXPIPE using actual endpoints and keeps previously fetched rows when an activity request fails", async () => {
    let fail = false;
    const fetchMock = vi.fn(async (url) => ({ ok: !fail || String(url).includes("status"), json: async () => String(url).includes("status") ? { installed: true, running: true, version: "1.4.0" } : String(url).includes("health") ? { healthy: true } : String(url).includes("logs") ? { events: [{ ts: "2026-10-09T10:00:00Z", applied: true, tokensBeforeEst: 50, tokensAfterEst: 20, tokensSavedEst: 30 }] } : { recent: [{ ts: "2026-10-09T10:00:00Z", applied: true, tokensBeforeEst: 50, tokensAfterEst: 20, tokensSavedEst: 30 }], windows: { last7d: { requests: 7, compressed: 5, bypassed: 2, tokensBeforeEst: 50, tokensAfterEst: 20, tokensSavedEst: 30, savedPct: 60, imagesGenerated: 2, avgCompressionMs: 12, errors: 0 } } } }));
    vi.stubGlobal("fetch", fetchMock);
    await render(React.createElement(ActualPxpipeWidgets, { renderSections: (content) => React.createElement("div", null, content["pxpipe-status"], content["pxpipe-history"], content["pxpipe-events"]) }));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(["/api/pxpipe/status", "/api/pxpipe/stats", "/api/pxpipe/logs?limit=50", "/api/pxpipe/health"]));
    expect(container.textContent).toContain("v1.4.0");
    const beforeRows = container.querySelector('table[aria-label]')?.textContent || container.querySelector("table").textContent;
    fail = true;
    await click("Refresh");
    expect(container.querySelector('[role="alert"]').textContent).toContain("Last received records remain visible");
    expect(container.querySelector("table").textContent).toBe(beforeRows);
    expect(container.querySelector('[aria-label="PXPIPE raw event log"]').textContent).toContain("30");
    vi.unstubAllGlobals();
  });
});

const { default: ActualMonitoringWidget } = await vi.importActual("../../src/shared/ui/v5/dashboards/MonitoringWidget.jsx");
describe("flat monitoring widget", () => {
  it("retains every measured category, polls at 10 seconds, pauses and reads refreshed source values", async () => {
    vi.useFakeTimers();
    let memory = 146;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ version: "4.10.1", latencyMs: 24, runtime: { processUptimeSec: 86400, nodeVersion: "20.20.2", memoryRssMB: memory, dbSizeLabel: "8.2 MB", dbPath: "/review/data.sqlite", dataDir: "/review", errorProvider: "" }, activity: { today: { requests: 3180, promptTokens: 183000, completionTokens: 59000, providers: 5, models: 12 } }, health: [{ provider: "openai", status: "active" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    await render(React.createElement(ActualMonitoringWidget));
    expect(container.querySelector("h1")).toBeNull();
    for (const measurement of ["146 MB", "8.2 MB", "data.sqlite", "1d 0h", "183,000", "59,000", "20.20.2", "24 ms"]) expect(container.textContent).toContain(measurement);
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await click("Live");
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    memory = 198;
    await click("Refresh monitoring");
    expect(container.textContent).toContain("198 MB");
    expect(container.textContent).toContain("Paused");
    await act(() => root.unmount()); root = null;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
});

describe("independent source widget controls", () => {
  it("labels retained aggregate data with its previous period when the newly selected period fails", async () => {
    const streams = [];
    vi.stubGlobal("EventSource", class { constructor(url) { this.url = url; streams.push(this); } close() {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const props = { renderSections: (content) => content["saver-summary"], period: "30d", hidePeriodSelector: true };
    await render(React.createElement(ActualSaverWidgets, props));
    await act(() => streams[0].onmessage({ data: JSON.stringify({ requestsObserved: 1, rtk: { bytesSaved: 4096 }, totals: { actualBytesSaved: 4096 } }) }));
    await act(() => root.render(React.createElement(ActualSaverWidgets, { ...props, period: "today" })));
    expect(streams[1].url).toBe("/api/token-saver/stream?period=today");
    await act(() => streams[1].onerror());
    expect(container.textContent).toContain("Showing previous 30D snapshot.");
    expect(container.textContent).toContain("4.0 KB");
    await act(() => streams[0].onmessage({ data: JSON.stringify({ requestsObserved: 1, rtk: { bytesSaved: 99999999 } }) }));
    expect(container.textContent).not.toContain("95.4 MB");
    await act(() => streams[1].onmessage({ data: JSON.stringify({ requestsObserved: 1, rtk: { bytesSaved: 2048 } }) }));
    expect(container.textContent).not.toContain("Showing previous");
    expect(container.textContent).toContain("2.0 KB");
    vi.unstubAllGlobals();
  });
  it("keeps an independent refresh in each PXPIPE widget and a status window control without the savings widget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ installed: true, running: true, recent: [], events: [], windows: { last7d: { requests: 7, compressed: 5, bypassed: 2, imagesGenerated: 2, avgCompressionMs: 12, tokensBeforeEst: 50, tokensAfterEst: 20, tokensSavedEst: 30, savedPct: 60, errors: 0 }, today: { requests: 2, compressed: 1, bypassed: 1, imagesGenerated: 1, avgCompressionMs: 12, tokensBeforeEst: 50, tokensAfterEst: 20, tokensSavedEst: 30, savedPct: 60, errors: 0 } } }) })));
    let captured;
    await render(React.createElement(ActualPxpipeWidgets, { renderSections: (content) => { captured = content; return content["pxpipe-status"]; } }));
    expect(container.querySelector('button[aria-label="Refresh PXPIPE status"]')).toBeTruthy();
    const select = container.querySelector('select[aria-label="PXPIPE status window"]');
    expect(select).toBeTruthy();
    await act(() => { select.value = "today"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const requestsLabel = [...container.querySelectorAll("span")].find((node) => node.textContent === "Requests");
    expect(requestsLabel.parentElement.nextElementSibling.textContent).toBe("2");
    for (const [id, label] of [["pxpipe-savings", "savings"], ["pxpipe-trend", "daily estimates"], ["pxpipe-history", "history"], ["pxpipe-events", "events"]]) {
      const toolbar = captured[id].props.children[0];
      expect(toolbar.props.children[1].props["aria-label"]).toBe(`Refresh PXPIPE ${label}`);
      expect(toolbar.props.children[1].props.onClick).toBeTypeOf("function");
    }
    vi.unstubAllGlobals();
  });
});
