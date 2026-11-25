// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageStats } from "../../src/shared/ui/v5/usage/fixtures.js";
import { USAGE_LAYOUT_KEY, USAGE_WIDGETS } from "../../src/shared/ui/v5/usage/layout.js";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/MonitoringWidgets", () => ({ default: () => React.createElement("p", { "data-testid": "monitoring" }, "monitoring") }));
vi.mock("@/app/(dashboard)/dashboard/combos/components/ComboUsageReport.jsx", () => ({ default: () => React.createElement("p", null, "combo report") }));
vi.mock("@/app/(dashboard)/dashboard/keys/components/ApiKeyLimitsCard.js", () => ({ default: () => React.createElement("p", null, "key limits") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: () => React.createElement("p", null, "overview cards") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({ default: () => React.createElement("p", null, "usage table"), fmt: String, fmtTime: String }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageChart", () => ({ default: () => React.createElement("p", null, "usage chart") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: () => React.createElement("p", null, "requests panel") }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderTopology", () => ({ default: () => React.createElement("p", null, "topology") }));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({ default: ({ open, title, children, footer }) => open ? React.createElement("div", { role: "dialog", "aria-label": title }, children, footer) : null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: ({ options, value, onChange, ...rest }) => React.createElement("select", { "aria-label": rest["aria-label"], value, onChange: (event) => onChange(event.target.value) }, options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));
vi.mock("@/shared/ui/components/RangeSelector.jsx", () => ({ default: () => React.createElement("div", { "aria-label": "Usage period" }) }));
import UsagePage from "../../src/app/(dashboard)/dashboard/usage/page.js";

class FakeEventSource {
  constructor(url) { this.url = url; }
  close() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const json = (body) => ({ ok: true, status: 200, json: async () => body });
let root, host, statsFails;

beforeEach(() => {
  window.localStorage.clear();
  statsFails = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const target = String(url);
    if (target.startsWith("/api/usage/stats")) return statsFails ? { ok: false, status: 503, json: async () => ({}) } : json(usageStats);
    if (target === "/api/usage/reset") return json({ success: true });
    return json({ connections: [], nodes: [] });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  delete document.documentElement.dataset.ui; window.localStorage.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function render(v5) {
  if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
  await act(async () => { root.render(React.createElement(UsagePage)); });
  await act(async () => {});
  await act(async () => {});
}
const labelOf = (node) => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((child) => child.remove());
  return node.getAttribute("aria-label") || copy.textContent.trim();
};
const button = (name, scope = host) => [...scope.querySelectorAll("button")].find((node) => labelOf(node) === name);
const click = async (name, scope = host) => {
  const target = button(name, scope);
  expect(target, name).toBeTruthy();
  await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const order = () => [...host.querySelectorAll("[data-widget-id]")].map((node) => node.getAttribute("data-widget-id"));
const dialog = (name) => document.querySelector(`[role="dialog"][aria-label="${name}"]`);

describe("usage layout with the V5 switch", () => {
  it("leaves the original composition and no layout controls when the switch is off", async () => {
    await render(false);
    expect(host.querySelector("[data-widget-id]")).toBeNull();
    expect(button("Customize dashboard")).toBeUndefined();
    expect(host.textContent).toContain("monitoring");
    expect(host.textContent).toContain("overview cards");
  });

  it("places every report in the widget layout when the switch is on", async () => {
    await render(true);
    expect(order()).toEqual(USAGE_WIDGETS.map((widget) => widget.id));
    expect(host.textContent).toContain("combo report");
    expect(host.textContent).toContain("key limits");
    expect(button("Customize dashboard")).toBeTruthy();
  });

  it("restores the saved order on Cancel and writes nothing", async () => {
    await render(true);
    const before = order();
    await click("Customize dashboard");
    expect(button("Move Usage overview earlier").disabled).toBe(true);
    await click("Move Usage overview later");
    expect(order()).not.toEqual(before);
    await click("Cancel layout changes");
    expect(order()).toEqual(before);
    expect(window.localStorage.getItem(USAGE_LAYOUT_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("saves only durindoor:usage-layout:v1 and keeps it on the next mount", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    await render(true);
    await click("Customize dashboard");
    await click("Move Usage overview later");
    const moved = order();
    await click("Save layout");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe("durindoor:usage-layout:v1");
    expect(window.localStorage.length).toBe(1);
    expect(host.querySelector('p[role="status"]').textContent).toContain("Dashboard layout saved.");
    expect(order()).toEqual(moved);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(true);
    expect(order()).toEqual(moved);
  });

  it("shows a notice and keeps the view when storage is blocked", async () => {
    await render(true);
    await click("Customize dashboard");
    await click("Move Usage overview later");
    const moved = order();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await click("Save layout");
    expect(host.querySelector('p[role="status"]').textContent).toContain("Browser storage is unavailable.");
    expect(order()).toEqual(moved);
    expect(button("Customize dashboard")).toBeTruthy();
  });

  it("asks for confirmation before resetting the layout, separately from usage data", async () => {
    await render(true);
    const before = order();
    await click("Customize dashboard");
    await click("Move Usage overview later");
    await click("Reset layout");
    expect(dialog("Reset widget layout?")).toBeTruthy();
    expect(dialog("Reset usage data")).toBeNull();
    await click("Keep layout", dialog("Reset widget layout?"));
    expect(order()).not.toEqual(before);
    await click("Reset layout");
    await click("Reset to default layout", dialog("Reset widget layout?"));
    expect(order()).toEqual(before);
    expect(fetch.mock.calls.some(([url]) => url === "/api/usage/reset")).toBe(false);
    await click("Cancel layout changes");
    await click("Reset");
    expect(dialog("Reset usage data")).toBeTruthy();
    expect(dialog("Reset widget layout?")).toBeNull();
  });

  it("keeps the other reports mounted when usage fails and retries the same URL", async () => {
    statsFails = true;
    await render(true);
    const statsCalls = () => fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/usage/stats"));
    expect(host.querySelector('[role="alert"]').textContent).toContain("Failed to load usage statistics");
    expect(host.textContent).toContain("key limits");
    const first = statsCalls();
    statsFails = false;
    await click("Retry usage");
    await act(async () => {});
    expect(statsCalls().slice(first.length)[0]).toBe(first[0]);
    expect(host.textContent).toContain("overview cards");
  });
});

describe("usage data reset parity", () => {
  const resetCall = async (v5) => {
    await render(v5);
    await click("Reset");
    await click("Reset", dialog("Reset usage data"));
    await act(async () => {});
    return fetch.mock.calls.filter(([url]) => url === "/api/usage/reset");
  };
  it("issues the same method, URL and body with data-ui set and unset", async () => {
    const off = await resetCall(false);
    expect(off).toHaveLength(1);
    expect(off[0][0]).toBe("/api/usage/reset");
    expect(off[0][1]).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: "all" }) });
    await act(async () => root.unmount());
    fetch.mockClear();
    root = createRoot(host);
    const on = await resetCall(true);
    expect(on).toEqual(off);
  });
});
