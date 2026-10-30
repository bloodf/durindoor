// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startConsoleLogTransport } from "../../src/app/(dashboard)/dashboard/console-log/transport.js";
import { dashboardSources, WORKSPACE_WIDGETS } from "../../src/shared/ui/v5/dashboards/model.js";

const navigation = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() }, params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation.router, usePathname: () => "/dashboard/quota", useSearchParams: () => navigation.params }));
vi.mock("next/link", () => ({ default: ({ children, ...props }) => React.createElement("a", props, children) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/components", () => ({ EditConnectionModal: () => null }));
vi.mock("../../src/shared/ui/v5/motion/MotionIcon.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/ProviderLogo.jsx", () => ({ default: () => null, ProviderLogo: () => null }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children, footer }) => open ? React.createElement("div", { role: "dialog", "aria-label": title }, children, footer) : null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ value, options = [], onChange, ...rest }) => React.createElement("select", { "aria-label": rest["aria-label"], value, onChange: (event) => onChange(options.find((option) => String(option.value) === event.target.value)?.value) }, options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/i18n/runtime", () => ({ getCurrentLocale: () => "en", onLocaleChange: () => () => {}, translate: (value) => value }));
vi.mock("recharts", () => {
  const child = ({ children }) => React.createElement("div", null, children);
  const leaf = () => null;
  return { AreaChart: child, Area: leaf, XAxis: leaf, YAxis: leaf, CartesianGrid: leaf, Tooltip: leaf, ResponsiveContainer: child, Legend: leaf, BarChart: child, Bar: leaf, LineChart: child, Line: leaf };
});
import TokenSaverClient from "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx";
import HealthPage from "../../src/app/(dashboard)/dashboard/health/page.js";
import ProviderLimits from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js";
import PxpipeWidgets from "../../src/shared/ui/v5/dashboards/PxpipeWidgets.jsx";
import WorkspacesPage from "../../src/shared/ui/v5/dashboards/WorkspacesPage.jsx";
import MonitoringWidget from "../../src/shared/ui/v5/dashboards/MonitoringWidget.jsx";
import MonitoringWidgets from "../../src/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.jsx";
import ConsoleLogClient from "../../src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function render(component) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root.render(component)); await flush(); }
function button(name) { return [...container.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === name || item.textContent.trim().endsWith(name)); }
async function click(name) { const target = button(name); expect(target, name).toBeTruthy(); await act(() => target.click()); await flush(); }
async function select(name, value) { const element = container.querySelector(`select[aria-label="${name}"]`); await act(() => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
async function input(label, value, scope = container) { const field = [...scope.querySelectorAll("input")].find((item) => scope.querySelector(`label[for="${item.id}"]`)?.textContent === label); expect(field, label).toBeTruthy(); await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); return field; }
class Source {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; Source.instances.push(this); }
  close() { this.closed = true; this.readyState = 2; }
  emit(body) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(body) }); }
}
afterEach(async () => { if (root) await act(() => root.unmount()); container?.remove(); root = null; Source.instances = []; window.localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function stubFetch(handler) { vi.stubGlobal("EventSource", Source); return vi.stubGlobal("fetch", vi.fn(handler)); }
const monitoring = { runtime: { memoryRssMB: 146 }, activity: { today: { requests: 2 } }, latencyMs: 12 };
const settings = { rtkEnabled: true, cavemanEnabled: true, cavemanLevel: "full", ponytailEnabled: true, ponytailLevel: "full", headroomEnabled: true, headroomUrl: "http://localhost:8787", pxpipeEnabled: false, pxpipeMinChars: 25000, pxpipeAllowedModels: ["known"] };
const settingsFetch = (patch) => async (url, options = {}) => {
  if (url === "/api/settings") return options.method === "PATCH" ? patch(options) : response(settings);
  if (String(url).includes("/headroom/status")) return response({ installed: true, running: true, localUrl: true });
  if (String(url).includes("/headroom/extras")) return response({ extras: {}, available: [] });
  if (String(url).includes("/pxpipe/status")) return response({ installed: true });
  return response({ events: [] });
};

describe("Visant confirmed dashboard writes", () => {
  it.each(["Enable RTK", "Enable Caveman", "Enable Ponytail", "Enable Headroom", "Enable PXPIPE"])("retains accepted %s on rejected writes and retries the intent", async (label) => {
    let fail = true;
    stubFetch(settingsFetch(() => response({ error: "Rejected configuration" }, fail ? 503 : 200)));
    await render(React.createElement(TokenSaverClient, { view: "settings" }));
    const toggle = container.querySelector(`button[aria-label="${label}"]`);
    const saved = toggle.getAttribute("aria-checked");
    await act(() => toggle.click()); await flush();
    expect(toggle.getAttribute("aria-checked")).toBe(saved);
    expect(container.textContent).toContain("Not saved. Rejected configuration");
    fail = false;
    await click(`Retry ${label.replace("Enable ", "")}`);
    expect(toggle.getAttribute("aria-checked")).toBe(String(saved !== "true"));
    expect(container.textContent).toContain(": Saved");
  });
  it("keeps rejected Caveman and Ponytail levels checked at their accepted value", async () => {
    stubFetch(settingsFetch(() => response({ error: "Rejected level" }, 400)));
    await render(React.createElement(TokenSaverClient, { view: "settings" }));
    for (const name of ["Caveman level", "Ponytail level"]) {
      const group = container.querySelector(`[role="radiogroup"][aria-label="${name}"]`);
      const accepted = group.querySelector('[aria-checked="true"]').textContent;
      await act(() => group.querySelector('[aria-checked="false"]').click()); await flush();
      expect(group.querySelector('[aria-checked="true"]').textContent).toBe(accepted);
      expect(container.textContent).toContain(`${name}: Not saved`);
    }
  });
  it("restores rejected Headroom URL and timeout drafts", async () => {
    stubFetch(settingsFetch(() => response({ error: "Rejected proxy setting" }, 400)));
    await render(React.createElement(TokenSaverClient, { view: "settings" })); await click("Manage");
    const modal = container.querySelector('[role="dialog"]');
    for (const [label, desired, accepted] of [["Proxy URL", "http://changed:8787", "http://localhost:8787"], ["Timeout (ms)", "30000", "15000"]]) {
      const field = await input(label, desired, modal);
      await act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))); await flush();
      expect(field.value).toBe(accepted);
    }
    expect(container.textContent).toContain("Headroom URL: Not saved"); expect(container.textContent).toContain("Headroom timeout: Not saved");
  });
  it("shows pending without a false toggle change and blocks duplicate writes", async () => {
    const write = deferred();
    stubFetch(settingsFetch(() => write.promise));
    await render(React.createElement(TokenSaverClient, { view: "settings" }));
    const toggle = container.querySelector('button[aria-label="Enable Caveman"]');
    await act(() => { toggle.click(); toggle.click(); });
    expect(toggle.getAttribute("aria-checked")).toBe("true"); expect(toggle.disabled).toBe(true);
    expect(globalThis.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
    await act(() => write.resolve(response({ success: true }))); await flush();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
  it("restores rejected numeric and allowlist drafts to accepted settings", async () => {
    stubFetch(settingsFetch(() => response({ error: "Rejected configuration" }, 400)));
    await render(React.createElement(TokenSaverClient, { view: "settings" }));
    for (const [label, desired, accepted] of [["Minimum chars", "50000", "25000"], ["Allowed models", "unknown", "known"]]) {
      const field = await input(label, desired);
      await act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))); await flush();
      expect(field.value).toBe(accepted);
    }
    expect(container.textContent).toContain("Minimum chars: Not saved"); expect(container.textContent).toContain("Allowed models: Not saved");
  });
});

describe("Visant truthful dashboard reads", () => {
  it("loads Headroom independently when provider health fails, without fake empty or zero counts", async () => {
    stubFetch(async (url) => String(url).includes("/headroom") ? response({ running: true, url: "http://headroom" }) : response({ error: "Provider probe failed" }, 503));
    await render(React.createElement(HealthPage));
    expect(container.textContent).toContain("Provider probe failed"); expect(container.textContent).toContain("http://headroom");
    expect(container.textContent).not.toContain("No active connections"); expect(container.textContent).not.toContain("Unavailable (fail-open)");
    expect(container.textContent).toContain("Provider measurements are unknown");
  });
  it("shows unknown Headroom while independently retaining successful provider measurements", async () => {
    stubFetch(async (url) => String(url).includes("/headroom") ? response({ error: "Offline" }, 503) : response({ summary: { total: 1, healthy: 1 }, providers: [{ id: "one", provider: "openai", name: "Primary", state: "healthy" }] }));
    await render(React.createElement(HealthPage)); expect(container.textContent).toContain("Primary"); expect(container.textContent).toContain("Unknown"); expect(container.textContent).not.toContain("Not configured");
  });
  it("keeps quota connection-list failure distinct from successful empty and retries", async () => {
    let failing = true;
    stubFetch(async (url) => {
      if (String(url).startsWith("/api/providers/client")) return response({ connections: [], providerOptions: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, totals: { eligibleConnections: 0, providerFilteredConnections: 0 } }, failing ? 503 : 200);
      return response({});
    });
    await render(React.createElement(ProviderLimits));
    expect(container.textContent).toContain("Provider connections could not be loaded"); expect(container.textContent).not.toContain("No Providers Connected");
    expect(container.querySelector('select[aria-label="Accounts per page"]')).toBeNull();
    failing = false; await click("Retry connections"); expect(container.textContent).not.toContain("could not be loaded"); expect(container.textContent).toMatch(/No Providers Connected/i);
    expect(navigation.router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/dashboard\/quota/), { scroll: false });
  });
  it("preserves distinct custom account names below the canonical provider when email is absent", async () => {
    const connections = ["A", "B"].map((name) => ({ id: `claude-${name}`, provider: "claude", name: `Claude Account ${name}`, authType: "oauth", isActive: true }));
    stubFetch(async (url) => response(String(url).startsWith("/api/providers/client") ? { connections, providerOptions: ["claude"], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, totals: { eligibleConnections: 2, providerFilteredConnections: 2 } } : {}));
    await render(React.createElement(ProviderLimits));
    expect(container.textContent).toContain("Claude Account A"); expect(container.textContent).toContain("Claude Account B");
    expect(container.querySelector('section[aria-label="Claude Code · Claude Account B"]')).not.toBeNull();
  });
  it("does not claim PXPIPE empty savings or events while initial resources load or fail", async () => {
    const pending = deferred(); stubFetch(() => pending.promise);
    await render(React.createElement(PxpipeWidgets));
    expect(container.textContent).toContain("Loading PXPIPE"); expect(container.textContent).not.toContain("No transform events yet"); expect(container.textContent).not.toContain("No estimated savings recorded");
    await act(() => pending.resolve(response({ error: "Unavailable" }, 503))); await flush();
    expect(container.textContent).toContain("PXPIPE stats could not be refreshed"); expect(container.textContent).not.toContain("No transform events yet"); expect(container.textContent).not.toContain("No estimated savings recorded");
  });
  it("isolates PXPIPE event failures from successful savings and recovers events", async () => {
    let logsFail = true;
    stubFetch(async (url) => {
      if (String(url).includes("/logs")) return response({ events: [] }, logsFail ? 503 : 200);
      if (String(url).includes("/stats")) return response({ timeline: [], recent: [], windows: {} });
      return response({ installed: true, healthy: true });
    });
    await render(React.createElement(PxpipeWidgets)); expect(container.textContent).toContain("No estimated savings recorded"); expect(container.textContent).toContain("PXPIPE events could not be refreshed"); expect(container.textContent).not.toContain("PXPIPE stats could not be refreshed");
    logsFail = false; await click("Retry PXPIPE events"); expect(container.textContent).toContain("No transform events yet"); expect(container.textContent).not.toContain("could not be refreshed");
  });
  it("exposes recorded provider health as its own named region among other usage tables", async () => {
    stubFetch(async () => response({ ...monitoring, health: [{ id: "openai", name: "OpenAI", requests: 2 }] }));
    await render(React.createElement(MonitoringWidgets));
    const health = container.querySelector('[role="region"][aria-label="Recorded provider health"]');
    const table = container.querySelector('[aria-label="Recorded provider health table"]');
    table.focus();
    expect(document.activeElement).toBe(table);
    expect(health).not.toBeNull(); expect(health.querySelector("tbody td").textContent).toBe("OpenAI");
  });
  it("keeps first monitoring load unknown and rejects an older refresh arriving after a newer one", async () => {
    vi.useFakeTimers();
    const first = deferred(), second = deferred(); let reads = 0;
    stubFetch(() => (++reads === 1 ? first.promise : second.promise));
    await render(React.createElement(MonitoringWidget)); expect(container.textContent).toContain("Loading monitoring status"); expect(container.textContent).not.toContain("Online");
    // A manual request supersedes the initial read, even if the server ignores abort.
    await act(async () => vi.advanceTimersByTimeAsync(10000)); await act(() => second.resolve(response(monitoring))); await flush();
    await act(() => first.resolve(response({ ...monitoring, runtime: { memoryRssMB: 999 } }))); await flush();
    expect(container.textContent).toContain("146 MB"); expect(container.textContent).not.toContain("999 MB");
  });
});

describe("Visant transport and dashboard lifecycle", () => {
  it("reports stream fallback, unavailable polling, and successful recovery from real transport outcomes", async () => {
    vi.useFakeTimers(); let fail = true;
    const statuses = [];
    const transport = startConsoleLogTransport({ EventSourceImpl: null, fetchImpl: async () => response({ success: true, logs: [] }, fail ? 503 : 200), onSnapshot: vi.fn(), onEvent: vi.fn(), onStatus: (state) => statuses.push(state), pollIntervalMs: 100 });
    await transport.ready;
    expect(statuses.at(-1).state).toBe("unavailable"); expect(statuses.some((item) => item.state === "streaming")).toBe(false);
    fail = false; await vi.advanceTimersByTimeAsync(100);
    expect(statuses.at(-1).state).toBe("polling"); transport.stop();
  });
  it("freezes displayed lines on pause for polling snapshots, and surfaces failed clear without erasing logs", async () => {
    stubFetch(async (_url, options = {}) => response({ success: true, logs: ["[12:00:00] [INFO] initial"] }, options.method === "DELETE" ? 503 : 200));
    await render(React.createElement(ConsoleLogClient)); const source = Source.instances[0];
    await click("Pause"); await act(() => source.emit({ type: "init", logs: ["[12:00:00] [INFO] initial", "[12:00:01] [INFO] arriving"] }));
    expect(container.textContent).not.toContain("arriving"); expect(container.textContent).toContain("1 new");
    await click("Clear"); expect(container.textContent).toContain("Console logs were not cleared"); expect(container.textContent).toContain("initial");
    await click("Resume"); expect(container.textContent).toContain("arriving");
  });
  it("does not subscribe hidden Usage, Saver or PXPIPE resources on a monitoring-only dashboard", async () => {
    stubFetch(async (url) => { expect(url).toBe("/api/monitoring"); return response(monitoring); });
    const layout = WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: widget.id === "monitoring" }));
    await render(React.createElement(WorkspacesPage, { initialWorkspaces: { activeId: "only", dashboards: [{ id: "only", name: "Monitoring only", layout }] } }));
    expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual(["/api/monitoring"]);
    expect(Source.instances).toHaveLength(0); expect(container.textContent).toContain("146 MB");
  });
  it("keeps the library and draft mounted while newly visible Usage and Saver sources subscribe", async () => {
    stubFetch(async () => response(monitoring));
    const layout = WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: false }));
    await render(React.createElement(WorkspacesPage, { initialWorkspaces: { activeId: "empty", dashboards: [{ id: "empty", name: "Blank", layout }] } }));
    await click("Choose widgets");
    for (const title of ["Usage overview", "Actual bytes saved"]) {
      const label = [...container.querySelectorAll("label")].find((item) => item.textContent === title);
      expect(label).toBeTruthy();
      await act(() => document.getElementById(label.htmlFor).click()); await flush();
      expect(container.querySelector('[role="dialog"][aria-label="Widget library"]')).not.toBeNull();
      expect(button("Save layout")).toBeTruthy();
    }
    await click("Done"); await click("Save layout");
    expect(container.querySelector('[data-widget-id="overview"]')).not.toBeNull();
    expect(container.querySelector('[data-widget-id="saver-bytes"]')).not.toBeNull();
  });
  it("retains each dashboard's unsaved hidden layout when switching by the shared picker", async () => {
    stubFetch(async () => response(monitoring));
    const layout = WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: widget.id === "monitoring" }));
    await render(React.createElement(WorkspacesPage, { initialWorkspaces: { activeId: "one", dashboards: [{ id: "one", name: "One", layout }, { id: "two", name: "Two", layout }] } }));
    await click("Customize dashboard"); await click("Hide Gateway monitoring"); expect(container.textContent).toContain("No dashboard widgets are visible");
    await select("Active dashboard", "two"); expect(container.querySelector('[data-widget-id="monitoring"]')).not.toBeNull();
    await select("Active dashboard", "one"); expect(container.textContent).toContain("No dashboard widgets are visible"); expect(button("Save layout")).toBeTruthy();
    await click("Cancel layout changes"); expect(container.querySelector('[data-widget-id="monitoring"]')).not.toBeNull();
  });
  it("derives subscriptions from actual visible data dependencies rather than the broad Usage category", () => {
    expect(dashboardSources([{ id: "keys", visible: true }, { id: "combos", visible: true }, { id: "monitoring", visible: true }])).toEqual({ usage: false, saver: false, pxpipe: false });
    expect(dashboardSources([{ id: "saver-bytes", visible: true }, { id: "pxpipe-events", visible: false }])).toEqual({ usage: false, saver: true, pxpipe: false });
  });
});
